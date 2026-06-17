"use client";

/**
 * /dashboard/review/[job_id] — M-6 manual-submission cockpit.
 *
 * The dashboard's source of truth for whether a job got submitted is the
 * "Mark Applied" click here. The system never auto-applies — the
 * orchestrator (M-5) leaves a visible browser open on the user's local
 * machine; the user reviews, clicks Submit themselves, then comes back
 * here and clicks Mark Applied.
 *
 * Responsiveness contract (v2): every action applies its status
 * transition optimistically (banner + action bar react instantly),
 * then a silent targeted refetch converges the row — the page-level
 * loading state only exists for first load (skeleton, no spinner).
 *
 * Sections:
 *   - Header (title / company / score / tier / archetype / legitimacy)
 *   - Status banner (per-state message describing what to do next)
 *   - Materials accordions (resume PDF, cover letter, form-answer drafts)
 *   - Pre-fill screenshot (when set)
 *   - Match Agent panel (J-11 — unchanged)
 *   - Action bar: Pre-fill, Mark Applied (modal), Open Manually,
 *     Skip (reason quick-pick), Mark Failed (reason modal)
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  FormAnswers,
  FormAnswerQuestion,
  Job,
  JobStatus,
} from "../../../lib/supabase";
import { Btn, BtnLink } from "../../components/Button";
import DashboardNav from "../../components/DashboardNav";
import { Pill, TierPill } from "../../components/JobBadges";
import { Modal, ModalTitle } from "../../components/Modal";
import { ReasonPick } from "../../components/ReasonPick";
import { Skeleton, SkeletonRows } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { requestJSON } from "../../lib/api";
import { relativeTime, scoreOf } from "../../lib/format";
import { useOptimisticAction } from "../../lib/useOptimisticAction";

// ── Status banner copy ─────────────────────────────────────────────────────

const STATUS_BANNER: Partial<
  Record<
    JobStatus,
    { tone: "info" | "warn" | "ok" | "danger"; message: string }
  >
> = {
  ready_for_review: {
    tone: "info",
    message:
      "Tailored materials are ready. Review the resume, cover letter, " +
      "and form-answer drafts. When ready, click Pre-fill Form.",
  },
  prefilling: {
    tone: "warn",
    message:
      "Pre-fill in progress. Wait for the browser window to open on " +
      "your local machine, then return here to mark applied.",
  },
  awaiting_human_submit: {
    tone: "warn",
    message:
      "Form pre-filled in your browser. Review what was typed, fix " +
      "any errors, click Submit. Then come back and click Mark Applied below.",
  },
  applied: { tone: "ok", message: "Marked applied." },
  failed: {
    tone: "danger",
    message:
      "Pre-fill failed. See screenshot below if available. Retry, " +
      "fall back to manual, or mark skipped.",
  },
  skipped: { tone: "info", message: "Skipped." },
};

const BANNER_TONE: Record<"info" | "warn" | "ok" | "danger", string> = {
  info: "border-rule text-ink-dim",
  warn: "border-amber-dim text-amber",
  ok: "border-green-dim text-green",
  danger: "border-red-dim text-red",
};

function LegitimacyPill({ job }: { job: Job }) {
  if (!job.legitimacy) return null;
  const tone =
    job.legitimacy === "high_confidence"
      ? ("live" as const)
      : job.legitimacy === "proceed_with_caution"
        ? ("attention" as const)
        : ("failed" as const);
  const labels: Record<NonNullable<Job["legitimacy"]>, string> = {
    high_confidence: "legit: high confidence",
    proceed_with_caution: "legit: proceed with caution",
    suspicious: "legit: suspicious",
  };
  return (
    <Pill tone={tone} title={job.legitimacy_reasoning ?? undefined}>
      {labels[job.legitimacy]}
    </Pill>
  );
}

// ── Form-answer drafts panel ───────────────────────────────────────────────

const IDENTITY_FIELD_KEYS: Array<{ key: keyof FormAnswers; label: string }> = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "full_name", label: "Full Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "github_url", label: "GitHub URL" },
  { key: "portfolio_url", label: "Portfolio URL" },
  { key: "current_location", label: "Current Location" },
  { key: "willing_to_relocate", label: "Willing to Relocate" },
  { key: "remote_preference", label: "Remote Preference" },
  { key: "salary_expectation", label: "Salary Expectation" },
  { key: "work_authorization", label: "Work Authorization" },
  { key: "notice_period", label: "Notice Period" },
  { key: "availability_to_start", label: "Availability" },
  { key: "current_company", label: "Current Company" },
  { key: "current_title", label: "Current Title" },
  { key: "years_of_experience", label: "Years of Experience" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          setCopied(false);
        }
      }}
      className={
        "shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150 active:duration-0 " +
        (copied
          ? "border-green-dim text-green"
          : "border-rule text-ink-dim hover:border-amber hover:text-amber")
      }
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function DraftLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.18em] text-ink-faint">
      {children}
    </div>
  );
}

function FormAnswersBlock({
  formAnswers,
}: {
  formAnswers: FormAnswers | null;
}) {
  if (!formAnswers) {
    return (
      <div className="text-xs italic text-ink-faint">
        Form-answer drafts not generated for this score band (gated on
        score &ge; 6 in the tailoring step).
      </div>
    );
  }
  const identityRows = IDENTITY_FIELD_KEYS.map(({ key, label }) => {
    const v = formAnswers[key];
    if (v === undefined || v === null || v === "") return null;
    return { label, value: String(v) };
  }).filter(Boolean) as Array<{ label: string; value: string }>;

  const questions: FormAnswerQuestion[] =
    formAnswers.additional_questions ?? [];

  const narrative: Array<{ label: string; text: string }> = [
    formAnswers.why_this_role && {
      label: "Why this role",
      text: formAnswers.why_this_role,
    },
    formAnswers.why_this_company && {
      label: "Why this company",
      text: formAnswers.why_this_company,
    },
    formAnswers.additional_info && {
      label: "Additional info",
      text: formAnswers.additional_info,
    },
  ].filter(Boolean) as Array<{ label: string; text: string }>;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2">
          <DraftLabel>Identity / Contact / Comp (from profile.yml)</DraftLabel>
        </div>
        <div className="border border-rule">
          <dl className="divide-y divide-rule-soft">
            {identityRows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[160px_1fr_auto] items-center gap-3 px-3 py-1.5"
              >
                <dt className="text-[11px] text-ink-faint">{row.label}</dt>
                <dd className="break-all text-xs text-ink">{row.value}</dd>
                <CopyButton text={row.value} />
              </div>
            ))}
          </dl>
        </div>
      </div>

      {narrative.map(({ label, text }) => (
        <div key={label}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <DraftLabel>{label}</DraftLabel>
            <CopyButton text={text} />
          </div>
          <p className="whitespace-pre-wrap border border-rule bg-bg px-3 py-2 text-xs leading-relaxed text-ink-dim">
            {text}
          </p>
        </div>
      ))}

      {questions.length > 0 && (
        <div>
          <div className="mb-2">
            <DraftLabel>Role-specific questions ({questions.length})</DraftLabel>
          </div>
          <ol className="space-y-3">
            {questions.map((q, i) => (
              <li key={i} className="border border-rule bg-bg p-3">
                <div className="mb-1 text-[11px] font-medium text-ink">
                  Q{i + 1}: {q.question}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <p className="flex-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-dim">
                    {q.draft_answer}
                  </p>
                  <CopyButton text={q.draft_answer} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Pre-fill screenshot ────────────────────────────────────────────────────

function PrefillScreenshot({ storagePath }: { storagePath: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/dashboard/storage/sign?path=${encodeURIComponent(storagePath)}`,
        );
        const json = (await res.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
        };
        if (!res.ok || !json.url) {
          setErr(json.error ?? "failed to sign");
        } else {
          setSignedUrl(json.url);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [storagePath]);

  return (
    <section className="mb-8">
      <h2 className="mb-2.5 border-b border-rule-soft pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
        Pre-fill screenshot
      </h2>
      <div className="border border-rule bg-bg-raised p-3">
        {signedUrl ? (
          <>
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden border border-rule transition-colors duration-150 hover:border-amber"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signedUrl}
                alt="Pre-fill screenshot"
                className="max-h-[600px] w-full bg-bg object-contain"
              />
            </a>
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
              <span className="truncate">{storagePath}</span>
              <a
                href={signedUrl}
                download
                className="text-ink-dim transition-colors duration-150 hover:text-ink"
              >
                download
              </a>
            </div>
          </>
        ) : err ? (
          <div className="text-xs text-red">could not load: {err}</div>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </div>
    </section>
  );
}

// ── Mark-Applied modal ─────────────────────────────────────────────────────

function MarkAppliedModal({
  jobId,
  onClose,
  onApplied,
}: {
  jobId: string | number;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await requestJSON("POST", `/api/dashboard/jobs/${jobId}/mark-applied`, {
        submission_notes: notes,
      });
      onApplied();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal label="Mark applied" onClose={onClose} maxWidth="max-w-lg">
      <ModalTitle>Mark applied</ModalTitle>
      <p className="mb-4 text-xs leading-relaxed text-ink-dim">
        Confirms you submitted the application yourself in the visible
        browser. Stamps <code>submitted_at</code> and (optionally)
        attaches notes about anything that needed manual fixing.
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder={
          "Optional notes (e.g. 'salary field rejected $130k, " +
          "had to enter $129,999')"
        }
        className="w-full border border-rule bg-bg px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
      />
      {err && <div className="mt-2 break-words text-xs text-red">{err}</div>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>
          cancel
        </Btn>
        <Btn variant="approve" onClick={submit} pending={busy}>
          mark applied
        </Btn>
      </div>
    </Modal>
  );
}

// ── Mark-Failed modal (free-text reason → failure_reason) ─────────────────

function MarkFailedModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (reason: string | null) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal label="Mark failed" onClose={onClose}>
      <ModalTitle>Mark failed — what broke?</ModalTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(reason.trim() || null);
        }}
      >
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. ATS rejected the resume upload"
          className="w-full border border-rule bg-bg px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
        />
        <div className="mt-4 flex items-center justify-between gap-2">
          <Btn type="button" variant="ghost" onClick={() => onConfirm(null)}>
            mark failed without reason
          </Btn>
          <div className="flex items-center gap-2">
            <Btn type="button" variant="ghost" onClick={onClose}>
              cancel
            </Btn>
            <Btn type="submit" variant="danger">
              mark failed
            </Btn>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ReviewDetailPage() {
  const params = useParams<{ job_id: string }>();
  const router = useRouter();
  const jobId = params?.job_id;
  const toast = useToast();
  const act = useOptimisticAction();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMarkApplied, setShowMarkApplied] = useState(false);
  const [showSkipPick, setShowSkipPick] = useState(false);
  const [showMarkFailed, setShowMarkFailed] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  /** silent=true converges state after an action without flashing the
   *  skeleton — the optimistic update already painted the new state. */
  async function refresh(silent: boolean) {
    if (!jobId) return;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/jobs/${jobId}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        job?: Job;
        error?: string;
      };
      if (res.status === 404) setError("Job not found");
      else if (!res.ok) setError(json.error ?? `Failed to load (${res.status})`);
      else if (!json.job) setError("Job not found");
      else {
        setJob(json.job);
        setError(null);
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    }
    if (!silent) setLoading(false);
  }

  /** Optimistic cockpit action: flips status locally, POSTs, converges
   *  with a silent refetch. */
  function postAction(
    path: "prefill" | "skip" | "mark-failed",
    optimisticStatus: JobStatus,
    body?: object,
    successToast?: string,
  ) {
    if (!job) return;
    void act.run(`cockpit:${path}`, {
      optimistic: () => {
        const before = job;
        setJob({ ...job, status: optimisticStatus });
        return () => setJob(before);
      },
      perform: () =>
        requestJSON("POST", `/api/dashboard/jobs/${job.id}/${path}`, body ?? {}),
      errorLabel: path.replace("-", " "),
      successToast,
      onSuccess: () => void refresh(true),
    });
  }

  const banner = useMemo(() => {
    const status = (job?.status ?? "new") as JobStatus;
    return STATUS_BANNER[status];
  }, [job?.status]);

  if (loading) {
    return (
      <>
        <DashboardNav />
        <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
          <Skeleton className="mb-6 h-3 w-28" />
          <Skeleton className="mb-2 h-8 w-2/3" />
          <Skeleton className="mb-8 h-4 w-1/3" />
          <SkeletonRows rows={3} rowClassName="h-14" />
        </main>
      </>
    );
  }

  if (!job || error) {
    return (
      <>
        <DashboardNav />
        <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
          <Link
            href="/dashboard/review"
            className="text-xs text-ink-faint transition-colors duration-150 hover:text-ink"
          >
            ← Review queue
          </Link>
          <div className="mt-6 border border-red-dim px-4 py-3 text-xs text-red">
            {error ?? "Job not found"}
          </div>
        </main>
      </>
    );
  }

  const status = (job.status ?? "new") as JobStatus;
  const submissionUrl = job.submission_url || job.application_url || job.url;
  const resumePdfUrl = `/api/materials/${job.id}/resume`;
  const coverLetterPdfUrl = `/api/materials/${job.id}/cover_letter`;
  const coverLetterText = job.cover_letter_path ?? "";
  const canPrefill = status === "ready_for_review";
  const score = scoreOf(job.score);

  return (
    <>
      <DashboardNav />
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 pb-32 sm:px-8 sm:py-10">
        {/* Back-link STAYS here permanently — breadcrumb context matters
            when users deep-link straight into a specific cockpit. */}
        <Link
          href="/dashboard/review"
          className="text-xs text-ink-faint transition-colors duration-150 hover:text-ink"
        >
          ← Review queue
        </Link>

        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="mb-6 mt-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[26px] leading-tight tracking-tight text-ink">
                {job.title}
              </h1>
              <p className="mt-1 text-xs text-ink-dim">
                {job.company}
                {job.location ? ` · ${job.location}` : ""}
              </p>
              {relativeTime(job.status_updated_at) && (
                <p className="mt-1 text-[11px] text-ink-faint tabular-nums">
                  status updated {relativeTime(job.status_updated_at)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {score !== null && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                    Score
                  </div>
                  <div className="text-2xl text-ink tabular-nums">
                    {score}
                    <span className="text-xs text-ink-faint">/10</span>
                  </div>
                </div>
              )}
              {job.url && (
                <BtnLink href={job.url} target="_blank" rel="noreferrer">
                  posting ↗
                </BtnLink>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <TierPill tier={job.tier} />
            {job.archetype && (
              <Pill
                tone="dim"
                title={
                  job.archetype_confidence
                    ? `confidence ${job.archetype_confidence.toFixed(2)}`
                    : undefined
                }
              >
                {job.archetype}
              </Pill>
            )}
            <LegitimacyPill job={job} />
            <Pill tone="dim" className="ml-auto">
              status: <span className="text-ink">{status}</span>
            </Pill>
          </div>
        </header>

        {/* ── Status banner ──────────────────────────────────────── */}
        {banner && (
          <section
            className={`mb-6 border border-l-2 px-4 py-3 text-xs leading-relaxed ${BANNER_TONE[banner.tone]}`}
          >
            {banner.message}
            {status === "applied" && job.submitted_at && (
              <span className="mt-1 block text-[11px] opacity-70 tabular-nums">
                submitted_at: {new Date(job.submitted_at).toISOString()}
              </span>
            )}
            {status === "failed" && job.failure_reason && (
              <span className="mt-1 block text-[11px] opacity-80">
                {job.failure_reason}
              </span>
            )}
          </section>
        )}

        {/* ── Materials ──────────────────────────────────────────── */}
        <section className="mb-8 space-y-3">
          <h2 className="border-b border-rule-soft pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            Materials
          </h2>

          <details className="group border border-rule bg-bg-raised">
            <summary className="flex select-none items-center justify-between px-4 py-3 text-xs text-ink transition-colors duration-150 hover:bg-bg-card">
              <span>Tailored resume (PDF)</span>
              <span className="text-[10px] text-ink-faint group-open:hidden">
                click to open
              </span>
            </summary>
            <div className="flex items-center gap-2 border-t border-rule-soft px-4 py-3">
              <BtnLink href={resumePdfUrl} target="_blank" rel="noreferrer">
                view
              </BtnLink>
              <BtnLink href={`${resumePdfUrl}?download=1`}>download</BtnLink>
              <span className="ml-auto truncate text-[11px] text-ink-faint">
                {job.resume_pdf_path ?? "(no storage path)"}
              </span>
            </div>
          </details>

          <details className="group border border-rule bg-bg-raised">
            <summary className="flex select-none items-center justify-between px-4 py-3 text-xs text-ink transition-colors duration-150 hover:bg-bg-card">
              <span>Cover letter</span>
              <span className="text-[10px] text-ink-faint group-open:hidden">
                click to open
              </span>
            </summary>
            <div className="space-y-3 border-t border-rule-soft px-4 py-3">
              <div className="flex items-center gap-2">
                <BtnLink href={coverLetterPdfUrl} target="_blank" rel="noreferrer">
                  view pdf
                </BtnLink>
                {coverLetterText && <CopyButton text={coverLetterText} />}
              </div>
              {coverLetterText && (
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap border border-rule bg-bg p-3 text-[11px] leading-relaxed text-ink-dim">
                  {coverLetterText}
                </pre>
              )}
            </div>
          </details>

          <details className="group border border-rule bg-bg-raised" open>
            <summary className="flex select-none items-center justify-between px-4 py-3 text-xs text-ink transition-colors duration-150 hover:bg-bg-card">
              <span>
                Form-answer drafts
                {job.form_answers && (
                  <span className="ml-2 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                    ({(job.form_answers.additional_questions ?? []).length} custom Qs)
                  </span>
                )}
              </span>
              <span className="text-[10px] text-ink-faint group-open:hidden">
                click to open
              </span>
            </summary>
            <div className="border-t border-rule-soft px-4 py-4">
              <FormAnswersBlock formAnswers={job.form_answers} />
            </div>
          </details>
        </section>

        {/* ── Pre-fill screenshot ────────────────────────────────── */}
        {job.prefill_screenshot_path && (
          <PrefillScreenshot storagePath={job.prefill_screenshot_path} />
        )}

        {/* ── Action bar (sticky) ────────────────────────────────── *
         * State-aware primary CTA: ready_for_review → Pre-fill is the
         * single primary; awaiting_human_submit → Mark Applied takes
         * over. Exactly one primary on screen at any moment. */}
        {(() => {
          const prefillIsPrimary = status === "ready_for_review";
          const markIsPrimary = status === "awaiting_human_submit";
          return (
            <section className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-[rgba(11,11,12,0.92)] backdrop-blur-[8px]">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3 sm:px-8">
                <Btn
                  size="md"
                  variant={prefillIsPrimary ? "primary" : "secondary"}
                  onClick={() => postAction("prefill", "prefilling")}
                  pending={act.isPending("cockpit:prefill")}
                  flash={act.isFlashing("cockpit:prefill")}
                  disabled={!canPrefill || act.anyPending("cockpit:")}
                  title={
                    canPrefill
                      ? "Pre-fill the application form in a visible browser window"
                      : `Pre-fill is only available from ready_for_review (current: ${status})`
                  }
                >
                  pre-fill form
                </Btn>
                <Btn
                  size="md"
                  variant={markIsPrimary ? "approve" : "secondary"}
                  onClick={() => setShowMarkApplied(true)}
                  disabled={status === "applied" || act.anyPending("cockpit:")}
                >
                  mark applied
                </Btn>
                {submissionUrl && (
                  <BtnLink
                    size="md"
                    href={submissionUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    open manually ↗
                  </BtnLink>
                )}
                <Btn
                  size="md"
                  variant="secondary"
                  onClick={() => setShowSkipPick(true)}
                  pending={act.isPending("cockpit:skip")}
                  disabled={act.anyPending("cockpit:")}
                >
                  skip
                </Btn>
                <Btn
                  size="md"
                  variant="danger"
                  className="ml-auto"
                  onClick={() => setShowMarkFailed(true)}
                  pending={act.isPending("cockpit:mark-failed")}
                  disabled={act.anyPending("cockpit:")}
                >
                  mark failed
                </Btn>
              </div>
            </section>
          );
        })()}

        {showSkipPick && (
          <ReasonPick
            title={`Skip — ${job.title} @ ${job.company}`}
            verb="skip"
            onPick={(reason) => {
              setShowSkipPick(false);
              postAction(
                "skip",
                "skipped",
                reason ? { reason } : { reason: "skipped from cockpit" },
              );
            }}
            onCancel={() => setShowSkipPick(false)}
          />
        )}

        {showMarkFailed && (
          <MarkFailedModal
            onConfirm={(reason) => {
              setShowMarkFailed(false);
              postAction("mark-failed", "failed", {
                reason: reason ?? "marked failed from cockpit",
              });
            }}
            onClose={() => setShowMarkFailed(false)}
          />
        )}

        {showMarkApplied && (
          <MarkAppliedModal
            jobId={job.id}
            onClose={() => setShowMarkApplied(false)}
            onApplied={() => {
              setShowMarkApplied(false);
              toast.push("ok", `Marked applied — ${job.company}`);
              // M-6: after marking applied, head back to the queue; the
              // user is done with this row.
              router.push("/dashboard/review");
            }}
          />
        )}
      </main>
    </>
  );
}
