import type { ChangeLogEvent } from "@/lib/dossier/derive";

/**
 * "How this profile learns" (V3A_DESIGN §3): shaped for wave-3's dismissal/
 * tailor-edit events, which append to this same `events[]` prop. Ships the
 * pattern, not the plumbing — until then this renders one row per completed
 * module, or the pre-data stub copy.
 */
export function ChangeLog({ events }: { events: ChangeLogEvent[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-[0.2em] text-ink-muted">How this profile learns</h2>
      <div className="border-t border-line pt-3">
        {events.length === 0 ? (
          <p className="text-sm text-ink-muted">Learning starts after your first hunts.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((event) => (
              <li key={event.moduleKey} className="text-sm text-ink-muted">
                {event.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
