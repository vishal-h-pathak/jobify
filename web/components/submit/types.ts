// web/components/submit/types.ts
//
// Reconciled at the V3c P0 merge (reviewer fixup): the canonical pinned-
// contract types live in web/lib/submit/types.ts (session 40). The kit
// session (39) coded against its own field-identical local copy per the
// pinned contract; this re-export replaces it so there is exactly ONE
// definition of ApplicationProfile / SubmitPacket in the codebase.
export type { ApplicationProfile, SubmitPacket } from "@/lib/submit/types";
