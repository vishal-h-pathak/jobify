import type { InterviewStage } from "../lib/anthropic/interview";

export interface TurnRecord {
  turnIndex: number;
  stageBefore: InterviewStage;
  stageAfter: InterviewStage;
  assistantText: string;
  // INT2 (session 55): the engine's two-kind taxonomy — "no_progress" (the
  // target intent made no progress despite a full round-trip) and
  // "retry_exhausted" (the question came back empty/invalid even after one
  // retry) — replaces the old three-kind reprompt/fallback/loop_breaker set.
  fallbackKind?: "no_progress" | "retry_exhausted";
  done: boolean;
  extractedAfter: Record<string, unknown>;
}

export interface InvariantResult {
  passed: boolean;
  failures: string[];
}

const STAGE_ORDER: InterviewStage[] = ["anchor", "calibration", "resume", "targeting", "done"];
const LANDING_BUDGET_TURNS = 4;

function stageIndex(stage: InterviewStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** True once the field this stage's record_* tool call lands has appeared. */
function stageLanded(stage: InterviewStage, extracted: Record<string, unknown>): boolean {
  if (stage === "calibration") {
    const calibration = extracted.calibration as { skills?: unknown } | undefined;
    return Array.isArray(calibration?.skills) && calibration!.skills!.length > 0;
  }
  if (stage === "targeting") {
    const identity = extracted.identity as { name?: unknown } | undefined;
    return typeof identity?.name === "string" && identity.name.trim().length > 0;
  }
  // resume's landing (record_resume) is the same event as its stage
  // transition — by the time stageAfter !== "resume" it has already
  // landed, so there's nothing further to track turn-by-turn here.
  return true;
}

/**
 * PROGRESS invariant (session-prompt 45, task 3): stage never regresses;
 * every record_* tool lands within 4 turns of its stage starting; the
 * session reaches `done` within `maxTurns`.
 */
export function checkProgressInvariant(records: TurnRecord[], maxTurns: number): InvariantResult {
  const failures: string[] = [];
  let stageStartTurn = 0;
  let currentStage: InterviewStage | undefined;

  for (const rec of records) {
    if (currentStage !== undefined && stageIndex(rec.stageBefore) < stageIndex(currentStage)) {
      failures.push(`turn ${rec.turnIndex}: stage regressed from "${currentStage}" to "${rec.stageBefore}"`);
    }

    if (rec.stageBefore !== currentStage) {
      currentStage = rec.stageBefore;
      stageStartTurn = rec.turnIndex;
    }

    const turnsInStage = rec.turnIndex - stageStartTurn + 1;
    if (turnsInStage > LANDING_BUDGET_TURNS && !stageLanded(rec.stageBefore, rec.extractedAfter)) {
      failures.push(
        `turn ${rec.turnIndex}: stage "${rec.stageBefore}" has run ${turnsInStage} turns without its record_* tool landing (budget: ${LANDING_BUDGET_TURNS})`
      );
    }

    if (stageIndex(rec.stageAfter) < stageIndex(rec.stageBefore)) {
      failures.push(`turn ${rec.turnIndex}: stage regressed from "${rec.stageBefore}" to "${rec.stageAfter}" within the same turn`);
    }
    currentStage = rec.stageAfter;
  }

  const lastRecord = records[records.length - 1];
  if (!lastRecord?.done) {
    failures.push(`session did not reach "done" within ${maxTurns} turns (ran ${records.length})`);
  }

  return { passed: failures.length === 0, failures };
}

/** NO-DOUBLE-FALLBACK invariant: the same fallback_kind never fires on two consecutive turns. */
export function checkNoDoubleFallbackInvariant(records: TurnRecord[]): InvariantResult {
  const failures: string[] = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]!.fallbackKind;
    const curr = records[i]!.fallbackKind;
    if (prev && curr && prev === curr) {
      failures.push(`turns ${records[i - 1]!.turnIndex} and ${records[i]!.turnIndex}: fallback_kind "${curr}" fired twice consecutively`);
    }
  }
  return { passed: failures.length === 0, failures };
}

/** LEDGER invariant: ledger writes to the fake db == real model calls, exactly. */
export function checkLedgerInvariant(ledgerRowCount: number, realModelCallCount: number): InvariantResult {
  if (ledgerRowCount === realModelCallCount) return { passed: true, failures: [] };
  return {
    passed: false,
    failures: [`ledger has ${ledgerRowCount} row(s) but ${realModelCallCount} real model call(s) were made`],
  };
}
