import type { User } from "@supabase/supabase-js";

/**
 * Admin = signed-in user whose email is in `ADMIN_EMAILS` (comma-separated,
 * compared case-insensitively after trim). No DB flag, no client-side
 * secret — server-side only, reads `process.env.ADMIN_EMAILS` fresh on
 * every call so a Vercel env change takes effect without a redeploy of
 * this module's state. An unset env var means nobody is admin; empty
 * entries from stray commas are ignored.
 */
export function isAdmin(user: Pick<User, "email"> | null | undefined): boolean {
  if (!user?.email) return false;
  const email = user.email.trim().toLowerCase();
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email);
}
