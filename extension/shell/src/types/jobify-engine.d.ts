// Ambient declaration for the real fill engine (`extension/engine/src/
// index.ts`), built in session 41's sibling worktree and NOT present in
// this one. This is the only reason `content/atsFillBridge.ts`'s
// `import ... from "jobify-engine"` type-checks and unit-tests (via
// `vi.mock("jobify-engine", ...)`) standalone in this package.
//
// The root build tool (`extension/build.mjs`, owned by this session) aliases
// the bare specifier "jobify-engine" to the real relative path
// `../engine/src/index.ts` at bundle time. Once this branch merges with
// session 41's, TypeScript's normal file resolution finds the real module
// and takes precedence over this ambient declaration automatically — this
// file becomes redundant at that point (safe to delete, harmless to keep).
//
// The shape below is the pinned public API from `41_v3c_e1_engine.md`,
// copied verbatim — see `engineTypes.ts`'s header for the same contract.
declare module "jobify-engine" {
  import type { AtsMapKind, EngineFiles, FillInstruction, FillReport, Survey, SubmitPacket } from "../engineTypes";

  export function survey(root: Document): Survey;
  export function planFills(s: Survey, packet: SubmitPacket, ats: AtsMapKind | "generic"): FillInstruction[];
  export function executeFills(root: Document, s: Survey, plan: FillInstruction[], files: EngineFiles): Promise<FillReport>;
}
