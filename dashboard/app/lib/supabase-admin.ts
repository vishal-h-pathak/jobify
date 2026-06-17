import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client factory (service-role key).
 *
 * Every dashboard data access goes through API routes that use this
 * client — the browser never talks to Supabase directly. RLS is
 * enabled with no anon policies on public.jobs / application_attempts /
 * star_stories / pattern_analyses, so the service role (which bypasses
 * RLS) is the only way in, and middleware.ts gates these routes behind
 * the dashboard_auth cookie.
 *
 * Do not import from client components.
 */
export function createAdminClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const MISCONFIGURED_MSG =
  "Server misconfigured (missing Supabase env vars)";
