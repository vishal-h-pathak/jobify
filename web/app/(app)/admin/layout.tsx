import { AdminTabs } from "./AdminTabs";

/**
 * Purely presentational — does NOT perform its own auth check. Each page
 * under /admin (page.tsx, system/page.tsx) keeps its own requireAdmin()
 * gate, matching the pre-existing behavior of the single /admin page. Each
 * page also keeps its own `mx-auto max-w-3xl` content container, so this
 * layout only wraps the tab bar in a matching container instead of
 * introducing a second nested one.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-line px-6 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <AdminTabs />
        </div>
      </div>
      {children}
    </div>
  );
}
