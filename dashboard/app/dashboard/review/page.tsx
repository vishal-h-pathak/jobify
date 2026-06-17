"use client";

/**
 * /dashboard/review — Submit lane.
 *
 * The single surface for every job the human still owns in the back half
 * of the lifecycle. Two stages, pinned in order:
 *
 *   - awaiting_human_submit — staged locally: the submit runner pre-filled
 *     the form in a visible browser and is waiting for the human to review,
 *     submit, and confirm. Quick actions live here (Submitted ✓ → Next,
 *     Skip) so the common case never needs the full cockpit.
 *   - ready_for_review — tailored: materials are generated but the row
 *     hasn't been staged yet. The cockpit's Pre-fill is the next step.
 *
 * Each row shows the verification summary the runner wrote (filled X /
 * needs Y, plus the free-text notes) so the user can see what a staged
 * job still needs before opening it, and links straight to the materials
 * cockpit (/dashboard/review/[job_id]) and the resume PDF — the materials
 * preview is reused, never rebuilt here.
 *
 * Quick actions go through the existing per-job routes (mark-applied /
 * skip) via useOptimisticAction: the row leaves the list the instant you
 * act, with a visible rollback + toast if the write fails.
 *
 * Reads via /api/dashboard/jobs?view=review-queue behind the same
 * dashboard_auth cookie that protects the rest of /dashboard/*.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Job } from "../../lib/supabase";
import { Btn, BtnLink, btnLinkClass } from "../components/Button";
import DashboardNav from "../components/DashboardNav";
import {
  ConfidenceBadge,
  LifecyclePill,
  StatusBadge,
} from "../components/JobBadges";
import { Skeleton, SkeletonRows } from "../components/Skeleton";
import { requestJSON } from "../lib/api";
import { useOptimisticAction } from "../lib/useOptimisticAction";
import { relativeTime } from "../lib/format";

export default function ReviewQueuePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const act = useOptimisticAction();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/jobs?view=review-queue", {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => ({}))) as {
          jobs?: Job[];
          error?: string;
        };
        if (!res.ok) setError(json.error ?? `Failed to load queue (${res.status})`);
        else setJobs(json.jobs ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setLoading(false);
    })();
  }, []);

  // Split by lifecycle stage. The server already sorts each by
  // status_updated_at (most recent first); staged rows pin to the top.
  const staged = useMemo(
    () => jobs.filter((j) => (j.status ?? "new") === "awaiting_human_submit"),
    [jobs],
  );
  const tailored = useMemo(
    () => jobs.filter((j) => (j.status ?? "new") === "ready_for_review"),
    [jobs],
  );

  // Drop a row from the local list once its quick action lands. The
  // optimistic remove paints instantly; a failed write rolls it back in
  // place and the toast (via useOptimisticAction) explains why.
  function removeLocally(id: Job["id"]) {
    const before = jobs;
    setJobs((prev) => prev.filter((j) => j.id !== id));
    return () => setJobs(before);
  }

  function markApplied(job: Job) {
    void act.run(`mark-applied:${job.id}`, {
      optimistic: () => removeLocally(job.id),
      perform: () =>
        requestJSON("POST", `/api/dashboard/jobs/${job.id}/mark-applied`, {}),
      errorLabel: "Mark applied",
      successToast: `Marked applied — ${job.company}`,
    });
  }

  function skip(job: Job) {
    void act.run(`skip:${job.id}`, {
      optimistic: () => removeLocally(job.id),
      perform: () =>
        requestJSON("POST", `/api/dashboard/jobs/${job.id}/skip`, {
          reason: "skipped from submit lane",
        }),
      errorLabel: "Skip",
    });
  }

  return (
    <>
      <DashboardNav />
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="mb-6">
          <h1 className="font-serif text-[26px] tracking-tight text-ink">
            Submit lane
          </h1>
          <p className="mt-0.5 text-[11px] text-ink-faint tabular-nums">
            {loading
              ? "loading…"
              : jobs.length === 0
                ? "nothing waiting"
                : `${staged.length} staged · ${tailored.length} tailored`}
          </p>
        </header>

        {error && (
          <div className="mb-6 border border-red-dim px-3 py-2 text-xs text-red">
            {error}
          </div>
        )}

        {loading ? (
          <>
            <Skeleton className="mb-3 h-4 w-28" />
            <SkeletonRows rows={4} rowClassName="h-28" />
          </>
        ) : (
          <>
            {jobs.length === 0 && !error && (
              <p className="border border-dashed border-rule px-4 py-8 text-center text-xs text-ink-faint">
                Lane empty — tailored jobs land here for review, then move to
                staged once you enqueue them for submit.
              </p>
            )}

            {/* Staged-and-waiting pins to the top: these need a human to
                submit in the already-open browser, then confirm. */}
            {staged.length > 0 && (
              <Section
                label="Awaiting your submit"
                hint="pre-filled locally — submit in the open browser, then confirm"
                count={staged.length}
              >
                {staged.map((job) => (
                  <SubmitLaneRow
                    key={job.id}
                    job={job}
                    stage="staged"
                    onMarkApplied={() => markApplied(job)}
                    onSkip={() => skip(job)}
                    markPending={act.isPending(`mark-applied:${job.id}`)}
                    skipPending={act.isPending(`skip:${job.id}`)}
                  />
                ))}
              </Section>
            )}

            {tailored.length > 0 && (
              <Section
                label="Ready to stage"
                hint="materials tailored — open to pre-fill the form"
                count={tailored.length}
              >
                {tailored.map((job) => (
                  <SubmitLaneRow
                    key={job.id}
                    job={job}
                    stage="tailored"
                    onMarkApplied={() => markApplied(job)}
                    onSkip={() => skip(job)}
                    markPending={act.isPending(`mark-applied:${job.id}`)}
                    skipPending={act.isPending(`skip:${job.id}`)}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Section({
  label,
  hint,
  count,
  children,
}: {
  label: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-rule-soft pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
        <span className="text-amber">{label}</span>
        <span className="tabular-nums">({count})</span>
        <span className="ml-auto normal-case tracking-normal text-ink-faint">
          {hint}
        </span>
      </h2>
      <ul className="grid gap-2.5">{children}</ul>
    </section>
  );
}

/**
 * VerificationSummary — what the submit runner reported about a staged
 * row. Prefers the structured packet counts (filled / needs attention)
 * and surfaces the free-text notes the runner wrote ("filled X of Y;
 * needs: …"). Falls back quietly when a row hasn't been staged yet.
 */
function VerificationSummary({ job }: { job: Job }) {
  const filled = job.submission_log?.filled_fields?.length ?? null;
  const skipped = job.submission_log?.skipped_fields?.length ?? null;
  const notes = job.application_notes?.trim() || null;

  if (filled === null && skipped === null && !notes) {
    return (
      <p className="text-[11px] italic text-ink-faint">
        No verification summary yet — pre-fill to populate it.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {(filled !== null || skipped !== null) && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
          {filled !== null && (
            <span className="text-green">{filled} filled</span>
          )}
          {skipped !== null && (
            <span className={skipped > 0 ? "text-amber" : "text-ink-faint"}>
              {skipped} need{skipped === 1 ? "s" : ""} attention
            </span>
          )}
        </div>
      )}
      {notes && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-dim">
          {notes}
        </p>
      )}
    </div>
  );
}

function SubmitLaneRow({
  job,
  stage,
  onMarkApplied,
  onSkip,
  markPending,
  skipPending,
}: {
  job: Job;
  stage: "staged" | "tailored";
  onMarkApplied: () => void;
  onSkip: () => void;
  markPending: boolean;
  skipPending: boolean;
}) {
  const stripe = stage === "staged" ? "var(--blue)" : "var(--amber)";
  const cockpitHref = `/dashboard/review/${job.id}`;
  const busy = markPending || skipPending;

  return (
    <li
      className="border border-rule bg-bg-raised p-3.5"
      style={{ borderLeft: `2px solid ${stripe}` }}
    >
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={job.status} />
          <LifecyclePill status={job.status} />
          <ConfidenceBadge
            c={job.submission_log?.confidence ?? job.confidence ?? null}
          />
          {relativeTime(job.status_updated_at) && (
            <span className="text-[10px] text-ink-faint tabular-nums">
              {relativeTime(job.status_updated_at)}
            </span>
          )}
        </div>
        <Link
          href={cockpitHref}
          className="block truncate text-[13px] font-medium text-ink transition-colors duration-150 hover:text-amber"
        >
          {job.title}
        </Link>
        <div className="truncate text-xs text-ink-dim">
          {job.company}
          {job.location ? ` · ${job.location}` : ""}
        </div>
        <div className="mt-2">
          <VerificationSummary job={job} />
        </div>
      </div>

      {/* Materials reuse: link to the cockpit (full preview, never
          rebuilt) and the resume PDF so a one-page check needs no
          navigation. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule-soft pt-3">
        <Link href={cockpitHref} className={btnLinkClass("primary")}>
          review materials
        </Link>
        {job.resume_pdf_path && (
          <BtnLink
            href={`/api/materials/${job.id}/resume`}
            target="_blank"
            rel="noreferrer"
          >
            resume ↗
          </BtnLink>
        )}

        {stage === "staged" && (
          <div className="ml-auto flex items-center gap-1.5">
            <Btn
              variant="approve"
              pending={markPending}
              disabled={busy}
              onClick={onMarkApplied}
              title="Confirm you submitted this in the open browser"
            >
              submitted ✓ → next
            </Btn>
            <Btn
              variant="secondary"
              pending={skipPending}
              disabled={busy}
              onClick={onSkip}
            >
              skip
            </Btn>
          </div>
        )}
      </div>
    </li>
  );
}
