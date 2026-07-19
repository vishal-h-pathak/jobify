import type { AtsMapKind, EngineFiles, FillInstruction, FillReport, Survey, SubmitPacket } from "../engineTypes";

// Resolution target for the "jobify-engine" bare specifier in THIS
// package's own test run only (wired via vitest.config.ts's `resolve.alias`
// — Vite must resolve the specifier to a real file before `vi.mock()` can
// intercept it, see atsFillBridge.test.ts). Every real test overrides these
// via `vi.mock("jobify-engine", ...)`; this file's bodies only exist so an
// accidental unmocked import doesn't crash the whole suite.
export function survey(_root: Document): Survey {
  return { url: "", fields: [], buttons: [] };
}

export function planFills(_s: Survey, _packet: SubmitPacket, _ats: AtsMapKind | "generic"): FillInstruction[] {
  return [];
}

export async function executeFills(_root: Document, _s: Survey, _plan: FillInstruction[], _files: EngineFiles): Promise<FillReport> {
  return { outcomes: [], requiredEmpty: [] };
}
