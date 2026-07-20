import type { SessionSnapshot } from "../lib/onboarding/handleTurn";
import type { ExtractedState } from "../lib/profile/buildDoc";
import { MODULE_WRITERS, STRUCTURED_MODULE_KEYS } from "../lib/onboarding/moduleWriters";
import { MODULE_REGISTRY, markModuleComplete, type ModulesState } from "../lib/onboarding/moduleRegistry";
import { hasReachedReactionThreshold, reactionsReceipt, type ReactionEntry } from "../lib/onboarding/reactions";
import { ALEX_QUINN_ANCHOR } from "./personas/data";

/**
 * Session-prompt 45, task 1: "Zero-LLM modules (values/dealbreakers/
 * energy/environment/trajectory/reactions) are driven through their pure
 * writers directly — the chat sim covers the LLM stages." This builds the
 * initial `SessionSnapshot` the chat loop starts from: anchor + all six
 * zero-LLM modules populated with Alex Quinn data via the SAME
 * parseBody/receipt functions the real `[key]/route.ts` and
 * `reactions/route.ts` handlers use — just called directly, with no HTTP,
 * no Supabase, and (deliberately) no `maybeFireCheckpoint` call, since
 * that fires a real background hunt dispatch this sim must never trigger.
 */

const ALEX_QUINN_VALUES_PAYLOAD = [
  { pair_id: "mission_prestige", choice: "a" as const },
  { pair_id: "hours_equity", choice: "a" as const },
  { pair_id: "specialist_generalist", choice: "a" as const },
  { pair_id: "autonomy_mentorship", choice: "a" as const },
  { pair_id: "stability_upside", choice: "a" as const },
  { pair_id: "ic_leadership", choice: "a" as const },
  { pair_id: "remote_in_person", choice: "a" as const },
];

const ALEX_QUINN_DEALBREAKERS_PAYLOAD = {
  hard_disqualifiers: ["No crypto/web3-only roles", "No unpaid on-call rotations"],
  soft_concerns: ["Prefers not to relocate away from Denver without a strong comp uplift"],
};

const ALEX_QUINN_ENERGY_PAYLOAD = {
  hours_disappear: "Debugging a gnarly distributed-systems failure until it clicks.",
  kept_putting_off: "Writing the internal platform's onboarding docs.",
};

const ALEX_QUINN_ENVIRONMENT_PAYLOAD = {
  team_size: "b" as const,
  pace: "b" as const,
  ambiguity: "a" as const,
  management_appetite: "b" as const,
};

const ALEX_QUINN_TRAJECTORY_PAYLOAD = {
  direction: "climb" as const,
  free_text: "Want to keep growing platform/infra scope at a larger company.",
};

const ZERO_LLM_PAYLOADS: Record<(typeof STRUCTURED_MODULE_KEYS)[number], unknown> = {
  values: ALEX_QUINN_VALUES_PAYLOAD,
  dealbreakers: ALEX_QUINN_DEALBREAKERS_PAYLOAD,
  energy: ALEX_QUINN_ENERGY_PAYLOAD,
  environment: ALEX_QUINN_ENVIRONMENT_PAYLOAD,
  trajectory: ALEX_QUINN_TRAJECTORY_PAYLOAD,
};

const ALEX_QUINN_REACTIONS: ReactionEntry[] = [
  { posting_id: "posting-1", title: "Staff Platform Engineer", company: "Acme Corp", reaction: "interested" },
  { posting_id: "posting-2", title: "Senior Infrastructure Engineer", company: "Beacon Systems", reaction: "interested" },
  { posting_id: "posting-3", title: "ML Platform Engineer", company: "Delta Labs", reaction: "interested" },
  { posting_id: "posting-4", title: "Backend Engineer, Payments", company: "Fenwick", reaction: "not_interested" },
  { posting_id: "posting-5", title: "Distributed Systems Engineer", company: "Gridline", reaction: "interested" },
  { posting_id: "posting-6", title: "Site Reliability Engineer", company: "Harborlight", reaction: "interested" },
];

export function seedInitialSession(userId: string): SessionSnapshot {
  void userId; // no db write happens here — the id exists only for call-site symmetry with the rest of the sim.

  let modules: ModulesState = {};
  let extracted: Record<string, unknown> = { anchor: { ...ALEX_QUINN_ANCHOR } };

  const anchorReceipt = MODULE_REGISTRY.anchor.receipt(extracted.anchor as Record<string, unknown>) ?? "anchored";
  modules = markModuleComplete({ modules }, "anchor", anchorReceipt);

  for (const key of STRUCTURED_MODULE_KEYS) {
    const writer = MODULE_WRITERS[key];
    const parsed = writer.parseBody(ZERO_LLM_PAYLOADS[key]);
    if (!parsed.ok) {
      throw new Error(`seedZeroLlmModules: invalid seeded payload for "${key}": ${parsed.error}`);
    }
    extracted = { ...extracted, [key]: parsed.data };
    modules = markModuleComplete({ modules }, key, writer.receipt(parsed.data));
  }

  extracted = { ...extracted, reactions: ALEX_QUINN_REACTIONS };
  if (hasReachedReactionThreshold(ALEX_QUINN_REACTIONS)) {
    modules = markModuleComplete({ modules }, "reactions", reactionsReceipt(ALEX_QUINN_REACTIONS));
  }

  return {
    stage: "calibration",
    messages: [],
    extracted: extracted as unknown as ExtractedState,
    status: "in_progress",
    modules,
  };
}
