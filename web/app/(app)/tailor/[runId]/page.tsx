import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { TailorViewer } from "./TailorViewer";

export const dynamic = "force-dynamic";

export default async function TailorPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ posting?: string }>;
}) {
  const { runId } = await params;
  const { posting } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const target = `/tailor/${runId}${posting ? `?posting=${encodeURIComponent(posting)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(target)}`);
  }

  if (!posting) {
    return (
      <EmptyState
        heading="Missing posting reference"
        message="This link is missing its posting reference — go back to your feed and open it from there."
      />
    );
  }

  return <TailorViewer runId={runId} postingId={posting} />;
}
