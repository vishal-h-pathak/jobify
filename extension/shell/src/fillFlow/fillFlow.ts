import type { EngineApi } from "../engineApi";
import type { SubmitPacket } from "../engineTypes";
import { toAtsMapKind } from "./atsMap";
import { fetchPacket, type PacketOutcome } from "./packetClient";
import { fetchMaterialFiles, materialsIncomplete } from "./materials";
import { buildChecklist, buildFullPacketHandoffLines, buildHandoffLines, type ChecklistItem, type HandoffLine } from "./handoffLines";

export interface FillFlowDeps {
  engine: EngineApi; // injected — see engineApi.ts's header for why
  fetchImpl: typeof fetch;
  appOrigin: string;
}

export type FillFlowResult =
  | { kind: "needs_setup" } // packet 409 -> "finish submitter setup in the app first"
  | { kind: "no_materials" } // packet 404
  | { kind: "packet_error"; status: number }
  | { kind: "generic"; packet: SubmitPacket; handoffLines: HandoffLine[] } // unmapped ATS -> pure handoff view
  | { kind: "filled"; packet: SubmitPacket; checklist: ChecklistItem[]; handoffLines: HandoffLine[]; reminders: string[] };

/**
 * "Fill this page" — fetch packet, fetch materials, survey the live page,
 * plan + execute fills via the injected engine, and shape the result for
 * the panel to render. `root` is always the ATS tab's `document`, reached
 * from the panel via the content-script bridge (content/atsFillBridge.ts);
 * this function itself never touches `chrome.*`.
 */
export async function runFillFlow(deps: FillFlowDeps, root: Document, postingId: string): Promise<FillFlowResult> {
  const packetResult = await packetOutcomeToFlowResult(await fetchPacket(deps, postingId));
  if (packetResult.kind !== "ok") return packetResult.result;
  let packet = packetResult.packet;

  const ats = toAtsMapKind(packet.posting.ats_kind);
  if (ats === "generic") {
    return { kind: "generic", packet, handoffLines: buildFullPacketHandoffLines(packet) };
  }

  let files = await fetchMaterialFiles(deps.fetchImpl, packet);
  if (materialsIncomplete(files, packet)) {
    // Expired signed URL — refetch the packet once for fresh URLs and retry.
    const retryOutcome = await packetOutcomeToFlowResult(await fetchPacket(deps, postingId));
    if (retryOutcome.kind !== "ok") return retryOutcome.result;
    packet = retryOutcome.packet;
    files = await fetchMaterialFiles(deps.fetchImpl, packet);
  }

  const survey = deps.engine.survey(root);
  const plan = deps.engine.planFills(survey, packet, ats);
  const report = await deps.engine.executeFills(root, survey, plan, files);
  const { valued, reminders } = buildHandoffLines(report, plan);

  return { kind: "filled", packet, checklist: buildChecklist(report), handoffLines: valued, reminders };
}

type PacketStep = { kind: "ok"; packet: SubmitPacket } | { kind: "stop"; result: FillFlowResult };

async function packetOutcomeToFlowResult(outcome: PacketOutcome): Promise<PacketStep> {
  if (outcome.kind === "ok") return { kind: "ok", packet: outcome.packet };
  if (outcome.kind === "needs_setup") return { kind: "stop", result: { kind: "needs_setup" } };
  if (outcome.kind === "no_materials") return { kind: "stop", result: { kind: "no_materials" } };
  return { kind: "stop", result: { kind: "packet_error", status: outcome.status } };
}

/** Honest, specific copy for each non-"filled" result — the panel renders this verbatim. */
export function fillFlowErrorMessage(result: FillFlowResult): string | null {
  switch (result.kind) {
    case "needs_setup":
      return "finish submitter setup in the app first";
    case "no_materials":
      return "Tailor this posting first, then come back here to fill it.";
    case "packet_error":
      return "Couldn't load your submit kit — try refreshing.";
    default:
      return null;
  }
}
