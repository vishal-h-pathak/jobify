/**
 * INTSIM — the interview simulation harness (session-prompts/45).
 *
 * Drives the REAL onboarding chat loop (real model, real transport) against
 * a scripted synthetic user, using fully in-memory fake Supabase clients —
 * this process must never touch a real database. See `README.md` for what
 * this catches and why it exists, and run modes / cost.
 *
 * Not wired into vitest/CI: this is the pre-deploy smoke test for any
 * prompt/model/transport change, run by hand.
 */
import { PERSONA_NAMES, createPersona, type Persona, type PersonaName } from "./personas";
import { createFakeSupabase } from "./fakeSupabase";
import { seedInitialSession } from "./seedZeroLlmModules";
import { installNetworkGuard } from "./networkGuard";
import { pickSeededPoints } from "./seededRandom";
import { roundTripSnapshot } from "./recoverySnapshot";
import { checkNoRepeatInvariant } from "./repeatDetector";
import { checkMonotonicStateAcrossTurns } from "./monotonicState";
import {
  checkProgressInvariant,
  checkNoDoubleFallbackInvariant,
  checkLedgerInvariant,
  type TurnRecord,
} from "./turnInvariants";
import { checkTruncationInvariant, type TruncationEvent } from "./truncationDetector";
import { formatVerdictTable, type PersonaVerdict } from "./report";
import { loadDotEnvLocalIntoProcessEnv } from "./envFile";
import { handleOnboardingTurn, type SessionSnapshot } from "../lib/onboarding/handleTurn";
import { maybeGenerateCalibrationPrompts } from "../lib/onboarding/maybeGenerateCalibration";
import { runInterviewTurn, runCalibrationGeneration, type ChatMessage } from "../lib/anthropic/interview";
import type { ExtractedState } from "../lib/profile/buildDoc";

const DEFAULT_MAX_TURNS = 25;
const ALEX_QUINN_EMAIL = "alex.quinn@example.com";

interface CliArgs {
  personas: PersonaName[];
  maxTurns: number;
}

function parseArgs(argv: string[]): CliArgs {
  let personaArg: string | undefined;
  let turnsArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--persona") personaArg = argv[++i];
    else if (argv[i] === "--turns") turnsArg = argv[++i];
  }

  if (personaArg && !(PERSONA_NAMES as readonly string[]).includes(personaArg)) {
    throw new Error(`unknown persona "${personaArg}" — choose from: ${PERSONA_NAMES.join(", ")}`);
  }
  const personas = personaArg ? [personaArg as PersonaName] : [...PERSONA_NAMES];

  const maxTurns = turnsArg ? Number(turnsArg) : DEFAULT_MAX_TURNS;
  if (!Number.isFinite(maxTurns) || maxTurns <= 0) {
    throw new Error(`--turns must be a positive number, got "${turnsArg}"`);
  }

  return { personas, maxTurns };
}

interface PersonaRunResult {
  persona: PersonaName;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failureSummary: string[];
  error?: string;
}

function sessionSnapshotFromRow(row: {
  stage: SessionSnapshot["stage"];
  messages: ChatMessage[];
  extracted: Record<string, unknown>;
  status: SessionSnapshot["status"];
  modules: SessionSnapshot["modules"];
}): SessionSnapshot {
  return {
    stage: row.stage,
    messages: row.messages,
    extracted: row.extracted as unknown as ExtractedState,
    status: row.status,
    modules: row.modules,
  };
}

async function runPersona(personaName: PersonaName, maxTurns: number): Promise<PersonaRunResult> {
  const userId = `sim-${personaName}`;
  const fakeDb = createFakeSupabase();
  const failureSummary: string[] = [];

  const initial = seedInitialSession(userId);
  fakeDb.seedSessionRow({
    user_id: userId,
    stage: initial.stage,
    messages: initial.messages,
    extracted: initial.extracted as unknown as Record<string, unknown>,
    modules: initial.modules,
    status: initial.status,
  });

  let modelCallCount = 0;
  let turnIndex = 0;
  const truncationEvents: TruncationEvent[] = [];

  function recordTruncationIfCapped(result: { usage: { outputTokens: number }; maxTokens?: number }): void {
    if (result.maxTokens !== undefined && result.usage.outputTokens === result.maxTokens) {
      truncationEvents.push({ turnIndex, outputTokens: result.usage.outputTokens, maxTokens: result.maxTokens });
    }
  }

  const countedRunTurn = async (history: ChatMessage[]) => {
    modelCallCount++;
    const result = await runInterviewTurn(history);
    recordTruncationIfCapped(result);
    return result;
  };
  const countedRunGeneration: typeof runCalibrationGeneration = async (anchor) => {
    modelCallCount++;
    const result = await runCalibrationGeneration(anchor);
    recordTruncationIfCapped(result);
    return result;
  };

  try {
    await maybeGenerateCalibrationPrompts({
      userId,
      session: { stage: initial.stage, messages: initial.messages, extracted: initial.extracted, status: initial.status },
      supabase: fakeDb.client,
      admin: fakeDb.client,
      runGeneration: countedRunGeneration,
    });

    let session = sessionSnapshotFromRow(fakeDb.getSessionRow(userId)!);

    const persona: Persona = createPersona(personaName);
    const records: TurnRecord[] = [];
    const assistantTexts: string[] = session.messages.filter((m) => m.role === "assistant").map((m) => m.content);
    const extractedSnapshots: Record<string, unknown>[] = [session.extracted as unknown as Record<string, unknown>];
    const turnsPerStage = new Map<string, number>();

    // RECOVERY invariant (task 3): 2-3 random-but-seeded points, capped to
    // a range a real run typically reaches so they actually fire.
    const recoveryPoints = pickSeededPoints(`${personaName}:recovery`, 3, 2, Math.max(2, Math.min(maxTurns - 1, 10)));
    const recoveryPointsFired: number[] = [];

    while (session.status !== "complete" && turnIndex < maxTurns) {
      turnIndex++;
      const stageBefore = session.stage;
      const lastAssistantText = [...session.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
      const turnInStage = (turnsPerStage.get(stageBefore) ?? 0) + 1;
      turnsPerStage.set(stageBefore, turnInStage);

      const userMessage = persona.answer({ stage: stageBefore, lastAssistantText, turnInStage });

      const savesBefore = fakeDb.sessionUpdateCount(userId);
      const result = await handleOnboardingTurn({
        userId,
        userEmail: ALEX_QUINN_EMAIL,
        userMessage,
        session,
        supabase: fakeDb.client,
        admin: fakeDb.client,
        runTurn: countedRunTurn,
      });

      const savesAfter = fakeDb.sessionUpdateCount(userId);
      if (savesAfter !== savesBefore + 1) {
        failureSummary.push(
          `PERSIST: turn ${turnIndex} expected exactly one saveSession call, saw ${savesAfter - savesBefore}`
        );
      }

      let newSession = sessionSnapshotFromRow(fakeDb.getSessionRow(userId)!);

      assistantTexts.push(result.assistantText);
      extractedSnapshots.push(newSession.extracted as unknown as Record<string, unknown>);
      records.push({
        turnIndex,
        stageBefore,
        stageAfter: newSession.stage,
        assistantText: result.assistantText,
        fallbackKind: result.fallback_kind,
        done: result.done,
        extractedAfter: newSession.extracted as unknown as Record<string, unknown>,
      });

      if (recoveryPoints.includes(turnIndex) && !result.done) {
        const before = newSession.extracted as unknown as Record<string, unknown>;
        const rebuilt = roundTripSnapshot(newSession);
        if (JSON.stringify(rebuilt.extracted) !== JSON.stringify(before)) {
          failureSummary.push(`RECOVERY: turn ${turnIndex} extracted state was not byte-identical across the recovery boundary`);
        }
        newSession = rebuilt;
        recoveryPointsFired.push(turnIndex);
      }

      session = newSession;
    }

    const noRepeat = checkNoRepeatInvariant(assistantTexts);
    if (!noRepeat.passed) {
      for (const f of noRepeat.failures) {
        failureSummary.push(`NO-REPEAT: turn ${f.turnIndex} repeats turn ${f.matchedTurnIndex}${f.sharedWindow ? ` ("${f.sharedWindow}")` : ""}`);
      }
    }

    const monotonic = checkMonotonicStateAcrossTurns(extractedSnapshots);
    if (!monotonic.passed) {
      for (const f of monotonic.failures) {
        for (const v of f.violations) {
          failureSummary.push(`MONOTONIC-STATE: "${v.path}" disappeared/shrank at turn ${f.turnIndex}`);
        }
      }
    }

    const progress = checkProgressInvariant(records, maxTurns);
    if (!progress.passed) for (const f of progress.failures) failureSummary.push(`PROGRESS: ${f}`);

    const noDoubleFallback = checkNoDoubleFallbackInvariant(records);
    if (!noDoubleFallback.passed) for (const f of noDoubleFallback.failures) failureSummary.push(`NO-DOUBLE-FALLBACK: ${f}`);

    const ledger = checkLedgerInvariant(fakeDb.getLedgerRows().length, modelCallCount);
    if (!ledger.passed) for (const f of ledger.failures) failureSummary.push(`LEDGER: ${f}`);

    const truncation = checkTruncationInvariant(truncationEvents);
    if (!truncation.passed) for (const f of truncation.failures) failureSummary.push(`TRUNCATION: ${f}`);

    if (recoveryPointsFired.length === 0) {
      failureSummary.push(`RECOVERY: no recovery points fired (requested turns ${recoveryPoints.join(",")}, run only reached turn ${turnIndex})`);
    }

    const ledgerRows = fakeDb.getLedgerRows();
    return {
      persona: personaName,
      turns: turnIndex,
      inputTokens: ledgerRows.reduce((sum, r) => sum + r.input_tokens, 0),
      outputTokens: ledgerRows.reduce((sum, r) => sum + r.output_tokens, 0),
      costUsd: ledgerRows.reduce((sum, r) => sum + r.cost_usd, 0),
      failureSummary,
    };
  } catch (err) {
    return {
      persona: personaName,
      turns: turnIndex,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      failureSummary,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  loadDotEnvLocalIntoProcessEnv();

  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() && !process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error(
      "INTSIM: neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set. " +
        "Set one in web/.env.local (see .env.example) before running the sim — it makes real Anthropic API calls."
    );
    process.exitCode = 1;
    return;
  }

  let personas: PersonaName[];
  let maxTurns: number;
  try {
    ({ personas, maxTurns } = parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(`INTSIM: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const guard = installNetworkGuard();

  const verdicts: PersonaVerdict[] = [];
  let anyFailed = false;

  try {
    for (const personaName of personas) {
      console.log(`\n▸ running persona "${personaName}" (max ${maxTurns} turns)...`);
      const result = await runPersona(personaName, maxTurns);
      const failureSummary = result.error ? [`CRASH: ${result.error}`, ...result.failureSummary] : result.failureSummary;
      const passed = failureSummary.length === 0;
      if (!passed) anyFailed = true;

      verdicts.push({
        persona: result.persona,
        turns: result.turns,
        passed,
        failureSummary,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      });

      console.log(`  ${passed ? "PASS" : "FAIL"} — ${result.turns} turns, ${result.inputTokens}/${result.outputTokens} tokens`);
    }
  } finally {
    guard.restore();
  }

  console.log("\n" + formatVerdictTable(verdicts));
  process.exitCode = anyFailed ? 1 : 0;
}

// Only run when this file is the direct CLI entry point (`npx tsx
// sim/runSim.ts`) — merely importing this module (e.g. a stray future
// test import) must never trigger a real, billed Anthropic run.
const isDirectRun = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error("INTSIM: unhandled error", err);
    process.exitCode = 1;
  });
}
