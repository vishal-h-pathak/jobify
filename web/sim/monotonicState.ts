/**
 * MONOTONIC-STATE invariant (reviewer addendum to session-prompt 45): a
 * field once present (non-empty) in `extracted` must never disappear or
 * become empty on a later turn. Motivating live bug: a correction turn
 * re-called record_identity with only the changed field(s), and the
 * wholesale-replace in `applyToolCalls.ts` silently destroyed
 * `location_and_compensation` mid-interview (fixed in the same session —
 * see `applyToolCalls.ts`). This is the general-purpose guard: it doesn't
 * know about record_identity specifically, it deep-compares the two
 * `extracted` snapshots on either side of a turn and flags ANY regression.
 *
 * Fix E (session 58) refinement — encodes ownership semantics, NOT a
 * weakening: an array shrinking to a shorter-but-still-non-empty value is
 * still a violation UNLESS the field's owning intent was that turn's
 * target (`applyToolCalls.ts`'s mergers now enforce the matching rule —
 * only an owning-intent update may replace-with-shrink; an opportunistic
 * one is fill-only). A full wipe to empty/undefined remains a violation
 * regardless of ownership — the merger never produces that outcome for
 * an owning update either (it only replaces "when non-empty"), so the
 * invariant doesn't need to tolerate it. Every extracted-state top-level
 * key doubles as its owning IntentKey name 1:1 (checklist.ts's own
 * invariant), so ownership is read straight off the violating path's root
 * segment — no import from checklist.ts needed.
 */

export interface MonotonicViolation {
  path: string;
  before: unknown;
  after: unknown;
}

export interface MonotonicCheckResult {
  passed: boolean;
  violations: MonotonicViolation[];
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  violations: MonotonicViolation[],
  targetIntent: string | undefined
): void {
  if (Array.isArray(before)) {
    if (isEmpty(before)) return;
    const afterIsNonEmptyArray = Array.isArray(after) && !isEmpty(after);
    const vanished = after === undefined || isEmpty(after);
    if (vanished) {
      violations.push({ path, before, after });
      return;
    }
    const afterLength = afterIsNonEmptyArray ? (after as unknown[]).length : 0;
    if (afterLength < before.length) {
      // Fix E: a shrink-but-non-empty is excused ONLY when the field's
      // owning intent (the path's root segment) was this turn's target —
      // a legitimate user correction, not an opportunistic touch trampling
      // recorded data.
      const owningIntent = path.split(".")[0];
      if (targetIntent && owningIntent === targetIntent) return;
      violations.push({ path, before, after });
    }
    return;
  }

  if (isPlainObject(before)) {
    if (isEmpty(before)) return;
    if (after === undefined) {
      // The whole subtree vanished at this path — report ONE violation
      // here rather than descending (there's nothing left to descend
      // into, and per-leaf noise would bury the actual failure).
      violations.push({ path, before, after });
      return;
    }
    for (const key of Object.keys(before)) {
      const childPath = path ? `${path}.${key}` : key;
      const childAfter = isPlainObject(after) ? after[key] : undefined;
      walk(before[key], childAfter, childPath, violations, targetIntent);
    }
    return;
  }

  // Leaf (string/number/boolean/null).
  if (!isEmpty(before) && isEmpty(after)) {
    violations.push({ path, before, after });
  }
}

/**
 * Deep-compares two `extracted` snapshots taken before/after a single turn.
 * `targetIntent` (Fix E, session 58) is the turn's actual target intent —
 * pass it to excuse an owning-intent array shrink-but-non-empty; omit it to
 * get the strict pre-Fix-E behavior (every array shrink is a violation).
 */
export function checkMonotonicState(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  targetIntent?: string
): MonotonicCheckResult {
  const violations: MonotonicViolation[] = [];
  walk(before, after, "", violations, targetIntent);
  return { passed: violations.length === 0, violations };
}

export interface MonotonicTurnFailure {
  turnIndex: number;
  violations: MonotonicViolation[];
}

export interface MonotonicAcrossTurnsResult {
  passed: boolean;
  failures: MonotonicTurnFailure[];
}

/**
 * Fix E (session 58): reads the turn's actual target intent straight off
 * the snapshots' own `turn_log` (`handleTurn.ts` appends one entry per
 * turn with `target_intent` set to exactly that) — no signature change
 * needed at any call site. Compares turn_log LENGTH (not just the tail
 * entry) so a turn that appends no entry at all (e.g. the resume-skip fast
 * path, which never touches an array field anyway) correctly yields
 * `undefined` here rather than misattributing a stale, unrelated turn's
 * target.
 */
function turnTargetIntent(before: unknown, after: unknown): string | undefined {
  const beforeLog = isPlainObject(before) && Array.isArray(before.turn_log) ? before.turn_log : [];
  const afterLog = isPlainObject(after) && Array.isArray(after.turn_log) ? after.turn_log : [];
  if (afterLog.length <= beforeLog.length) return undefined;
  const lastEntry = afterLog[afterLog.length - 1] as { target_intent?: unknown } | undefined;
  return typeof lastEntry?.target_intent === "string" ? lastEntry.target_intent : undefined;
}

/**
 * Checks every consecutive pair of `extracted` snapshots in turn order.
 * Checking consecutive pairs is sufficient: any disappearance, at any
 * point in the run, happens between some turn and the very next one.
 */
export function checkMonotonicStateAcrossTurns(snapshots: Record<string, unknown>[]): MonotonicAcrossTurnsResult {
  const failures: MonotonicTurnFailure[] = [];

  for (let turnIndex = 1; turnIndex < snapshots.length; turnIndex++) {
    const before = snapshots[turnIndex - 1]!;
    const after = snapshots[turnIndex]!;
    const result = checkMonotonicState(before, after, turnTargetIntent(before, after));
    if (!result.passed) {
      failures.push({ turnIndex, violations: result.violations });
    }
  }

  return { passed: failures.length === 0, failures };
}
