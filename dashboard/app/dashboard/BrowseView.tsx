"use client";

/**
 * BrowseView — the dense register: toolbar (search / filters / sort,
 * persisted per device), action-needed section, tier groups, bulk
 * multi-select, reject-with-reason, and the keyboard layer.
 *
 * All mutations come in through JobActions (page.tsx) so this file
 * never fetches; it only renders + orchestrates.
 *
 * Keyboard: j/k row cursor · a approve · s skip/ignore (reason pick) ·
 * enter open · x select · / search · ? help. Disabled while typing or
 * while any modal is open.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Job, JobStatus } from "../lib/supabase";
import { AdapterBadge } from "./components/AdapterBadge";
import { Btn, btnLinkClass } from "./components/Button";
import {
  DegreeGatePill,
  LifecyclePill,
  LocationBadge,
  Pill,
  StatusBadge,
  TierPill,
} from "./components/JobBadges";
import { Modal, ModalTitle } from "./components/Modal";
import { ReasonPick } from "./components/ReasonPick";
import { SkeletonRows, Skeleton } from "./components/Skeleton";
import {
  relativeTime,
  scoreOf,
  tierKey,
  locationBucket,
  TIER_LABEL,
  type LocationBucket,
} from "./lib/format";
import { isActionNeeded, isTerminalMuted, statusTone, toneStripeVar } from "./lib/lifecycle";
import { loadPref, savePref } from "./lib/prefs";
import ManualTailorPanel from "./ManualTailorPanel";
import RunsPanel from "./RunsPanel";
import type { JobActions } from "./page";

/* ── Toolbar prefs ─────────────────────────────────────────────────── */

type StatusGroup = "all" | "unreviewed" | "in_progress" | "needs_action" | "done";
type SortKey = "score-desc" | "score-asc" | "date-desc" | "date-asc" | "company-asc";
type GateFilter = "all" | "hide" | "only";

type Filters = {
  statusGroup: StatusGroup;
  tier: "all" | "1" | "1.5" | "2" | "3";
  scoreMin: number;
  scoreMax: number;
  source: string;
  location: "all" | LocationBucket;
  sort: SortKey;
  gate: GateFilter;
};

const DEFAULT_FILTERS: Filters = {
  statusGroup: "all",
  tier: "all",
  scoreMin: 0,
  scoreMax: 10,
  source: "all",
  location: "local",
  sort: "score-desc",
  gate: "all",
};

const FILTERS_KEY = "dashboard:browse:filters:v1";

const IN_PROGRESS = new Set(["approved", "preparing", "prefilling"]);
const NEEDS_ACTION = new Set(["ready_for_review", "awaiting_human_submit"]);
const DONE = new Set(["applied", "failed", "ignored", "skipped", "expired"]);

/* ── Submit-lane eligibility ────────────────────────────────────────────
 * A tailored (ready_for_review) row can be enqueued for the local submit
 * runner only if it has a usable direct link AND a generated resume. The
 * guardrails are shared by the per-row Submit button (disable) and the
 * Submit-All bulk action (skip). `link_status` is live in the jobs table
 * (jobpipe migration 013) and fetched in LIST_COLUMNS — the check below
 * is the ONLY one that skips aggregator/expired rows, since those still
 * carry a non-null application_url. */
type SubmitSkipReason = "no direct link" | "no resume";

function submitBlockedReason(job: Job): SubmitSkipReason | null {
  const link = job.link_status;
  if (link === "aggregator_unverified" || link === "expired") return "no direct link";
  if (!job.application_url) return "no direct link";
  if (!job.resume_pdf_path) return "no resume";
  return null;
}

function matchesStatusGroup(status: JobStatus | null, group: StatusGroup): boolean {
  if (group === "all") return true;
  const s = status ?? "new";
  switch (group) {
    case "unreviewed":
      return s === "new";
    case "in_progress":
      return IN_PROGRESS.has(s);
    case "needs_action":
      return NEEDS_ACTION.has(s);
    case "done":
      return DONE.has(s);
  }
}

const SORTERS: Record<SortKey, (a: Job, b: Job) => number> = {
  "score-desc": (a, b) => (scoreOf(b.score) ?? -1) - (scoreOf(a.score) ?? -1),
  "score-asc": (a, b) => (scoreOf(a.score) ?? 11) - (scoreOf(b.score) ?? 11),
  "date-desc": (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  "date-asc": (a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  "company-asc": (a, b) => (a.company ?? "").localeCompare(b.company ?? ""),
};

/* ── Component ─────────────────────────────────────────────────────── */

export default function BrowseView({
  jobs,
  loading,
  error,
  actions,
  degreeGateSupported,
  search,
  onSearch,
}: {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  actions: JobActions;
  degreeGateSupported: boolean;
  search: string;
  onSearch: (q: string) => void;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [reasonTarget, setReasonTarget] = useState<
    | { kind: "single"; job: Job }
    | { kind: "bulk"; jobs: Job[] }
    | null
  >(null);
  const [confirmApprove, setConfirmApprove] = useState<Job[] | null>(null);
  const [confirmSubmitAll, setConfirmSubmitAll] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  /** Rows whose tailor was dispatched this session (status still
   *  'approved' until the GHA workflow flips it on the next poll). */
  const [tailorQueued, setTailorQueued] = useState<ReadonlySet<string>>(new Set());

  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const lastClickedIndex = useRef<number | null>(null);

  // Restore persisted toolbar choices after mount (localStorage is
  // unavailable during SSR).
  useEffect(() => {
    setFilters(loadPref(FILTERS_KEY, DEFAULT_FILTERS));
    setHydrated(true);
  }, []);

  const updateFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      savePref(FILTERS_KEY, next);
      return next;
    });
  }, []);

  const sources = useMemo(() => {
    const s = new Set<string>();
    jobs.forEach((j) => j.source && s.add(j.source));
    return Array.from(s).sort();
  }, [jobs]);

  const filtered = useMemo(() => {
    const f = jobs.filter((j) => {
      if (!matchesStatusGroup(j.status, filters.statusGroup)) return false;
      if (filters.tier !== "all" && tierKey(j.tier) !== filters.tier) return false;
      const score = scoreOf(j.score);
      if (filters.scoreMin > 0 && (score ?? 0) < filters.scoreMin) return false;
      if (filters.scoreMax < 10 && (score ?? 0) > filters.scoreMax) return false;
      if (filters.source !== "all" && j.source !== filters.source) return false;
      if (filters.location !== "all" && locationBucket(j.location) !== filters.location)
        return false;
      if (degreeGateSupported && filters.gate !== "all") {
        const gated = j.degree_gated === true;
        if (filters.gate === "hide" && gated) return false;
        if (filters.gate === "only" && !gated) return false;
      }
      return true;
    });
    return f.sort(SORTERS[filters.sort]);
  }, [jobs, filters, degreeGateSupported]);

  // Action-needed rows pin to a dedicated top section regardless of tier.
  const actionNeededList = useMemo(
    () => filtered.filter((j) => isActionNeeded(j.status)),
    [filtered],
  );

  const grouped = useMemo(() => {
    const g: Record<string, Job[]> = { "1": [], "1.5": [], "2": [], "3": [], other: [] };
    filtered.forEach((j) => {
      if (isActionNeeded(j.status)) return;
      g[tierKey(j.tier) ?? "other"].push(j);
    });
    return g;
  }, [filtered]);

  /** Render order, flattened — keyboard cursor + shift-select ranges. */
  const ordered = useMemo(
    () => [
      ...actionNeededList,
      ...grouped["1"],
      ...grouped["1.5"],
      ...grouped["2"],
      ...grouped["3"],
      ...grouped.other,
    ],
    [actionNeededList, grouped],
  );
  const orderedIds = useMemo(() => ordered.map((j) => String(j.id)), [ordered]);

  /* ── Selection ───────────────────────────────────────────────── */

  const toggleSelect = useCallback(
    (job: Job, index: number, shiftKey: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const id = String(job.id);
        if (shiftKey && lastClickedIndex.current !== null) {
          const [lo, hi] = [
            Math.min(lastClickedIndex.current, index),
            Math.max(lastClickedIndex.current, index),
          ];
          const turningOn = !prev.has(id);
          for (let i = lo; i <= hi; i++) {
            if (turningOn) next.add(orderedIds[i]);
            else next.delete(orderedIds[i]);
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        lastClickedIndex.current = index;
        return next;
      });
    },
    [orderedIds],
  );

  const selectedJobs = useMemo(
    () => ordered.filter((j) => selected.has(String(j.id))),
    [ordered, selected],
  );
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    lastClickedIndex.current = null;
  }, []);

  /* ── Bulk actions ────────────────────────────────────────────── */

  const bulkApprove = useCallback(
    (eligible: Job[]) => {
      setConfirmApprove(null);
      void actions.act.run("bulk:approve", {
        perform: async () => {
          const results = await Promise.allSettled(
            eligible.map((j) =>
              actions.setStatus(j, "approved", { errorLabel: "Approve" }),
            ),
          );
          clearSelection();
          const failed = results.filter(
            (r) => r.status === "rejected" || r.value === null,
          ).length;
          if (failed > 0)
            throw new Error(`${failed} of ${eligible.length} rows failed`);
          return null;
        },
        errorLabel: "Bulk approve",
        successToast: `Approved ${eligible.length} row${eligible.length === 1 ? "" : "s"}`,
      });
    },
    [actions, clearSelection],
  );

  // Submit All Tailored — mirror of bulk approve, but it enqueues every
  // eligible tailored row for the LOCAL submit runner (per-row /prefill).
  // It is NOT a CI dispatch like "tailor all approved": submit needs a
  // human at the keyboard, so the dashboard only sets intent here.
  const bulkSubmitAll = useCallback(
    (eligible: Job[]) => {
      setConfirmSubmitAll(false);
      if (eligible.length === 0) return;
      void actions.act.run("bulk:submit", {
        perform: async () => {
          const results = await Promise.allSettled(
            eligible.map((j) => actions.submitJob(j)),
          );
          const failed = results.filter(
            (r) => r.status === "rejected" || r.value === null,
          ).length;
          if (failed > 0)
            throw new Error(`${failed} of ${eligible.length} rows failed`);
          return null;
        },
        errorLabel: "Submit all",
        successToast: `Queued ${eligible.length} row${eligible.length === 1 ? "" : "s"} for submit`,
      });
    },
    [actions],
  );

  const bulkSkip = useCallback(
    (targets: Job[], reason: string | null) => {
      setReasonTarget(null);
      void actions.act.run("bulk:skip", {
        perform: async () => {
          const results = await Promise.allSettled(
            targets.map((j) => actions.skipJob(j, reason)),
          );
          clearSelection();
          const failed = results.filter(
            (r) => r.status === "rejected" || r.value === null,
          ).length;
          if (failed > 0)
            throw new Error(`${failed} of ${targets.length} rows failed`);
          return null;
        },
        errorLabel: "Bulk skip",
        successToast: `Skipped ${targets.length} row${targets.length === 1 ? "" : "s"}`,
      });
    },
    [actions, clearSelection],
  );

  /* ── Single-row reject-with-reason ───────────────────────────── */

  const dismissJob = useCallback(
    (job: Job, reason: string | null) => {
      setReasonTarget(null);
      // "new" rows get ignored (restorable); everything else skips via
      // the dedicated endpoint — same semantics the old buttons had,
      // now with an optional analyzer note attached.
      if ((job.status ?? "new") === "new") {
        void actions.setStatus(job, "ignored", {
          notes: reason ?? undefined,
          errorLabel: "Ignore",
        });
      } else {
        void actions.skipJob(job, reason);
      }
    },
    [actions],
  );

  /* ── Tailor dispatch (remembers queued rows this session) ────── */

  const dispatchTailor = useCallback(
    (job: Job) => {
      void actions.tailorJob(job).then((result) => {
        if (result !== null) {
          setTailorQueued((prev) => new Set(prev).add(String(job.id)));
        }
      });
    },
    [actions],
  );

  /* ── Keyboard layer ──────────────────────────────────────────── */

  const modalOpen =
    reasonTarget !== null ||
    confirmApprove !== null ||
    confirmSubmitAll ||
    showHelp;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const idx = cursorId ? orderedIds.indexOf(cursorId) : -1;
      const cursorJob = idx >= 0 ? ordered[idx] : null;

      const moveTo = (i: number) => {
        const clamped = Math.max(0, Math.min(orderedIds.length - 1, i));
        const id = orderedIds[clamped];
        if (!id) return;
        setCursorId(id);
        rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
      };

      switch (e.key) {
        case "j":
          e.preventDefault();
          moveTo(idx < 0 ? 0 : idx + 1);
          break;
        case "k":
          e.preventDefault();
          moveTo(idx < 0 ? 0 : idx - 1);
          break;
        case "a":
          if (cursorJob && (cursorJob.status ?? "new") === "new") {
            e.preventDefault();
            void actions.setStatus(cursorJob, "approved", { errorLabel: "Approve" });
            actions.openPanel(cursorJob);
          }
          break;
        case "s":
          if (cursorJob) {
            e.preventDefault();
            setReasonTarget({ kind: "single", job: cursorJob });
          }
          break;
        case "x":
          if (cursorJob && idx >= 0) {
            e.preventDefault();
            toggleSelect(cursorJob, idx, false);
          }
          break;
        case "Enter":
          if (cursorJob) {
            e.preventDefault();
            const s = cursorJob.status ?? "new";
            if (s === "ready_for_review" || NEEDS_ACTION.has(s)) {
              router.push(`/dashboard/review/${cursorJob.id}`);
            } else {
              actions.openPanel(cursorJob);
            }
          }
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "?":
          e.preventDefault();
          setShowHelp(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, cursorId, ordered, orderedIds, actions, router, toggleSelect]);

  /* ── Render ──────────────────────────────────────────────────── */

  const renderCard = (job: Job, index: number) => (
    <BrowseCard
      key={job.id}
      job={job}
      index={index}
      actions={actions}
      isCursor={cursorId === String(job.id)}
      isSelected={selected.has(String(job.id))}
      tailorQueued={tailorQueued.has(String(job.id))}
      onToggleSelect={toggleSelect}
      onDismiss={(j) => setReasonTarget({ kind: "single", job: j })}
      onTailor={dispatchTailor}
      registerRef={(id, el) => {
        if (el) rowRefs.current.set(id, el);
        else rowRefs.current.delete(id);
      }}
    />
  );

  // Running index across sections so shift-ranges span groups.
  let runningIndex = 0;
  const withIndex = (list: Job[]) =>
    list.map((j) => renderCard(j, runningIndex++));

  const approveEligible = selectedJobs.filter((j) => (j.status ?? "new") === "new");

  // Submit-lane register overview: every tailored row, split into those
  // eligible to enqueue and those blocked (counted by reason for the
  // confirmation copy). Runs over the full jobs list, not the selection.
  const tailoredRows = jobs.filter(
    (j) => (j.status ?? "new") === "ready_for_review",
  );
  const submitEligible = tailoredRows.filter(
    (j) => submitBlockedReason(j) === null,
  );
  const submitSkipCounts = tailoredRows.reduce(
    (acc, j) => {
      const r = submitBlockedReason(j);
      if (r) acc[r] += 1;
      return acc;
    },
    { "no direct link": 0, "no resume": 0 } as Record<SubmitSkipReason, number>,
  );
  const submitSkippedTotal = tailoredRows.length - submitEligible.length;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-serif text-[26px] tracking-tight text-ink">
            Job register
          </h1>
          <p className="mt-0.5 text-[11px] text-ink-faint tabular-nums">
            {loading ? "loading…" : `${filtered.length} of ${jobs.length} rows`}
          </p>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          className="hidden border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint transition-colors duration-150 hover:border-amber hover:text-amber sm:block"
          aria-label="Keyboard shortcuts"
        >
          ? keys
        </button>
      </header>

      <ManualTailorPanel />
      <RunsPanel />

      {/* ── Submit lane (register overview) ─────────────────────────
          Sets intent only — enqueues every eligible tailored row for the
          LOCAL submit runner. Deliberately separate from the CI-dispatch
          buttons in RunsPanel: submit needs a human at the keyboard, so
          there is no "run submit" workflow to dispatch. */}
      {tailoredRows.length > 0 && (
        <section
          aria-label="Submit lane"
          className="mb-6 flex flex-wrap items-center justify-between gap-2 border border-blue-dim bg-bg-raised px-3.5 py-2.5"
        >
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-blue">
              Submit lane
            </span>
            <span className="ml-2 text-[11px] text-ink-dim tabular-nums">
              {submitEligible.length} tailored row
              {submitEligible.length === 1 ? "" : "s"} ready to enqueue
              {submitSkippedTotal > 0 && (
                <span className="text-amber"> · {submitSkippedTotal} blocked</span>
              )}
            </span>
          </div>
          <Btn
            variant="submit"
            pending={actions.act.isPending("bulk:submit")}
            disabled={submitEligible.length === 0}
            onClick={() => setConfirmSubmitAll(true)}
            title={
              submitEligible.length === 0
                ? "No tailored rows have a usable direct link + resume"
                : "Enqueue every eligible tailored row for the local submit runner"
            }
          >
            submit all tailored
          </Btn>
        </section>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <section
        aria-label="Search, filter and sort"
        className="mb-6 flex flex-wrap items-end gap-x-3 gap-y-2 border border-rule bg-bg-raised p-3"
      >
        <Field label="Search — title/company" className="min-w-[200px] flex-1">
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="/"
            className="w-full border border-rule bg-bg px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
          />
        </Field>
        <Field label="Status">
          <Select
            value={filters.statusGroup}
            onChange={(v) => updateFilters({ statusGroup: v as StatusGroup })}
            options={[
              ["all", "all"],
              ["unreviewed", "unreviewed"],
              ["in_progress", "in progress"],
              ["needs_action", "needs action"],
              ["done", "done / archived"],
            ]}
          />
        </Field>
        <Field label="Tier">
          <Select
            value={filters.tier}
            onChange={(v) => updateFilters({ tier: v as Filters["tier"] })}
            options={[
              ["all", "all"],
              ["1", "T1"],
              ["1.5", "T1.5"],
              ["2", "T2"],
              ["3", "T3"],
            ]}
          />
        </Field>
        <Field label="Score">
          <div className="flex items-center gap-1">
            <ScoreInput
              value={filters.scoreMin}
              onChange={(n) => updateFilters({ scoreMin: n })}
              ariaLabel="Minimum score"
            />
            <span className="text-ink-faint">–</span>
            <ScoreInput
              value={filters.scoreMax}
              onChange={(n) => updateFilters({ scoreMax: n })}
              ariaLabel="Maximum score"
            />
          </div>
        </Field>
        <Field label="Source">
          <Select
            value={filters.source}
            onChange={(v) => updateFilters({ source: v })}
            options={[["all", "all"], ...sources.map((s): [string, string] => [s, s])]}
          />
        </Field>
        <Field label="Location">
          <Select
            value={filters.location}
            onChange={(v) => updateFilters({ location: v as Filters["location"] })}
            options={[
              ["local", "local + remote"],
              ["elsewhere", "elsewhere"],
              ["all", "all"],
            ]}
          />
        </Field>
        {degreeGateSupported && (
          <Field label="MS/PhD gate">
            <Select
              value={filters.gate}
              onChange={(v) => updateFilters({ gate: v as GateFilter })}
              options={[
                ["all", "show all"],
                ["hide", "hide gated"],
                ["only", "gated only"],
              ]}
            />
          </Field>
        )}
        <Field label="Sort">
          <Select
            value={filters.sort}
            onChange={(v) => updateFilters({ sort: v as SortKey })}
            options={[
              ["score-desc", "score ↓"],
              ["score-asc", "score ↑"],
              ["date-desc", "newest"],
              ["date-asc", "oldest"],
              ["company-asc", "company a–z"],
            ]}
          />
        </Field>
        {hydrated &&
          JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS) && (
            <Btn variant="ghost" onClick={() => updateFilters(DEFAULT_FILTERS)}>
              reset
            </Btn>
          )}
      </section>

      {/* ── Bulk-selection bar ──────────────────────────────────── */}
      {selectedJobs.length > 0 && (
        <section
          aria-label="Bulk actions"
          className="sticky top-12 z-20 mb-6 flex flex-wrap items-center gap-2 border border-amber-dim bg-bg-raised px-3 py-2"
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber tabular-nums">
            {selectedJobs.length} selected
          </span>
          <Btn
            variant="approve"
            disabled={approveEligible.length === 0}
            pending={actions.act.isPending("bulk:approve")}
            onClick={() => setConfirmApprove(approveEligible)}
            title={
              approveEligible.length === 0
                ? "No selected rows are in 'new'"
                : undefined
            }
          >
            approve {approveEligible.length}
          </Btn>
          <Btn
            variant="danger"
            pending={actions.act.isPending("bulk:skip")}
            onClick={() => setReasonTarget({ kind: "bulk", jobs: selectedJobs })}
          >
            skip {selectedJobs.length}
          </Btn>
          <Btn variant="ghost" onClick={clearSelection} className="ml-auto">
            clear
          </Btn>
        </section>
      )}

      {error && (
        <div className="mb-6 border border-red-dim px-3 py-2 text-xs text-red">
          {error}
        </div>
      )}

      {loading ? (
        <>
          <Skeleton className="mb-3 h-4 w-36" />
          <SkeletonRows rows={6} rowClassName="h-28" />
        </>
      ) : (
        <>
          {/* Action-needed stays rendered even when empty so vertical
              rhythm doesn't shift as rows transition through it. */}
          <section className="mb-8">
            <SectionHeading
              label="Action needed"
              count={actionNeededList.length}
              tone="attention"
            />
            {actionNeededList.length === 0 ? (
              <p className="text-xs text-ink-faint">
                All caught up — no actions waiting.
              </p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {withIndex(actionNeededList)}
              </div>
            )}
          </section>

          {(["1", "1.5", "2", "3", "other"] as const).map((k) => {
            const list = grouped[k];
            if (!list || list.length === 0) return null;
            return (
              <section key={k} className="mb-8">
                <SectionHeading
                  label={k === "other" ? "Untiered" : TIER_LABEL[k]}
                  count={list.length}
                />
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {withIndex(list)}
                </div>
              </section>
            );
          })}

          {filtered.length === 0 && (
            <p className="border border-dashed border-rule px-4 py-8 text-center text-xs text-ink-faint">
              {jobs.length === 0
                ? "No rows yet — run hunt to start."
                : "No rows match the current filters."}
            </p>
          )}
        </>
      )}

      {/* ── Modals ──────────────────────────────────────────────── */}
      {reasonTarget?.kind === "single" && (
        <ReasonPick
          title={`${(reasonTarget.job.status ?? "new") === "new" ? "Ignore" : "Skip"} — ${reasonTarget.job.title} @ ${reasonTarget.job.company}`}
          verb={(reasonTarget.job.status ?? "new") === "new" ? "ignore" : "skip"}
          onPick={(reason) => dismissJob(reasonTarget.job, reason)}
          onCancel={() => setReasonTarget(null)}
        />
      )}
      {reasonTarget?.kind === "bulk" && (
        <ReasonPick
          title={`Skip ${reasonTarget.jobs.length} selected rows — why?`}
          verb="skip all"
          onPick={(reason) => bulkSkip(reasonTarget.jobs, reason)}
          onCancel={() => setReasonTarget(null)}
        />
      )}
      {confirmApprove && (
        <Modal label="Confirm bulk approve" onClose={() => setConfirmApprove(null)}>
          <ModalTitle>Bulk approve</ModalTitle>
          <p className="mb-4 text-xs leading-relaxed text-ink-dim">
            Approve {confirmApprove.length} row
            {confirmApprove.length === 1 ? "" : "s"} currently in &lsquo;new&rsquo;
            {selectedJobs.length > confirmApprove.length &&
              ` (${selectedJobs.length - confirmApprove.length} selected row${
                selectedJobs.length - confirmApprove.length === 1 ? " is" : "s are"
              } not 'new' and will be left untouched)`}
            ?
          </p>
          <div className="flex items-center justify-end gap-2">
            <Btn variant="ghost" onClick={() => setConfirmApprove(null)}>
              cancel
            </Btn>
            <Btn variant="approve" onClick={() => bulkApprove(confirmApprove)}>
              approve {confirmApprove.length}
            </Btn>
          </div>
        </Modal>
      )}
      {confirmSubmitAll && (
        <Modal
          label="Confirm submit all tailored"
          onClose={() => setConfirmSubmitAll(false)}
        >
          <ModalTitle>Submit all tailored</ModalTitle>
          <p className="mb-3 text-xs leading-relaxed text-ink-dim">
            Enqueue {submitEligible.length} tailored row
            {submitEligible.length === 1 ? "" : "s"} for the local submit
            runner. Each opens a visible browser on your machine for you to
            review and submit — nothing is sent automatically.
          </p>
          {submitSkippedTotal > 0 && (
            <p className="mb-4 border border-amber-dim px-3 py-2 text-[11px] leading-relaxed text-amber">
              {submitSkippedTotal} skipped:{" "}
              {[
                submitSkipCounts["no direct link"] > 0 &&
                  `${submitSkipCounts["no direct link"]} no direct link`,
                submitSkipCounts["no resume"] > 0 &&
                  `${submitSkipCounts["no resume"]} no resume`,
              ]
                .filter(Boolean)
                .join(" / ")}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Btn variant="ghost" onClick={() => setConfirmSubmitAll(false)}>
              cancel
            </Btn>
            <Btn
              variant="submit"
              disabled={submitEligible.length === 0}
              onClick={() => bulkSubmitAll(submitEligible)}
            >
              enqueue {submitEligible.length}
            </Btn>
          </div>
        </Modal>
      )}
      {showHelp && <KeysHelp onClose={() => setShowHelp(false)} />}
    </main>
  );
}

/* ── Small toolbar pieces ──────────────────────────────────────────── */

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-rule bg-bg px-2 py-1.5 font-mono text-xs text-ink focus:border-amber focus:outline-none"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function ScoreInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      min={0}
      max={10}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.max(0, Math.min(10, n)));
      }}
      className="w-12 border border-rule bg-bg px-1.5 py-1.5 text-center font-mono text-xs text-ink tabular-nums focus:border-amber focus:outline-none"
    />
  );
}

function SectionHeading({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone?: "attention";
}) {
  return (
    <h2 className="mb-2.5 flex items-baseline gap-2 border-b border-rule-soft pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
      <span className={tone === "attention" && count > 0 ? "text-amber" : undefined}>
        {label}
      </span>
      <span className="tabular-nums">({count})</span>
    </h2>
  );
}

function KeysHelp({ onClose }: { onClose: () => void }) {
  const keys: [string, string][] = [
    ["j / k", "move row cursor"],
    ["a", "approve row under cursor"],
    ["s", "skip / ignore with reason"],
    ["enter", "open review / match panel"],
    ["x", "toggle row selection"],
    ["shift+click", "select range"],
    ["/", "focus search"],
    ["1–4", "pick reason in skip dialog"],
    ["esc", "close dialogs / blur inputs"],
  ];
  return (
    <Modal label="Keyboard shortcuts" onClose={onClose}>
      <ModalTitle>Keyboard</ModalTitle>
      <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-xs">
        {keys.map(([k, desc]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-amber">{k}</dt>
            <dd className="text-ink-dim">{desc}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex justify-end">
        <Btn variant="ghost" onClick={onClose}>
          close
        </Btn>
      </div>
    </Modal>
  );
}

/* ── Card ──────────────────────────────────────────────────────────── */

function BrowseCard({
  job,
  index,
  actions,
  isCursor,
  isSelected,
  tailorQueued,
  onToggleSelect,
  onDismiss,
  onTailor,
  registerRef,
}: {
  job: Job;
  index: number;
  actions: JobActions;
  isCursor: boolean;
  isSelected: boolean;
  tailorQueued: boolean;
  onToggleSelect: (job: Job, index: number, shiftKey: boolean) => void;
  onDismiss: (job: Job) => void;
  onTailor: (job: Job) => void;
  registerRef: (id: string, el: HTMLElement | null) => void;
}) {
  const id = String(job.id);
  const tone = statusTone(job.status);
  const stripe = toneStripeVar(tone);
  const muted = isTerminalMuted(job.status);
  const score = scoreOf(job.score);
  const age = relativeTime(job.created_at);

  return (
    <article
      ref={(el) => registerRef(id, el)}
      className={[
        "flex flex-col gap-2 border bg-bg-raised p-3.5 transition-colors duration-150",
        isCursor ? "border-amber" : isSelected ? "border-amber-dim" : "border-rule",
        isSelected ? "bg-bg-card" : "",
        muted ? "opacity-60" : "",
      ]
        .join(" ")
        .trim()}
      style={stripe ? { borderLeft: `2px solid ${stripe}` } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <input
            type="checkbox"
            checked={isSelected}
            aria-label={`Select ${job.title}`}
            onChange={() => undefined}
            onClick={(e) => onToggleSelect(job, index, e.shiftKey)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber"
          />
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={job.status} />
              <LifecyclePill status={job.status} />
              <TierPill tier={job.tier} />
              <DegreeGatePill gated={job.degree_gated} />
              <LocationBadge location={job.location} />
              {age && (
                <span className="text-[10px] text-ink-faint tabular-nums">{age}</span>
              )}
            </div>
            <h3 className="truncate text-[13px] font-medium text-ink">{job.title}</h3>
            <p className="truncate text-xs text-ink-dim">
              {job.company}
              {job.location ? ` · ${job.location}` : ""}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-lg text-ink tabular-nums">{score ?? "—"}</span>
          <span className="text-[10px] text-ink-faint">/10</span>
        </div>
      </div>

      {job.reasoning && (
        <p className="line-clamp-3 text-[11px] leading-relaxed text-ink-faint">
          {job.reasoning}
        </p>
      )}

      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
        <ActionButtons
          job={job}
          actions={actions}
          tailorQueued={tailorQueued}
          onDismiss={onDismiss}
          onTailor={onTailor}
        />
        <div className="ml-auto flex items-center gap-1.5">
          {job.source && <Pill tone="dim">{job.source}</Pill>}
          <AdapterBadge atsKind={job.ats_kind} />
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="px-1 text-[11px] text-ink-faint transition-colors duration-150 hover:text-ink"
            >
              posting ↗
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function ActionButtons({
  job,
  actions,
  tailorQueued,
  onDismiss,
  onTailor,
}: {
  job: Job;
  actions: JobActions;
  tailorQueued: boolean;
  onDismiss: (job: Job) => void;
  onTailor: (job: Job) => void;
}) {
  const { act, setStatus, submitJob, openPanel } = actions;
  const s = job.status ?? "new";
  const statusKey = `status:${job.id}`;
  const tailorKey = `tailor:${job.id}`;
  const statusPending = act.isPending(statusKey);
  const statusFlash = act.isFlashing(statusKey);

  switch (s) {
    case "new":
      return (
        <div className="flex items-center gap-1.5">
          <Btn
            variant="approve"
            pending={statusPending}
            flash={statusFlash}
            onClick={() => {
              void setStatus(job, "approved", { errorLabel: "Approve" });
              openPanel(job);
            }}
          >
            approve
          </Btn>
          <Btn variant="ghost" onClick={() => onDismiss(job)}>
            ignore
          </Btn>
        </div>
      );

    case "approved":
      if (tailorQueued) {
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] italic text-green">tailor queued…</span>
            <Btn
              variant="ghost"
              pending={statusPending}
              onClick={() => void setStatus(job, "new", { errorLabel: "Undo" })}
            >
              undo
            </Btn>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-1.5">
          <Btn
            variant="primary"
            pending={act.isPending(tailorKey)}
            flash={act.isFlashing(tailorKey)}
            onClick={() => onTailor(job)}
          >
            tailor
          </Btn>
          <Btn
            variant="ghost"
            pending={statusPending}
            onClick={() => void setStatus(job, "new", { errorLabel: "Undo" })}
          >
            undo
          </Btn>
        </div>
      );

    case "preparing":
      return (
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] italic text-green">
            <span className="h-1.5 w-1.5 rounded-full bg-green motion-safe:animate-pulse" />
            agent tailoring…
          </span>
          <Btn
            variant="ghost"
            pending={statusPending}
            onClick={() => void setStatus(job, "new", { errorLabel: "Undo" })}
          >
            undo
          </Btn>
        </div>
      );

    case "ready_for_review": {
      // Third lane action: enqueue this tailored row for the local submit
      // runner. Blocked (no usable link / no resume) → disabled with a
      // reason, never silently enqueued. Optimistically moves to
      // prefilling; the runner carries it to awaiting_human_submit.
      const submitKey = `submit:${job.id}`;
      const blocked = submitBlockedReason(job);
      return (
        <div className="flex items-center gap-1.5">
          <Link
            href={`/dashboard/review/${job.id}`}
            className={btnLinkClass("primary")}
          >
            review materials
          </Link>
          <Btn
            variant="submit"
            pending={act.isPending(submitKey)}
            flash={act.isFlashing(submitKey)}
            disabled={blocked !== null}
            title={
              blocked
                ? `Can't submit — ${blocked}. Pre-fill needs a usable direct link and a generated resume.`
                : "Enqueue for the local submit runner (no browser opens here)"
            }
            onClick={() => void submitJob(job)}
          >
            submit
          </Btn>
          <Btn
            variant="danger"
            pending={statusPending}
            onClick={() => onDismiss(job)}
          >
            skip
          </Btn>
        </div>
      );
    }

    case "prefilling":
      return (
        <span className="flex items-center gap-1.5 text-[11px] italic text-green">
          <span className="h-1.5 w-1.5 rounded-full bg-green motion-safe:animate-pulse" />
          staging for submit…
        </span>
      );

    case "awaiting_human_submit":
      // Staged locally — the next move (review the pre-filled browser,
      // submit, mark applied) lives in the cockpit. Link straight there.
      return (
        <div className="flex items-center gap-1.5">
          <Link
            href={`/dashboard/review/${job.id}`}
            className={btnLinkClass("submit")}
          >
            finish submit ↗
          </Link>
          <Btn
            variant="danger"
            pending={statusPending}
            onClick={() => onDismiss(job)}
          >
            skip
          </Btn>
        </div>
      );

    case "applied":
      return (
        <span className="text-[11px] text-green">
          applied {relativeTime(job.applied_at) ?? ""}
        </span>
      );

    case "failed":
      return (
        <div className="flex items-center gap-1.5">
          <span
            className="max-w-[200px] truncate text-[11px] text-red"
            title={job.failure_reason ?? undefined}
          >
            failed{job.failure_reason ? `: ${job.failure_reason}` : ""}
          </span>
          <Btn
            variant="secondary"
            pending={statusPending}
            flash={statusFlash}
            onClick={() => void setStatus(job, "approved", { errorLabel: "Retry" })}
          >
            retry
          </Btn>
        </div>
      );

    case "ignored":
    case "skipped":
      return (
        <Btn
          variant="ghost"
          pending={statusPending}
          flash={statusFlash}
          onClick={() => void setStatus(job, "new", { errorLabel: "Restore" })}
        >
          restore
        </Btn>
      );

    default:
      return null;
  }
}
