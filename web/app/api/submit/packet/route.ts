import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAccess } from "@/lib/db/access";
import { buildSubmitPacket } from "@/lib/submit/packet";

/**
 * `GET /api/submit/packet?posting_id=<id>` — assembles the full submit
 * packet (posting, identity, signed material URLs, answer-draft context)
 * for a future submit kit / browser extension. Same auth-gate-then-admin-
 * client pattern as every other authed route in this app (Global
 * Constraints). All actual assembly/branch-selection logic lives in
 * `buildSubmitPacket`; this handler is just auth + param parsing + status
 * mapping.
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!(await hasAccess(supabase, user))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const postingId = new URL(request.url).searchParams.get("posting_id");
  if (!postingId) {
    return NextResponse.json({ error: "posting_id required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const result = await buildSubmitPacket(admin, user.id, user.email ?? "", postingId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.packet);
}
