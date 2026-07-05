import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { Card } from "@/components/ui/Card";

// Same reasoning as ../page.tsx: this page's content will depend on
// data that changes as the worker runs (Tasks 4/5) — never statically
// cache.
export const dynamic = "force-dynamic";

// Minimal stub for this task: gate + placeholder content only. Task 4
// fills in the top half of this file (the "How it works" explainer) and
// Task 5 the bottom half (performance panels) — both on top of this gate.
export default async function AdminSystemPage() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    redirect(gate.reason === "unauthenticated" ? "/login" : "/feed");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-ink">System</h1>

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium text-ink">Coming soon</h2>
        <p className="text-sm text-ink-muted">Pipeline internals and performance panels land here.</p>
      </Card>
    </div>
  );
}
