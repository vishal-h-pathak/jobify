// web/components/submit/SubmitKit.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { markApplied, type FeedSupabaseClient } from "@/lib/db/matches";
import { fetchSubmitPacket, type SubmitPacketOutcome } from "./api";
import { navigateToSetup } from "./links";
import { AnswerSheet } from "./AnswerSheet";

const CHECKLIST = [
  "Open the application",
  "Upload your resume",
  "Paste the cover letter",
  "Fill the rest from the answer sheet",
  "Review everything on the ATS's own page",
  "Click Submit yourself",
];

/**
 * DI'd so the "I applied" click is unit-testable without a real Supabase
 * client — reuses `markApplied` (web/lib/db/matches.ts) verbatim, the same
 * mechanism the feed's "I applied" button calls (MatchCard.tsx). This is
 * not a parallel applied state.
 */
export async function handleAppliedClick(
  supabase: FeedSupabaseClient,
  userId: string,
  postingId: string,
  markAppliedImpl: typeof markApplied = markApplied
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await markAppliedImpl(supabase, userId, postingId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't mark this applied — try again." };
  }
}

/**
 * Isolates the "409 → redirect to setup" decision as a pure predicate so
 * it's directly unit-testable (session 39 spec's required "409 → setup
 * redirect" test) without rendering the component — the effect below just
 * calls this.
 */
export function shouldRedirectToSetup(outcome: SubmitPacketOutcome | null): boolean {
  return outcome?.kind === "needs_setup";
}

/**
 * UX1-B paper cut 2: the "I applied" click's in-flight guard, isolated as
 * a pure predicate (same pattern as `shouldRedirectToSetup`) so it's
 * testable without a DOM. `onApply` below is the real backstop — the
 * button's `busy={applying}` also disables it, so a double-click can't
 * double-fire `markApplied`.
 */
export function canFireAppliedClick(applying: boolean): boolean {
  return !applying;
}

export function SubmitKit({ postingId, userId }: { postingId: string; userId: string }) {
  const [outcome, setOutcome] = useState<SubmitPacketOutcome | null>(null);
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [appliedError, setAppliedError] = useState("");
  const [supabase] = useState(() => createSupabaseBrowserClient());

  useEffect(() => {
    let cancelled = false;
    fetchSubmitPacket(postingId)
      .then((result) => {
        if (!cancelled) setOutcome(result);
      })
      .catch(() => {
        if (!cancelled) setOutcome({ kind: "error", message: "Couldn't load your submit kit — try refreshing." });
      });
    return () => {
      cancelled = true;
    };
  }, [postingId]);

  useEffect(() => {
    if (shouldRedirectToSetup(outcome)) navigateToSetup(postingId);
  }, [outcome, postingId]);

  async function onApply() {
    if (!canFireAppliedClick(applying)) return;
    setApplying(true);
    setAppliedError("");
    const result = await handleAppliedClick(supabase, userId, postingId);
    setApplying(false);
    if (result.ok) setApplied(true);
    else setAppliedError(result.error);
  }

  if (outcome === null || outcome.kind === "needs_setup") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center justify-center px-6 py-10">
        <Spinner />
      </div>
    );
  }

  if (outcome.kind === "error") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
        <Banner tone="danger">{outcome.message}</Banner>
      </div>
    );
  }

  if (outcome.kind === "no_materials") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-3 px-6 py-16 text-center">
        <p className="text-lg font-semibold text-ink">No materials yet</p>
        <p className="text-sm text-ink-muted">Tailor this match first, then come back here to prepare to apply.</p>
        <Link href="/feed" className="text-sm text-amber hover:text-amber-hover">
          Back to your feed
        </Link>
      </div>
    );
  }

  const { packet } = outcome;

  return (
    <div className="submit-kit-print mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{packet.posting.title}</h1>
        <p className="text-sm text-ink-muted">
          {packet.posting.company} · <span className="text-xs uppercase">{packet.posting.ats_kind}</span>
        </p>
      </div>

      <a
        href={packet.posting.application_url}
        target="_blank"
        rel="noreferrer"
        className="print:hidden inline-flex w-fit items-center gap-2 rounded-md bg-amber px-3 py-1.5 text-sm font-medium text-base hover:bg-amber-hover"
      >
        Open the application
      </a>

      <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium text-ink">Materials</h2>
        <div className="print:hidden flex flex-wrap items-center gap-3">
          <a href={packet.materials.resume_pdf_url} className="text-sm text-amber hover:text-amber-hover">
            Download resume
          </a>
          <a href={packet.materials.cover_letter_pdf_url} className="text-sm text-amber hover:text-amber-hover">
            Download cover letter
          </a>
          <Button variant="ghost" onClick={() => navigator.clipboard.writeText(packet.materials.cover_letter_text)}>
            Copy letter text
          </Button>
        </div>
        <p className="whitespace-pre-wrap text-sm text-ink-muted">{packet.materials.cover_letter_text}</p>
      </section>

      <AnswerSheet packet={packet} />

      <section className="print:hidden flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium text-ink">Checklist</h2>
        <ol className="flex flex-col gap-1 text-sm text-ink-muted">
          {CHECKLIST.map((item, i) => (
            <li key={item}>
              {i + 1}. {item}
            </li>
          ))}
        </ol>
      </section>

      <div className="print:hidden flex items-center gap-3">
        {applied ? (
          <p className="text-sm text-success">Marked applied.</p>
        ) : (
          <Button variant="primary" busy={applying} onClick={onApply}>
            I applied
          </Button>
        )}
        {appliedError && <p className="text-sm text-danger">{appliedError}</p>}
      </div>
    </div>
  );
}
