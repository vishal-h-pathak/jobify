import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { extractText } from "@/lib/resume/extractText";

/**
 * Judgment call #8 (global-constraints.md): server-side PDF extraction, one
 * shared route for both onboarding's resume upload and Settings -> Resume.
 * `.txt`/`.md` uploads never hit this route — they stay client-side
 * `file.text()`, unchanged. Auth-gated like every other route in this
 * session (same getUser -> 401, isAdmin || hasClaimedInvite -> 403 pattern
 * as web/app/api/hunt/run/route.ts) even though it isn't LLM-costed: it
 * still accepts arbitrary user-uploaded file bytes.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!isAdmin(user) && !(await hasClaimedInvite(supabase))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await extractText(file.name, bytes);

  if (!result.ok) {
    // A semantically invalid upload (wrong type, too large, unreadable),
    // not a malformed request.
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }
  return NextResponse.json({ ok: true, text: result.text });
}
