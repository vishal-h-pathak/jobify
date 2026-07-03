import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateSession } from "@/lib/db/onboardingSession";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const session = await getOrCreateSession(supabase, user.id);
  return NextResponse.json({
    stage: session.stage,
    messages: session.messages,
    status: session.status,
  });
}
