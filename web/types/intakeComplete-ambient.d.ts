// Ambient declaration for session 43's `web/lib/onboarding/intakeComplete.ts`
// (`intakeComplete(supabase, userId): Promise<boolean>`, UX1_DESIGN.md §1),
// built in a sibling worktree and NOT present in this one. This is the only
// reason `app/api/profile/export/route.ts`'s
// `import { intakeComplete } from "@/lib/onboarding/intakeComplete"` type-
// checks standalone in this worktree.
//
// `next.config.ts` (turbopack.resolveAlias) and `vitest.config.ts`
// (resolve.alias) both point the bare specifier at
// `lib/onboarding/intakeCompleteStub.ts` for build/test purposes. Once this
// branch merges with session 43's, TypeScript's normal file resolution
// finds the real module and takes precedence over this ambient declaration
// automatically — this file (and the build/test aliases) become redundant
// at that point, safe to delete.
declare module "@/lib/onboarding/intakeComplete" {
  import type { SupabaseClient } from "@supabase/supabase-js";
  import type { Database } from "@/lib/supabase/types";

  export function intakeComplete(supabase: SupabaseClient<Database>, userId: string): Promise<boolean>;
}
