import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SubmitKit } from "@/components/submit/SubmitKit";

export const dynamic = "force-dynamic";

export default async function SubmitKitPage({ params }: { params: Promise<{ postingId: string }> }) {
  const { postingId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/submit/${postingId}`)}`);
  }

  return <SubmitKit postingId={postingId} userId={user.id} />;
}
