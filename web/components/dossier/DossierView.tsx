import type { DossierViewModel } from "@/lib/dossier/derive";
import { Badge } from "@/components/ui/Badge";
import { SourceChip } from "./SourceChip";
import { MirrorSlot } from "./MirrorSlot";
import { ChangeLog } from "./ChangeLog";
import { ValidationBanner } from "./ValidationBanner";
import { LogisticsEditor } from "./LogisticsEditor";
import { DossierExportRow } from "./DossierExportRow";

function BandLabel({ children }: { children: string }) {
  return (
    <h2 className="border-b border-line pb-2 text-xs uppercase tracking-[0.2em] text-ink-muted">{children}</h2>
  );
}

function Row({ label, value, source }: { label: string; value: string | null; source?: DossierViewModel["facts"]["anchor"]["source"] }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="text-ink">{value}</span>
      {source && <SourceChip source={source} />}
    </div>
  );
}

/**
 * The dossier's flagship layout (V3A_DESIGN §3). Server component — the
 * only client-side island is `LogisticsEditor` (the two typed inline-edit
 * fields); everything else is a calm, read-only render of the derived view
 * model, staggered `panel-enter` per band.
 */
export function DossierView({ dossier, copyBlock }: { dossier: DossierViewModel; copyBlock: string }) {
  const { header, mirror, facts, wants, texture, completeness, validation, events } = dossier;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-5xl tracking-tight text-ink">{header.name}</h1>
        {header.anchorLine && <p className="text-lg text-ink-muted">{header.anchorLine}</p>}
        <p className="text-sm text-ink-muted">{header.statusLine}</p>
      </header>

      <DossierExportRow copyBlock={copyBlock} />

      <ValidationBanner validation={validation} />

      {completeness.doneCount < completeness.totalCount && (
        <p className="text-sm text-ink-muted">
          Finish your intake — {completeness.totalCount - completeness.doneCount} modules left.
        </p>
      )}

      <MirrorSlot mirror={mirror} />

      <section className="panel-enter flex flex-col gap-4" style={{ animationDelay: "0ms" }}>
        <BandLabel>Facts</BandLabel>
        <Row
          label="Anchor"
          value={facts.anchor.freeText ?? ([facts.anchor.title, facts.anchor.company].filter(Boolean).join(" · ") || null)}
          source={facts.anchor.source}
        />
        <Row label="Evidence" value={facts.evidence.provided ? "resume on file" : "not provided yet"} source={facts.evidence.source} />
        {facts.skills.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-muted">Skills</span>
            {facts.skills.map((skill) => (
              <Badge key={skill} tone="neutral">
                {skill}
              </Badge>
            ))}
          </div>
        )}
        {facts.metrics.source && (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">Confirmed metrics</span>
              <SourceChip source={facts.metrics.source} />
            </div>
            {facts.metrics.confirmed.length > 0 ? (
              <ul className="flex flex-col gap-1 pl-4">
                {facts.metrics.confirmed.map((metric) => (
                  <li key={metric} className="text-ink">
                    “{metric}”
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">no confirmed metrics yet</p>
            )}
            {facts.metrics.heldBackCount > 0 && (
              <details className="text-ink-muted">
                <summary>
                  {facts.metrics.heldBackCount} number{facts.metrics.heldBackCount === 1 ? "" : "s"} held back —
                  never used in materials
                </summary>
              </details>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-ink-muted">Logistics</span>
          <LogisticsEditor logistics={facts.logistics} />
        </div>
      </section>

      <section className="panel-enter flex flex-col gap-4" style={{ animationDelay: "60ms" }}>
        <BandLabel>Wants</BandLabel>
        {wants.values.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">Values</span>
              <SourceChip source={wants.valuesSource} />
            </div>
            <div className="flex flex-wrap gap-2">
              {wants.values.map((choice, i) => (
                <Badge key={i} tone="amber">
                  {choice.chosen}
                  {choice.other ? ` over ${choice.other}` : ""}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <Row label="Trajectory" value={wants.trajectory.direction} source={wants.trajectory.source} />
        {wants.environment.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">Environment</span>
              <SourceChip source={wants.environmentSource} />
            </div>
            <ul className="flex flex-col gap-1 pl-4">
              {wants.environment.map((choice, i) => (
                <li key={i} className="text-ink">
                  {choice.scenario}: {choice.chosen}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(wants.dealbreakers.hard.length > 0 || wants.dealbreakers.soft.length > 0) && (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">Dealbreakers</span>
              <SourceChip source={wants.dealbreakers.source} />
            </div>
            <div className="flex flex-wrap gap-2">
              {wants.dealbreakers.hard.map((item) => (
                <Badge key={item} tone="danger">
                  {item}
                </Badge>
              ))}
              {wants.dealbreakers.soft.map((item) => (
                <Badge key={item} tone="neutral">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {wants.tiers.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-ink-muted">Tiers</span>
            <ul className="flex flex-col gap-1 pl-4">
              {wants.tiers.map((tier) => (
                <li key={tier.key} className="text-ink">
                  {tier.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel-enter flex flex-col gap-4" style={{ animationDelay: "120ms" }}>
        <BandLabel>Texture</BandLabel>
        {texture.energy.hoursDisappear && (
          <blockquote className="border-l border-line pl-4 text-sm text-ink">
            “{texture.energy.hoursDisappear}”
            <SourceChip source={texture.energy.source} />
          </blockquote>
        )}
        {texture.energy.keptPuttingOff && (
          <blockquote className="border-l border-line pl-4 text-sm text-ink">
            “{texture.energy.keptPuttingOff}”
          </blockquote>
        )}
        {texture.voice.register && (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">Voice</span>
              <SourceChip source={texture.voice.source} />
            </div>
            <p className="text-ink">{texture.voice.register}</p>
            {texture.voice.signaturePhrases.length > 0 && (
              <p className="text-ink-muted">
                {texture.voice.signaturePhrases.map((phrase) => `"${phrase}"`).join(", ")}
              </p>
            )}
          </div>
        )}
        {(texture.reactionTaste.interestedCount > 0 || texture.reactionTaste.passedCount > 0) && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Reaction taste</span>
            <span className="text-ink">
              {texture.reactionTaste.interestedCount} interested · {texture.reactionTaste.passedCount} passed
            </span>
            <SourceChip source={texture.reactionTaste.source} />
          </div>
        )}
      </section>

      <ChangeLog events={events} />
    </div>
  );
}
