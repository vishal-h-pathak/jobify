import { VALUE_PAIRS } from "./values";
import { ENVIRONMENT_SCENARIOS } from "./environment";
import type { StructuredModuleKey } from "./index";

/**
 * V3A-1 integration seam: this session's own POST-body payload shapes are
 * pinned by session-prompts/31_v3a_modules.md task 2 (`values`'s
 * `{pair_id, choice}[]` is spelled out verbatim there) and are not
 * negotiable client contracts. Session 30's `incrementalDoc.ts::
 * applyModuleToDoc` — read directly from the sibling `feat/v3a-spine`
 * worktree while 30 was mid-build, since the pinned block only specifies
 * `applyModuleToDoc`'s outer signature, not each module's inner `extracted`
 * shape — independently assumed a different inner shape for `values`
 * (`{choices: {prompt, chosen, other?}[]}`), `environment`
 * (`{choices: {scenario, chosen}[]}`), `trajectory` (`note` instead of
 * `free_text`), and `reactions` (`{reactions: [...]}`, not a bare array).
 * These converters translate this module's payload into 30's shape at the
 * one call site that needs it (`applyModuleToDoc`) — everything else
 * (`extracted[key]`, this module's own `applyToDoc` writer, its receipt)
 * keeps using this session's pinned/native shape untouched. If 30's inner
 * shape changes before merge, only this file needs to move.
 */
export function toIncrementalDocExtracted(key: StructuredModuleKey, data: unknown): unknown {
  switch (key) {
    case "values": {
      const choices = data as Array<{ pair_id: string; choice: "a" | "b" }>;
      return {
        choices: choices.map((entry) => {
          const pair = VALUE_PAIRS.find((p) => p.pair_id === entry.pair_id);
          const chosen = pair ? (entry.choice === "a" ? pair.a : pair.b) : entry.pair_id;
          const other = pair ? (entry.choice === "a" ? pair.b : pair.a) : undefined;
          return { prompt: pair ? `${pair.a} vs. ${pair.b}` : entry.pair_id, chosen, other };
        }),
      };
    }
    case "environment": {
      const picks = data as Record<string, "a" | "b">;
      return {
        choices: ENVIRONMENT_SCENARIOS.map((scenario) => ({
          scenario: scenario.key,
          chosen: picks[scenario.key] === "a" ? scenario.a : scenario.b,
        })),
      };
    }
    case "trajectory": {
      const trajectory = data as { direction: string; free_text?: string };
      return { direction: trajectory.direction, note: trajectory.free_text };
    }
    default:
      return data;
  }
}
