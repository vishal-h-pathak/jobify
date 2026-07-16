import { SourceChip } from "./SourceChip";
import type { MirrorNarrative } from "@/lib/dossier/derive";

/**
 * The mirror narrative slot (V3A_DESIGN §3): the accepted two paragraphs
 * once B2's mirror module ships, full-strength amber left rule — the page's
 * one anchor of meaning. Until `modules.mirror` exists, the calm placeholder
 * carries the slot instead of a broken/empty section.
 */
export function MirrorSlot({ mirror }: { mirror: MirrorNarrative }) {
  return (
    <section className="border-l-2 border-amber pl-6">
      {mirror.ready ? (
        <div className="flex flex-col gap-4">
          {mirror.paragraphs.map((paragraph, i) => (
            <p key={i} className="max-w-prose text-lg leading-relaxed text-ink">
              {paragraph}
            </p>
          ))}
          {mirror.source && (
            <div>
              <SourceChip source={mirror.source} />
            </div>
          )}
        </div>
      ) : (
        <p className="max-w-prose text-lg leading-relaxed text-ink-muted">{mirror.placeholder}</p>
      )}
    </section>
  );
}
