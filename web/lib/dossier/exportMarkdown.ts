import type { DossierViewModel } from "./derive";

/**
 * Pure renderer over `deriveDossier`'s output (never re-derives from doc/
 * extracted — see `app/api/profile/export/route.ts` and `/profile`'s page,
 * both of which call `deriveDossier` once and pass the same view model
 * here and to `DossierView`). Render-what-exists: every section below
 * mirrors `DossierView.tsx`'s own truthy/length guards, so the exported
 * document never states a line the dossier page itself wouldn't show.
 */

export const AI_COPY_INSTRUCTION =
  "This is my verified professional profile — my background, values, working style, and " +
  "confirmed metrics, in my own words. Use it as ground truth when helping me with job-search tasks.";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(date: Date): string {
  return `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function renderFacts(facts: DossierViewModel["facts"]): string[] {
  const lines: string[] = ["## Facts", ""];

  const anchorText = facts.anchor.freeText ?? [facts.anchor.title, facts.anchor.company].filter(Boolean).join(" · ");
  if (anchorText) lines.push(`**Anchor:** ${anchorText}`, "");

  lines.push(`**Evidence:** ${facts.evidence.provided ? "resume on file" : "not provided yet"}`, "");

  if (facts.skills.length > 0) {
    lines.push(`**Skills:** ${facts.skills.join(", ")}`, "");
  }

  if (facts.metrics.source) {
    lines.push("**Confirmed metrics**", "");
    if (facts.metrics.confirmed.length > 0) {
      for (const metric of facts.metrics.confirmed) lines.push(`- "${metric}"`);
    } else {
      lines.push("- no confirmed metrics yet");
    }
    lines.push("");
    if (facts.metrics.heldBackCount > 0) {
      const noun = facts.metrics.heldBackCount === 1 ? "number" : "numbers";
      lines.push(`_${facts.metrics.heldBackCount} ${noun} held back — never used in materials._`, "");
    }
  }

  const { logistics } = facts;
  const logisticsLines: string[] = [];
  if (logistics.base) logisticsLines.push(`- Location: ${logistics.base}`);
  if (logistics.remoteAcceptable !== null) {
    logisticsLines.push(`- Remote: ${logistics.remoteAcceptable ? "Open to remote" : "On-site preferred"}`);
  }
  if (logistics.targetCompUsd) logisticsLines.push(`- Comp floor: ${logistics.targetCompUsd}`);
  if (logisticsLines.length > 0) {
    lines.push("**Logistics**", "", ...logisticsLines, "");
  }

  return lines;
}

function renderWants(wants: DossierViewModel["wants"]): string[] {
  const lines: string[] = ["## Wants", ""];

  if (wants.values.length > 0) {
    lines.push("**Values**", "");
    for (const choice of wants.values) {
      lines.push(`- ${choice.chosen}${choice.other ? ` over ${choice.other}` : ""}`);
    }
    lines.push("");
  }

  if (wants.trajectory.direction) {
    const note = wants.trajectory.note ? ` — ${wants.trajectory.note}` : "";
    lines.push(`**Trajectory:** ${wants.trajectory.direction}${note}`, "");
  }

  if (wants.environment.length > 0) {
    lines.push("**Environment**", "");
    for (const choice of wants.environment) lines.push(`- ${choice.scenario}: ${choice.chosen}`);
    lines.push("");
  }

  if (wants.dealbreakers.hard.length > 0 || wants.dealbreakers.soft.length > 0) {
    lines.push("**Dealbreakers**", "");
    for (const item of wants.dealbreakers.hard) lines.push(`- ${item}`);
    for (const item of wants.dealbreakers.soft) lines.push(`- ${item}`);
    lines.push("");
  }

  if (wants.dealbreakers.degreeGate) {
    lines.push(`**Degree requirement:** ${wants.dealbreakers.degreeGate}`, "");
  }

  if (wants.tiers.length > 0) {
    lines.push("**Target tiers**", "");
    for (const tier of wants.tiers) lines.push(`- ${tier.label}`);
    lines.push("");
  }

  return lines;
}

function renderTexture(texture: DossierViewModel["texture"]): string[] {
  const lines: string[] = ["## Texture", ""];

  if (texture.energy.hoursDisappear) lines.push(`> "${texture.energy.hoursDisappear}"`, "");
  if (texture.energy.keptPuttingOff) lines.push(`> "${texture.energy.keptPuttingOff}"`, "");

  if (texture.voice.register) {
    lines.push(`**Voice:** ${texture.voice.register}`, "");
    if (texture.voice.signaturePhrases.length > 0) {
      lines.push(texture.voice.signaturePhrases.map((phrase) => `"${phrase}"`).join(", "), "");
    }
  }

  if (texture.reactionTaste.interestedCount > 0 || texture.reactionTaste.passedCount > 0) {
    lines.push(
      `**Reaction taste:** ${texture.reactionTaste.interestedCount} interested · ${texture.reactionTaste.passedCount} passed`,
      ""
    );
  }

  return lines;
}

function renderChangeLog(events: DossierViewModel["events"]): string[] {
  if (events.length === 0) return [];
  const lines = ["## Recent changes", ""];
  for (const event of events.slice(-5)) lines.push(`- ${event.label}`);
  lines.push("");
  return lines;
}

/** Pure: `generatedAt` is passed in (never `new Date()` internally) so this is deterministically testable. */
export function renderDossierMarkdown(dossier: DossierViewModel, generatedAt: Date): string {
  const { header, facts, wants, texture, events } = dossier;

  const lines: string[] = [`# ${header.name}`, ""];
  if (header.anchorLine) lines.push(header.anchorLine, "");

  lines.push(...renderFacts(facts));
  lines.push(...renderWants(wants));
  lines.push(...renderTexture(texture));
  lines.push(...renderChangeLog(events));

  lines.push("---", "", `_Generated from my jobify profile, ${formatDate(generatedAt)}. Every line traces to my own words._`);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** "Copy for AI tools" block (session-prompts/44 build item 3): the instruction header, then the same markdown, exactly. */
export function renderDossierCopyBlock(dossier: DossierViewModel, generatedAt: Date): string {
  return `${AI_COPY_INSTRUCTION}\n\n${renderDossierMarkdown(dossier, generatedAt)}`;
}

/** `dossier-<first_name>-<YYYY-MM-DD>.md`, per session-prompts/44. Falls back to "profile" when there's no usable first name (e.g. the "Your profile" placeholder). */
export function dossierExportFilename(headerName: string, generatedAt: Date): string {
  const firstToken = headerName.trim().split(/\s+/)[0] ?? "";
  const safeFirst = firstToken.replace(/[^a-zA-Z0-9-]/g, "");
  const first = safeFirst ? safeFirst.toLowerCase() : "profile";
  const date = generatedAt.toISOString().slice(0, 10);
  return `dossier-${first}-${date}.md`;
}
