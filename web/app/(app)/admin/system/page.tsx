import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPoolHealth } from "@/lib/admin/poolHealth";
import { getMostRecentScoringFunnel, listRecentHuntCycles } from "@/lib/admin/systemCycles";
import { getCostBreakdownMtd, getEngagementSnapshot, getPoolFreshness } from "@/lib/admin/systemMetrics";

// Same reasoning as ../page.tsx: this page's content will depend on
// data that changes as the worker runs (Task 5's performance panels) —
// never statically cache.
export const dynamic = "force-dynamic";

// Task 4 fills in the top half of this file — a static "How it works"
// explainer, sourced from docs/SCORING.md, docs/COST_RAILS.md, and
// docs/OPERATIONS.md (cited by filename only; see those docs for the
// full mechanics). Task 5 adds a second, live-data half below this one,
// in the same file.
export default async function AdminSystemPage() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    // ADM-3: see ../page.tsx's identical gate — 404 for a signed-in
    // non-admin, redirect only when genuinely unauthenticated.
    if (gate.reason === "unauthenticated") redirect("/login");
    notFound();
  }

  // Only constructed after requireAdmin() confirms the caller is an admin.
  const admin = createSupabaseAdminClient();
  const [cycles, funnel, poolHealth, costBreakdown, engagement, poolFreshness] = await Promise.all([
    listRecentHuntCycles(admin),
    getMostRecentScoringFunnel(admin),
    getPoolHealth(admin),
    getCostBreakdownMtd(admin),
    getEngagementSnapshot(admin),
    getPoolFreshness(admin),
  ]);

  const capPct = poolHealth.globalCapUsd > 0 ? Math.min(100, (poolHealth.poolSpendUsdMtd / poolHealth.globalCapUsd) * 100) : 0;
  const funnelMax = funnel ? Math.max(1, ...funnel.map((stage) => stage.count)) : 1;
  const totalMatches = Object.values(engagement.totalsByState).reduce((sum, n) => sum + n, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-ink">System</h1>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-ink">How it works</h2>
        <p className="text-sm text-ink-muted">
          A static explainer of the pipeline every posting and every user actually passes through — no live data on
          this half, just how the machinery is built.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <h3 className="font-medium text-ink">The four-stage scoring ladder</h3>
        <p className="text-sm text-ink-muted">
          Every job posting a user might see is gated through four stages, cheapest first. Each stage prunes the
          pool before the next, more expensive one runs, so the marginal cost of scoring one more posting for one
          more user stays as close to zero as the ladder can make it.
        </p>
        <pre className="overflow-x-auto rounded-md border border-line bg-base p-3 font-mono text-xs leading-relaxed text-ink-muted">
{`posting → [1] title filter → [2] compiled rubric → [3] embedding rerank → [4] LLM verdict
           free, per-user      free, per-user         shared, cheap          budget-gated,
                                                                              top-N only`}
        </pre>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-muted">
          <li>
            <span className="font-medium text-ink">Title pre-filter</span> — static, per-user rules, zero cost.
          </li>
          <li>
            <span className="font-medium text-ink">Compiled rubric</span> — a one-time distillation of a user&apos;s
            own hunting judgment into weighted term groups, disqualifier patterns, and hard gates (location,
            compensation floor); once compiled, it scores every posting in pure Python — zero tokens per posting.
          </li>
          <li>
            <span className="font-medium text-ink">Embedding rerank</span> — cosine similarity between a
            user&apos;s profile embedding and each posting&apos;s embedding, reranking stage 2&apos;s survivors;
            cleanly skipped (not an error) whenever embeddings are disabled.
          </li>
          <li>
            <span className="font-medium text-ink">LLM verdict</span> — a small, fast model call, budget-gated, run
            only against the top-N survivors ranked by the combined rubric + embedding score.
          </li>
        </ol>
        <p className="text-xs text-ink-muted">Source: docs/SCORING.md</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="font-medium text-ink">Shared global discovery</h3>
        <p className="text-sm text-ink-muted">
          One shared discovery pass per cycle fills a single postings pool for every user, with no per-user title
          filtering applied at this stage — that filtering happens downstream, in stage 1 of each user&apos;s own
          ladder. This is deliberate: filtering by any one user&apos;s preferences at discovery time would silently
          hide postings from every other user before they ever got a chance to see them.
        </p>
        <p className="text-sm text-ink-muted">
          Because discovery and embeddings are computed once and shared across everyone, the marginal cost of adding
          another user approaches zero for everything except stage 4&apos;s per-user LLM verdicts.
        </p>
        <p className="text-xs text-ink-muted">Source: docs/SCORING.md</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="font-medium text-ink">The three budget layers</h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-muted">
          <li>
            <span className="font-medium text-ink">Per-user pool cap</span> — a monthly USD cap per user, hard
            enforced: re-checked repeatedly during a user&apos;s own stage-4 batch, not just once per cycle, so a
            user can&apos;t burn well past their cap before the next cycle catches up.
          </li>
          <li>
            <span className="font-medium text-ink">Global pool cap</span> — a monthly USD ceiling on total
            shared-pool spend across every user. It&apos;s checked once at the start of a cycle and re-checked live
            as each user&apos;s stage 4 runs, so one user&apos;s spend crossing the ceiling mid-cycle still stops a
            later user&apos;s spend in the same cycle.
          </li>
          <li>
            <span className="font-medium text-ink">Bring-your-own key</span> — a user may supply their own API key,
            which bypasses both caps above entirely for their own calls (the spend is still recorded, just excluded
            from pool accounting).
          </li>
        </ul>
        <p className="text-xs text-ink-muted">Source: docs/COST_RAILS.md</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="font-medium text-ink">The invite / auth model</h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-muted">
          <li>Access is invite-only: a code must be minted and claimed before someone can use the product.</li>
          <li>Authentication is passwordless (magic-link).</li>
          <li>
            Admin access is granted through an operator-configured allowlist, checked server-side on every request —
            not a client-side flag, and not stored as a role in the database.
          </li>
          <li>
            Admins bypass the invite requirement (there&apos;s no reason to spend an invite code on the
            operator&apos;s own account) but still need a real authenticated session like anyone else.
          </li>
        </ul>
        <p className="text-xs text-ink-muted">Source: docs/OPERATIONS.md</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="font-medium text-ink">The on-demand hunt flow</h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-muted">
          <li>A recurring scheduled job keeps the shared discovery pool fresh — this costs nothing (no LLM calls at all).</li>
          <li>
            Actually scoring a user against that pool is triggered on demand: the user clicks a &quot;Run my
            hunt&quot; button on their own feed (or an admin triggers it for them from the Operations tab).
          </li>
          <li>That click dispatches a background job that runs discovery once more (cheap, idempotent) and then scores just that one user.</li>
          <li>A per-user cooldown limits how often someone can trigger their own hunt; admins bypass the cooldown for their own and anyone else&apos;s runs.</li>
        </ul>
        <p className="text-xs text-ink-muted">Source: docs/OPERATIONS.md</p>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-ink">How it&apos;s performing</h2>
        <p className="text-sm text-ink-muted">
          Live data from the worker&apos;s own audit trail — recent cycles, the latest scoring funnel, spend, and
          how friends are engaging with what the pipeline finds.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <h3 className="font-medium text-ink">Recent hunt cycles</h3>
        {cycles.length === 0 ? (
          <EmptyState heading="No cycles yet" message="Nothing has run yet — check back once the worker's cron fires." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-ink-muted">
                  <th className="pb-2 pr-4 font-medium">When</th>
                  <th className="pb-2 pr-4 font-medium">Mode</th>
                  <th className="pb-2 pr-4 font-medium">Trigger</th>
                  <th className="pb-2 pr-4 font-medium">Users</th>
                  <th className="pb-2 pr-4 font-medium">Postings</th>
                  <th className="pb-2 pr-4 font-medium">Boards</th>
                  <th className="pb-2 pr-4 font-medium">Stage-4 calls</th>
                  <th className="pb-2 pr-4 font-medium">Cost</th>
                  <th className="pb-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => (
                  <tr key={cycle.id} className="border-t border-line">
                    <td className="py-2 pr-4 text-ink-muted">{new Date(cycle.startedAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">{cycle.mode}</td>
                    <td className="py-2 pr-4 text-ink-muted">{cycle.triggeredBy ?? "—"}</td>
                    <td className="py-2 pr-4 text-ink-muted">{cycle.usersScored}</td>
                    <td className="py-2 pr-4 text-ink-muted">{cycle.postingsUpserted}</td>
                    <td className="py-2 pr-4 text-ink-muted">
                      {cycle.boardsFetched}/{cycle.boardsTotal}
                      {cycle.boardsSkippedEmpty > 0 && ` (${cycle.boardsSkippedEmpty} empty)`}
                    </td>
                    <td className="py-2 pr-4 text-ink-muted">{cycle.stage4Calls}</td>
                    <td className="py-2 pr-4 text-ink-muted">${cycle.costUsd.toFixed(2)}</td>
                    <td className="py-2">{cycle.error && <Badge tone="danger">{cycle.error}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h3 className="font-medium text-ink">Latest scoring funnel</h3>
        {funnel === null ? (
          <EmptyState heading="No scoring cycle yet" message="Only discovery has run so far — no fan-out to funnel." />
        ) : (
          <div className="flex flex-col gap-3">
            {funnel.map((stage) => (
              <div key={stage.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink">{stage.label}</span>
                  <span className="text-ink-muted">{stage.count}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-amber transition-[width]"
                    style={{ width: `${(stage.count / funnelMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h3 className="font-medium text-ink">Cost</h3>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Pool spend: <span className="font-medium text-ink">${poolHealth.poolSpendUsdMtd.toFixed(2)}</span> of{" "}
            <span className="font-medium text-ink">${poolHealth.globalCapUsd.toFixed(2)}</span>
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-amber transition-[width]" style={{ width: `${capPct}%` }} />
          </div>
          <p className="text-xs text-ink-muted">
            BYO spend this month: ${poolHealth.byoSpendUsdMtd.toFixed(2)} — doesn&apos;t count against the pool cap.
          </p>
        </div>
        {Object.keys(costBreakdown.byEvent).length === 0 ? (
          <EmptyState heading="No spend recorded yet" message="No budget_ledger rows have landed this month." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <h4 className="text-sm font-medium text-ink">By event</h4>
              <ul className="text-sm text-ink-muted">
                {Object.entries(costBreakdown.byEvent).map(([event, cost]) => (
                  <li key={event} className="flex justify-between gap-4">
                    <span>{event}</span>
                    <span>${cost.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-1">
              <h4 className="text-sm font-medium text-ink">By model</h4>
              <ul className="text-sm text-ink-muted">
                {Object.entries(costBreakdown.byModel).map(([model, cost]) => (
                  <li key={model} className="flex justify-between gap-4">
                    <span>{model}</span>
                    <span>${cost.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <h4 className="text-sm font-medium text-ink">Pool vs BYO</h4>
              <p className="text-sm text-ink-muted">
                Pool: ${costBreakdown.poolUsd.toFixed(2)} · BYO: ${costBreakdown.byoUsd.toFixed(2)}
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h3 className="font-medium text-ink">Engagement</h3>
        {totalMatches === 0 ? (
          <EmptyState heading="No matches yet" message="Nobody has been scored against the pool yet." />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-medium text-ink">All-time</h4>
                <ul className="text-sm text-ink-muted">
                  {(Object.entries(engagement.totalsByState) as Array<[string, number]>).map(([state, count]) => (
                    <li key={state} className="flex justify-between gap-4">
                      <span className="capitalize">{state}</span>
                      <span>{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-medium text-ink">Last 7 days</h4>
                <ul className="text-sm text-ink-muted">
                  {(Object.entries(engagement.last7DaysByState) as Array<[string, number]>).map(([state, count]) => (
                    <li key={state} className="flex justify-between gap-4">
                      <span className="capitalize">{state}</span>
                      <span>{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-sm text-ink-muted">
              Saves : dismissals ratio:{" "}
              <span className="font-medium text-ink">
                {engagement.savesToDismissalsRatio === null ? "—" : engagement.savesToDismissalsRatio.toFixed(2)}
              </span>
            </p>
            <div className="flex flex-col gap-1">
              <h4 className="text-sm font-medium text-ink">Applied, by user</h4>
              {engagement.appliedByUser.length === 0 ? (
                <p className="text-sm text-ink-muted">No applications recorded yet.</p>
              ) : (
                <ul className="text-sm text-ink-muted">
                  {engagement.appliedByUser.map((row) => (
                    <li key={row.userId} className="flex justify-between gap-4">
                      <span className="font-mono">{row.userId}</span>
                      <span>{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="font-medium text-ink">Pool freshness</h3>
        {poolFreshness.postingsCount === 0 ? (
          <EmptyState heading="Pool is empty" message="Discovery hasn't landed any postings yet." />
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              <span className="font-medium text-ink">{poolFreshness.postingsCount}</span> postings tracked ·{" "}
              <span className="font-medium text-ink">{poolFreshness.expiredCount}</span> expired
            </p>
            <p className="text-sm text-ink-muted">
              Newest seen: {poolFreshness.newestLastSeenAt ? new Date(poolFreshness.newestLastSeenAt).toLocaleString() : "—"}
            </p>
            <p className="text-sm text-ink-muted">
              Oldest seen: {poolFreshness.oldestLastSeenAt ? new Date(poolFreshness.oldestLastSeenAt).toLocaleString() : "—"}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
