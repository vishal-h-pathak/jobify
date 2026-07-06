"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { AllowlistRow } from "@/lib/admin/allowlist";

/**
 * Add-email form + list for the SGN-1 friend allowlist: add a friend's
 * email here ahead of time and their first magic-link sign-in auto-mints
 * and auto-claims an invite for them (see lib/db/allowlist.ts) — no code
 * to hand out. `router.refresh()` after add/remove re-fetches the list
 * from the server component above, same pattern as MintInviteForm.
 */
export function FriendsCard({ rows }: { rows: AllowlistRow[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setEmail("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(rowEmail: string) {
    setRemovingEmail(rowEmail);
    try {
      await fetch("/api/admin/allowlist", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: rowEmail }),
      });
      router.refresh();
    } finally {
      setRemovingEmail(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          className="max-w-xs"
        />
        <Input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)"
          className="max-w-[10rem]"
        />
        <Button type="submit" variant="primary" busy={adding}>
          Add friend
        </Button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
      {rows.length === 0 ? (
        <EmptyState heading="No friends added yet" message="Add an email above — no invite code needed for them." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-ink-muted">
                <th className="pb-2 pr-4 font-medium">Email</th>
                <th className="pb-2 pr-4 font-medium">Note</th>
                <th className="pb-2 pr-4 font-medium">Added</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.email} className="border-t border-line">
                  <td className="py-2 pr-4">{row.email}</td>
                  <td className="py-2 pr-4 text-ink-muted">{row.note ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-muted">{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4 text-ink-muted">
                    {row.consumedAt ? `signed up ${new Date(row.consumedAt).toLocaleDateString()}` : "waiting"}
                  </td>
                  <td className="py-2">
                    <Button variant="danger-ghost" onClick={() => handleRemove(row.email)} busy={removingEmail === row.email}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
