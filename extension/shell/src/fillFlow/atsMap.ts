import type { AtsMapKind } from "../engineTypes";

// `packet.posting.ats_kind` comes from `web/lib/submit/atsDetect.ts`'s
// broader `AtsKind` (8 values: greenhouse/lever/ashby/workday/icims/
// smartrecruiters/linkedin/generic). The engine's L0 maps (E1) only cover 4
// of those (`AtsMapKind`) — anything else, including icims/smartrecruiters/
// linkedin and any future value, maps to "generic", where `planFills`
// deterministically returns `[]` per the pinned contract.
const SUPPORTED = new Set<string>(["greenhouse", "lever", "ashby", "workday"]);

export function toAtsMapKind(atsKind: string): AtsMapKind | "generic" {
  return SUPPORTED.has(atsKind) ? (atsKind as AtsMapKind) : "generic";
}
