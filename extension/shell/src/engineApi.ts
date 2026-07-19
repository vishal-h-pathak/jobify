import type { AtsMapKind, EngineFiles, FillInstruction, FillReport, Survey, SubmitPacket } from "./engineTypes";

// `EngineApi` — the shell's dependency-injection seam onto the fill engine
// (`extension/engine/**`, built in the parallel session 41 and not present
// in this worktree). Every orchestration function in this package (ready
// list matching, fill-flow, panel state) takes an `EngineApi` as a
// parameter instead of importing `survey`/`planFills`/`executeFills`
// directly, for two reasons:
//   1. It is exactly what the "fake engine" tests the session prompt asks
//      for need — a real interface to implement a test double against,
//      rather than `vi.mock`-ing a module path that doesn't exist here yet.
//   2. It isolates the ONE place that must import the real engine module
//      (the content-script entry point, `src/content/atsFillBridge.ts`) so
//      the rest of this package — everything covered by `tsc --noEmit` and
//      `vitest run` in this worktree — type-checks and tests standalone,
//      with no dependency on session 41's branch being present or merged.
//
// The shape below is exactly the pinned public API from
// `41_v3c_e1_engine.md` (see `engineTypes.ts`'s header) — nothing more. The
// shell must never call anything not on this interface (41's own export
// test guarantees the real package exports nothing else).
export interface EngineApi {
  survey(root: Document): Survey;
  planFills(s: Survey, packet: SubmitPacket, ats: AtsMapKind | "generic"): FillInstruction[];
  executeFills(root: Document, s: Survey, plan: FillInstruction[], files: EngineFiles): Promise<FillReport>;
}
