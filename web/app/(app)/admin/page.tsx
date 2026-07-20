import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listAllUserEmails, listUsersOverview } from "@/lib/admin/users";
import { listInvitesForAdmin } from "@/lib/admin/invites";
import { listAllowlistedEmails } from "@/lib/admin/allowlist";
import { getPoolHealth } from "@/lib/admin/poolHealth";
import { getSpendOverview } from "@/lib/admin/spend";
import { getOnboardingOverview } from "@/lib/admin/onboardingOverview";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { MintInviteForm } from "./MintInviteForm";
import { FriendsCard } from "./FriendsCard";
import { ProfileReviewRow } from "./ProfileReviewRow";

// Every field here changes as friends sign up / the worker runs — never
// statically cache (same reasoning as the settings page).
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    // ADM-3: a signed-in non-admin gets a plain 404, not a redirect that
    // would confirm /admin exists — only "unauthenticated" (which every
    // protected route in this app already reveals) still sends to /login.
    if (gate.reason === "unauthenticated") redirect("/login");
    notFound();
  }

  // Only constructed after requireAdmin() confirms the caller is an admin.
  const admin = createSupabaseAdminClient();
  const emails = await listAllUserEmails(admin);
  const [invites, friends, users, poolHealth, spend, onboarding] = await Promise.all([
    listInvitesForAdmin(admin, emails),
    listAllowlistedEmails(admin),
    listUsersOverview(admin, emails),
    getPoolHealth(admin),
    getSpendOverview(admin),
    getOnboardingOverview(admin),
  ]);

  const capPct = poolHealth.globalCapUsd > 0 ? Math.min(100, (poolHealth.poolSpendUsdMtd / poolHealth.globalCapUsd) * 100) : 0;
  const spendByUser = new Map(spend.byUser.map((row) => [row.userId, row.costUsd]));
  const dailySpendMax = Math.max(1, ...spend.last14Days.map((d) => d.costUsd));

  // §1 Spend's "per-user totals" + §2 Users-and-invites' onboarding join,
  // folded onto the existing per-user Users table rather than a second
  // parallel table — see the ADM-3 session report for why.
  const enrichedUsers = users.map((user) => {
    const ob = onboarding.get(user.userId);
    return {
      ...user,
      spendUsdAllTime: spendByUser.get(user.userId) ?? 0,
      onboardingStage: ob?.stage ?? null,
      onboardingStatus: ob?.status ?? null,
      onboardingCompletedAt: ob?.completedAt ?? null,
      lastActivityAt: ob?.lastActivityAt ?? null,
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Admin</h1>

      <Card className="flex flex-col gap-4">
        <h2 className="font-medium text-ink">Spend</h2>
        <p className="text-xs text-ink-muted">
          At Anthropic API list prices, from every `budget_ledger` row ever written — not a real invoice, just the
          model-call cost this app tracks for itself.
        </p>
        <p className="text-sm text-ink-muted">
          All-time total: <span className="font-medium text-ink">${spend.allTimeTotalUsd.toFixed(2)}</span>
        </p>
        {Object.keys(spend.byEvent).length === 0 ? (
          <EmptyState heading="No spend recorded yet" message="No budget_ledger rows exist." />
        ) : (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-ink">By verb (all-time)</h3>
            <ul className="text-sm text-ink-muted">
              {Object.entries(spend.byEvent)
                .sort(([, a], [, b]) => b - a)
                .map(([event, cost]) => (
                  <li key={event} className="flex justify-between gap-4">
                    <span>{event}</span>
                    <span>${cost.toFixed(2)}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-ink">Last 14 days</h3>
          <div className="flex flex-col gap-1">
            {spend.last14Days.map((day) => (
              <div key={day.date} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-ink-muted">{day.date}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-amber"
                    style={{ width: `${(day.costUsd / dailySpendMax) * 100}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-ink-muted">${day.costUsd.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-muted">Per-user all-time totals are in the Users table&apos;s Spend column below.</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-medium text-ink">Invites</h2>
        <MintInviteForm />
        {invites.length === 0 ? (
          <EmptyState heading="No invites yet" message="Mint one above to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-ink-muted">
                  <th className="pb-2 pr-4 font-medium">Code</th>
                  <th className="pb-2 pr-4 font-medium">Created</th>
                  <th className="pb-2 pr-4 font-medium">Claimed by</th>
                  <th className="pb-2 font-medium">Claimed at</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.code} className="border-t border-line">
                    <td className="py-2 pr-4 font-mono">{invite.code}</td>
                    <td className="py-2 pr-4 text-ink-muted">{new Date(invite.createdAt).toLocaleDateString()}</td>
                    <td className="py-2 pr-4">
                      {invite.claimedByEmail ?? <span className="text-ink-muted">unclaimed</span>}
                    </td>
                    <td className="py-2 text-ink-muted">
                      {invite.claimedAt ? new Date(invite.claimedAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-medium text-ink">Friends</h2>
        <FriendsCard rows={friends} />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-medium text-ink">Users</h2>
        {enrichedUsers.length === 0 ? (
          <EmptyState heading="No users yet" message="Nobody has signed up and claimed an invite yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-ink-muted">
                  <th className="pb-2 pr-4 font-medium">Email</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Onboarding</th>
                  <th className="pb-2 pr-4 font-medium">Last activity</th>
                  <th className="pb-2 pr-4 font-medium">Matches</th>
                  <th className="pb-2 pr-4 font-medium">Spend MTD</th>
                  <th className="pb-2 pr-4 font-medium">Spend all-time</th>
                  <th className="pb-2 pr-4 font-medium">BYO key</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrichedUsers.map((user) => (
                  <ProfileReviewRow key={user.userId} user={user} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium text-ink">Pool health</h2>
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">{poolHealth.postingsCount}</span> postings tracked
          {poolHealth.newestLastSeenAt && (
            <> · newest seen {new Date(poolHealth.newestLastSeenAt).toLocaleString()}</>
          )}
        </p>
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
        <p className="text-xs text-ink-muted">
          Discovery runs daily on cron; per-user scoring is triggered on demand — use a row's "Run hunt" button
          above, or wait for a friend to hit "Run my hunt" on their own feed.
        </p>
      </Card>
    </div>
  );
}
