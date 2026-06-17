"use client";

/**
 * /dashboard — overview register.
 *
 * Owns the jobs list state and every job mutation; BrowseView and
 * SwipeView render against it. All writes go through useOptimisticAction
 * (instant local update → reconcile → visible rollback + toast on
 * failure), so the list never does a whole-page refetch after an action.
 *
 * Server search: the toolbar's free-text query is debounced here and
 * re-hits /api/dashboard/jobs?view=list&q=… (title/company ilike).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job, JobStatus } from "../lib/supabase";
import BrowseView from "./BrowseView";
import DashboardNav from "./components/DashboardNav";
import { LocationBadge, TierPill } from "./components/JobBadges";
import { Skeleton, SkeletonRows } from "./components/Skeleton";
import { requestJSON } from "./lib/api";
import {
  locationBucket,
  relativeTime,
  scoreOf,
  tierKey,
  TIER_LABEL,
  type LocationBucket,
  type TierKey,
} from "./lib/format";
import { loadPref, savePref } from "./lib/prefs";
import { useOptimisticAction } from "./lib/useOptimisticAction";

type ViewMode = "swipe" | "browse";

const VIEW_STORAGE_KEY = "dashboard:viewMode";
const SEARCH_STORAGE_KEY = "dashboard:browse:search";
const SEARCH_DEBOUNCE_MS = 300;

export type JobActions = {
  act: ReturnType<typeof useOptimisticAction>;
  /** PATCH status (+ optional analyzer note), optimistic. */
  setStatus: (
    job: Job,
    status: JobStatus,
    opts?: { notes?: string; errorLabel?: string; successToast?: string },
  ) => Promise<unknown>;
  /** POST /skip with optional reason, optimistic. */
  skipJob: (job: Job, reason: string | null) => Promise<unknown>;
  /** POST /runs/tailor for one row. */
  tailorJob: (job: Job) => Promise<unknown>;
  /** POST /prefill — enqueue a tailored row for the local submit runner,
   *  optimistically moving it toward awaiting_human_submit. Intent only;
   *  no browser launch, no CI dispatch. */
  submitJob: (job: Job) => Promise<unknown>;
  openPanel: (job: Job) => void;
};

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [degreeGateSupported, setDegreeGateSupported] = useState(false);
  const [view, setView] = useState<ViewMode | null>(null);
  const [search, setSearch] = useState<string>(
    () => loadPref(SEARCH_STORAGE_KEY, { q: "" }).q,
  );

  const act = useOptimisticAction();

  const jobsRef = useRef<Job[]>(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode | null;
    if (stored === "swipe" || stored === "browse") setView(stored);
    else setView(window.innerWidth < 768 ? "swipe" : "browse");
  }, []);

  const fetchJobs = useCallback(async (q: string) => {
    try {
      const json = await requestJSON<{
        jobs?: Job[];
        degree_gated_supported?: boolean;
      }>(
        "GET",
        `/api/dashboard/jobs?view=list${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      );
      setJobs(json.jobs ?? []);
      setDegreeGateSupported(json.degree_gated_supported ?? false);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  // Initial load + debounced server search.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      void fetchJobs(search);
      return;
    }
    const t = window.setTimeout(() => {
      savePref(SEARCH_STORAGE_KEY, { q: search });
      void fetchJobs(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function chooseView(v: ViewMode) {
    setView(v);
    localStorage.setItem(VIEW_STORAGE_KEY, v);
  }

  const patchLocal = useCallback((id: Job["id"], patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const optimisticPatch = useCallback(
    (id: Job["id"], patch: Partial<Job>) => {
      const before = jobsRef.current.find((j) => j.id === id);
      patchLocal(id, patch);
      return () => {
        if (before) {
          setJobs((prev) => prev.map((j) => (j.id === id ? before : j)));
        }
      };
    },
    [patchLocal],
  );

  const setStatus: JobActions["setStatus"] = useCallback(
    (job, status, opts) => {
      const body: Record<string, unknown> = { status };
      const patch: Partial<Job> = { status };
      if (opts?.notes !== undefined && opts.notes !== null) {
        body.application_notes = opts.notes;
        patch.application_notes = opts.notes;
      }
      return act.run(`status:${job.id}`, {
        optimistic: () => optimisticPatch(job.id, patch),
        perform: () =>
          requestJSON("PATCH", `/api/dashboard/jobs/${job.id}`, body),
        errorLabel: opts?.errorLabel ?? "Update",
        successToast: opts?.successToast,
      });
    },
    [act, optimisticPatch],
  );

  const skipJob: JobActions["skipJob"] = useCallback(
    (job, reason) =>
      act.run(`status:${job.id}`, {
        optimistic: () =>
          optimisticPatch(job.id, {
            status: "skipped",
            ...(reason ? { application_notes: reason } : {}),
          }),
        perform: () =>
          requestJSON(
            "POST",
            `/api/dashboard/jobs/${job.id}/skip`,
            reason ? { reason } : {},
          ),
        errorLabel: "Skip",
      }),
    [act, optimisticPatch],
  );

  const tailorJob: JobActions["tailorJob"] = useCallback(
    (job) =>
      act.run(`tailor:${job.id}`, {
        perform: () =>
          requestJSON("POST", "/api/dashboard/runs/tailor", {
            job_id: job.id,
          }),
        errorLabel: "Tailor",
        successToast: `Tailor queued — ${job.company}`,
      }),
    [act],
  );

  // Submit lane: enqueue a tailored (ready_for_review) row for the
  // local submit runner via the existing /prefill route, which flips it
  // to `prefilling`. We optimistically paint that move so the card
  // advances immediately; the runner takes it to awaiting_human_submit.
  // The dashboard never opens a browser or dispatches CI for submit.
  const submitJob: JobActions["submitJob"] = useCallback(
    (job) =>
      act.run(`submit:${job.id}`, {
        optimistic: () => optimisticPatch(job.id, { status: "prefilling" }),
        perform: () =>
          requestJSON("POST", `/api/dashboard/jobs/${job.id}/prefill`, {}),
        errorLabel: "Submit",
        successToast: `Queued for submit — ${job.company}`,
      }),
    [act, optimisticPatch],
  );

  // The triage list no longer opens an inline panel: the per-job detail
  // surface is the review cockpit at /dashboard/review/[job_id], reached
  // from the cards/keyboard shortcuts that already route there. Approve
  // simply advances the row's status. Kept on the actions contract as a
  // no-op so BrowseView/SwipeView callers stay unchanged.
  const openPanel = useCallback((_job: Job) => {}, []);

  const actions: JobActions = useMemo(
    () => ({ act, setStatus, skipJob, tailorJob, submitJob, openPanel }),
    [act, setStatus, skipJob, tailorJob, submitJob, openPanel],
  );

  if (view === null || (loading && view === null)) {
    return <main className="min-h-screen bg-bg" />;
  }

  return (
    <>
      <DashboardNav
        rightSlot={<ViewToggle view={view} onChange={chooseView} />}
      />
      {view === "swipe" ? (
        loading ? (
          <SwipeSkeleton />
        ) : (
          <SwipeView
            jobs={jobs}
            error={loadError}
            actions={actions}
          />
        )
      ) : (
        <BrowseView
          jobs={jobs}
          loading={loading}
          error={loadError}
          actions={actions}
          degreeGateSupported={degreeGateSupported}
          search={search}
          onSearch={setSearch}
        />
      )}
    </>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="inline-flex border border-rule">
      {(["browse", "swipe"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={
            "px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 " +
            (view === v
              ? "bg-bg-raised text-amber"
              : "text-ink-faint hover:text-ink")
          }
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Swipe view (mobile triage) ---------------- */

function SwipeSkeleton() {
  return (
    <main className="mx-auto min-h-screen max-w-sm px-6 py-10">
      <Skeleton className="mb-6 h-7 w-40" />
      <SkeletonRows rows={4} rowClassName="h-14" />
    </main>
  );
}

type TierFilter = "all" | TierKey;

function SwipeView({
  jobs,
  error,
  actions,
}: {
  jobs: Job[];
  error: string | null;
  actions: JobActions;
}) {
  const [tierFilter, setTierFilter] = useState<TierFilter | null>(null);
  const [index, setIndex] = useState(0);
  const [bucket, setBucket] = useState<LocationBucket>("local");

  const queue = useMemo(() => {
    if (tierFilter === null) return [];
    return jobs.filter((j) => {
      if ((j.status ?? "new") !== "new") return false;
      if (tierFilter !== "all" && tierKey(j.tier) !== tierFilter) return false;
      if (locationBucket(j.location) !== bucket) return false;
      return true;
    });
  }, [jobs, tierFilter, bucket]);

  const tierCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0, "1": 0, "1.5": 0, "2": 0, "3": 0 };
    jobs.forEach((j) => {
      if ((j.status ?? "new") !== "new") return;
      if (locationBucket(j.location) !== bucket) return;
      c.all += 1;
      const k = tierKey(j.tier);
      if (k) c[k] += 1;
    });
    return c;
  }, [jobs, bucket]);

  function changeBucket(b: LocationBucket) {
    setBucket(b);
    setIndex(0);
  }

  function handleSwipe(job: Job, direction: "left" | "right") {
    if (direction === "right") {
      void actions.setStatus(job, "approved", { errorLabel: "Approve" });
      actions.openPanel(job);
    } else {
      void actions.setStatus(job, "ignored", { errorLabel: "Ignore" });
    }
    setIndex((i) => i + 1);
  }

  if (tierFilter === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 font-serif text-2xl tracking-tight text-ink">
            Triage
          </h1>
          <p className="mb-5 text-xs text-ink-faint">Pick a tier to start.</p>
          <div className="mb-5">
            <BucketToggle bucket={bucket} onChange={changeBucket} />
          </div>
          {error && (
            <div className="mb-4 border border-red-dim px-3 py-2 text-xs text-red">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <TierButton
              label="All tiers"
              count={tierCounts.all}
              onClick={() => setTierFilter("all")}
            />
            {(["1", "1.5", "2", "3"] as const).map((t) => (
              <TierButton
                key={t}
                label={TIER_LABEL[t]}
                count={tierCounts[t]}
                onClick={() => setTierFilter(t)}
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  const current = queue[index];
  const next = queue[index + 1];
  const remaining = queue.length - index;

  return (
    <main className="flex min-h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-5">
        <button
          onClick={() => {
            setTierFilter(null);
            setIndex(0);
          }}
          className="text-xs text-ink-faint transition-colors duration-150 hover:text-ink"
        >
          ← tiers
        </button>
        <span className="text-[11px] text-ink-faint tabular-nums">
          {current ? `${index + 1} / ${queue.length}` : `${queue.length} done`}
        </span>
      </header>

      <div className="shrink-0 px-4 pb-2">
        <BucketToggle bucket={bucket} onChange={changeBucket} />
      </div>

      <div className="relative flex-1 px-4 pb-4">
        {current ? (
          <>
            {next && <SwipeCard key={`next-${next.id}`} job={next} behind />}
            <SwipeCard
              key={`cur-${current.id}`}
              job={current}
              onSwipe={(dir) => handleSwipe(current, dir)}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-xs text-ink-faint">
            <div>
              <div className="mb-2">No more jobs in this tier.</div>
              <button
                onClick={() => {
                  setTierFilter(null);
                  setIndex(0);
                }}
                className="text-ink underline underline-offset-4"
              >
                Pick another tier
              </button>
            </div>
          </div>
        )}
      </div>

      {current && (
        <div className="flex shrink-0 items-center justify-center gap-10 pb-10 pt-2">
          <button
            onClick={() => handleSwipe(current, "left")}
            aria-label="Skip"
            className="flex h-16 w-16 items-center justify-center border border-rule bg-bg-raised text-xl text-red transition-colors duration-150 hover:border-red active:duration-0"
          >
            ✕
          </button>
          <button
            onClick={() => handleSwipe(current, "right")}
            aria-label="Interested"
            className="flex h-16 w-16 items-center justify-center border border-rule bg-bg-raised text-xl text-green transition-colors duration-150 hover:border-green active:duration-0"
          >
            ✓
          </button>
        </div>
      )}

      <div className="shrink-0 px-4 pb-3 text-center text-[10px] uppercase tracking-[0.18em] text-ink-faint">
        {remaining > 0 && `${remaining} left`}
      </div>
    </main>
  );
}

function BucketToggle({
  bucket,
  onChange,
}: {
  bucket: LocationBucket;
  onChange: (b: LocationBucket) => void;
}) {
  return (
    <div className="inline-flex border border-rule">
      {(["local", "elsewhere"] as const).map((b) => (
        <button
          key={b}
          onClick={() => onChange(b)}
          aria-pressed={bucket === b}
          className={
            "px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 " +
            (bucket === b
              ? b === "local"
                ? "bg-bg-raised text-green"
                : "bg-bg-raised text-ink"
              : "text-ink-faint hover:text-ink")
          }
        >
          {b === "local" ? "local/remote" : "elsewhere"}
        </button>
      ))}
    </div>
  );
}

function TierButton({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={count === 0}
      className="flex w-full items-center justify-between border border-rule bg-bg-raised px-4 py-3.5 text-left text-xs text-ink transition-colors duration-150 hover:border-amber disabled:opacity-40"
    >
      <span>{label}</span>
      <span className="text-[11px] text-ink-faint tabular-nums">{count}</span>
    </button>
  );
}

function SwipeCard({
  job,
  onSwipe,
  behind,
}: {
  job: Job;
  onSwipe?: (dir: "left" | "right") => void;
  behind?: boolean;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [flying, setFlying] = useState<"left" | "right" | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const interactive = !!onSwipe && !behind;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || flying) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0 });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || flying) return;
    const start = startRef.current;
    if (!start) return;
    setDrag({ x: e.clientX - start.x, y: e.clientY - start.y });
  }

  function onPointerUp() {
    if (!interactive || flying) return;
    const d = drag;
    startRef.current = null;
    if (!d) return;
    const threshold = 110;
    if (d.x > threshold) {
      setFlying("right");
      setTimeout(() => onSwipe?.("right"), 280);
    } else if (d.x < -threshold) {
      setFlying("left");
      setTimeout(() => onSwipe?.("left"), 280);
    } else {
      setDrag(null);
    }
  }

  const dx = flying === "right" ? 600 : flying === "left" ? -600 : drag?.x ?? 0;
  const dy = drag?.y ?? 0;
  const rot = dx / 18;
  const opacity = flying ? 0 : 1;
  const score = scoreOf(job.score);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute inset-4 flex select-none flex-col border border-rule bg-bg-raised p-6 ${
        behind ? "pointer-events-none" : "touch-none cursor-grab active:cursor-grabbing"
      }`}
      style={{
        transform: behind
          ? "scale(0.97) translateY(10px)"
          : `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
        opacity: behind ? 0.5 : opacity,
        transition:
          flying || (!drag && !behind)
            ? "transform 280ms ease-out, opacity 280ms ease-out"
            : behind
            ? "transform 200ms ease-out"
            : "none",
        zIndex: behind ? 1 : 2,
      }}
    >
      {!behind && drag && Math.abs(drag.x) > 20 && (
        <div
          className={`absolute top-6 border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] ${
            drag.x > 0
              ? "left-6 border-green text-green"
              : "right-6 border-red text-red"
          }`}
          style={{ opacity: Math.min(1, Math.abs(drag.x) / 110) }}
        >
          {drag.x > 0 ? "approve" : "skip"}
        </div>
      )}

      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TierPill tier={job.tier} />
          <LocationBadge location={job.location} />
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            Score
          </div>
          <div className="text-xl text-ink tabular-nums">
            {score ?? "—"}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <h2 className="text-base font-medium leading-tight text-ink">
          {job.title}
        </h2>
        <p className="mt-1 text-xs text-ink-dim">
          {job.company}
          {job.location ? ` · ${job.location}` : ""}
        </p>
        {relativeTime(job.created_at) && (
          <p className="mt-1 text-[11px] text-ink-faint tabular-nums">
            found {relativeTime(job.created_at)}
          </p>
        )}
      </div>

      {job.reasoning && (
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            Why it matched
          </div>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-dim">
            {job.reasoning}
          </p>
        </div>
      )}

      {job.url && !behind && (
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="mt-4 self-start text-xs text-ink-faint transition-colors duration-150 hover:text-ink"
        >
          View posting ↗
        </a>
      )}
    </div>
  );
}
