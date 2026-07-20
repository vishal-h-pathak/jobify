"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DOC_FILENAMES } from "@/lib/profile/buildDoc";
import { validationTone, type UserOverviewRow } from "@/lib/admin/users";
import type { UserProfileReview } from "@/lib/admin/profileReview";
import { RunHuntForUserButton } from "./RunHuntForUserButton";
import { ResetModuleButton } from "./ResetModuleButton";

/** ADM-3: the admin page's per-user row, `UserOverviewRow` plus the
 * all-time spend + onboarding join computed once at the page level (see
 * page.tsx) — folded onto this existing table rather than a second
 * parallel one. */
export interface AdminUserRow extends UserOverviewRow {
  spendUsdAllTime: number;
  onboardingStage: string | null;
  onboardingStatus: string | null;
  onboardingCompletedAt: string | null;
  lastActivityAt: string | null;
}

/**
 * Session 29 (ONB-D) task 1: the Users table row + its "Review profile"
 * expander. Read-only — fetches GET /api/admin/profile-review on first
 * expand and caches the result in state; no accordion primitive exists
 * elsewhere in this codebase, so the per-file doc viewer below uses plain
 * `<details>`.
 */
export function ProfileReviewRow({ user }: { user: AdminUserRow }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<UserProfileReview | null>(null);

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (review || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/profile-review?userId=${encodeURIComponent(user.userId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setReview(data as UserProfileReview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr className="border-t border-line">
        <td className="py-2 pr-4">{user.email}</td>
        <td className="py-2 pr-4">
          <Badge tone={validationTone(user.validationStatus)}>{user.validationStatus ?? "no profile"}</Badge>
        </td>
        <td className="py-2 pr-4 text-ink-muted">
          {user.onboardingStatus === "complete" ? (
            <span>
              done{user.onboardingCompletedAt && ` ${new Date(user.onboardingCompletedAt).toLocaleDateString()}`}
            </span>
          ) : (
            (user.onboardingStage ?? "—")
          )}
        </td>
        <td className="py-2 pr-4 text-ink-muted">
          {user.lastActivityAt ? new Date(user.lastActivityAt).toLocaleDateString() : "—"}
        </td>
        <td className="py-2 pr-4 text-ink-muted">
          {user.matchCounts.new} new · {user.matchCounts.saved} saved · {user.matchCounts.applied} applied ·{" "}
          {user.matchCounts.dismissed} dismissed
        </td>
        <td className="py-2 pr-4 text-ink-muted">${user.spendUsdMtd.toFixed(2)}</td>
        <td className="py-2 pr-4 text-ink-muted">${user.spendUsdAllTime.toFixed(2)}</td>
        <td className="py-2 pr-4 text-ink-muted">{user.hasByoKey ? "Yes" : "No"}</td>
        <td className="py-2">
          <div className="flex items-center gap-2">
            <RunHuntForUserButton userId={user.userId} />
            <Button variant="ghost" onClick={toggle}>
              {expanded ? "Hide profile" : "Review profile"}
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-line">
          <td colSpan={9} className="bg-surface/50 p-4">
            {loading && <p className="text-sm text-ink-muted">Loading…</p>}
            {error && <p className="text-sm text-danger">{error}</p>}
            {review && <ProfileReviewPanel userId={user.userId} review={review} />}
          </td>
        </tr>
      )}
    </>
  );
}

const FUNNEL_STATUS_LABELS: Record<string, string> = {
  rejected_title: "Rejected (title)",
  rejected_rubric: "Rejected (rubric)",
  rejected_rerank: "Rejected (rerank)",
  rejected_llm: "Rejected (LLM)",
  surfaced: "Surfaced",
};

function ProfileReviewPanel({ userId, review }: { userId: string; review: UserProfileReview }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-ink">Extracted</h3>
        <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-base p-3 font-mono text-xs text-ink-muted">
          {JSON.stringify(review.extracted, null, 2)}
        </pre>
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink">Validation</h3>
        <p className="text-sm text-ink-muted">
          {review.validationStatus?.status ?? "no profile"}
          {review.validationStatus?.errors?.length ? ` — ${review.validationStatus.errors.join("; ")}` : ""}
        </p>
      </div>

      {review.onboarding && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink">Onboarding behavior</h3>
          <p className="text-sm text-ink-muted">
            Stage: {review.onboarding.stage} · {review.onboarding.status} · {review.onboarding.turnCount} turns ·{" "}
            {review.onboarding.fallbackCount} fallback / {review.onboarding.loopBreakerCount} loop-breaker (best
            effort — reprompt turns leave no marker to count)
          </p>
          <p className="text-sm text-ink-muted">
            Spend this month: ${review.spend.mtdUsd.toFixed(2)} of ${review.spend.capUsd.toFixed(2)} cap
          </p>
          <div className="flex flex-wrap gap-1">
            {review.onboarding.modules.map((m) => (
              <Badge key={m.key} tone={m.done ? "success" : "neutral"}>
                {m.key}
              </Badge>
            ))}
          </div>
          <ResetModuleButton userId={userId} moduleKeys={review.onboarding.modules.map((m) => m.key)} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-ink">Hunt & feed</h3>
        <ul className="text-sm text-ink-muted">
          {Object.entries(review.huntFeed.byStatus).map(([status, count]) => (
            <li key={status} className="flex justify-between gap-4">
              <span>{FUNNEL_STATUS_LABELS[status] ?? status}</span>
              <span>{count}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-muted">
          Surfaced location tiers — 1: {review.huntFeed.surfacedLocationTiers.tier1}, 2:{" "}
          {review.huntFeed.surfacedLocationTiers.tier2}, 3: {review.huntFeed.surfacedLocationTiers.tier3}, unknown:{" "}
          {review.huntFeed.surfacedLocationTiers.unknown}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-ink">Profile documents</h3>
        {review.doc ? (
          DOC_FILENAMES.map((filename) => (
            <details key={filename} className="rounded-md border border-line bg-base">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">{filename}</summary>
              <pre className="overflow-auto border-t border-line p-3 font-mono text-xs text-ink-muted">
                {review.doc?.[filename] || "(empty)"}
              </pre>
            </details>
          ))
        ) : (
          <p className="text-sm text-ink-muted">No profile documents yet.</p>
        )}
      </div>
    </div>
  );
}
