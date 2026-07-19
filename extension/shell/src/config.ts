// Public, build-time-baked config — never secrets. `SUPABASE_ANON_KEY` is
// the Supabase anon key, the same public value `web/lib/supabase/browser.ts`
// ships to every browser tab today (RLS is the actual security boundary,
// not key secrecy). The root build tool (`extension/build.mjs`) substitutes
// these three via esbuild `define` from env vars at build time; the
// fallbacks below only matter for `tsc`/`vitest` in this standalone
// package, which never reads real config.
export const SUPABASE_URL: string = typeof process !== "undefined" && process.env.JOBIFY_SUPABASE_URL ? process.env.JOBIFY_SUPABASE_URL : "https://placeholder.supabase.co";

export const SUPABASE_ANON_KEY: string =
  typeof process !== "undefined" && process.env.JOBIFY_SUPABASE_ANON_KEY ? process.env.JOBIFY_SUPABASE_ANON_KEY : "placeholder-anon-key";

export const APP_ORIGIN: string =
  typeof process !== "undefined" && process.env.JOBIFY_APP_ORIGIN ? process.env.JOBIFY_APP_ORIGIN : "https://placeholder.example.com";
