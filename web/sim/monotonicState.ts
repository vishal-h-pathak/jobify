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

function walk(before: unknown, after: unknown, path: string, violations: MonotonicViolation[]): void {
  if (Array.isArray(before)) {
    if (isEmpty(before)) return;
    const afterLength = Array.isArray(after) ? after.length : 0;
    if (after === undefined || isEmpty(after) || afterLength < before.length) {
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
      walk(before[key], childAfter, childPath, violations);
    }
    return;
  }

  // Leaf (string/number/boolean/null).
  if (!isEmpty(before) && isEmpty(after)) {
    violations.push({ path, before, after });
  }
}

/** Deep-compares two `extracted` snapshots taken before/after a single turn. */
export function checkMonotonicState(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): MonotonicCheckResult {
  const violations: MonotonicViolation[] = [];
  walk(before, after, "", violations);
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
 * Checks every consecutive pair of `extracted` snapshots in turn order.
 * Checking consecutive pairs is sufficient: any disappearance, at any
 * point in the run, happens between some turn and the very next one.
 */
export function checkMonotonicStateAcrossTurns(snapshots: Record<string, unknown>[]): MonotonicAcrossTurnsResult {
  const failures: MonotonicTurnFailure[] = [];

  for (let turnIndex = 1; turnIndex < snapshots.length; turnIndex++) {
    const result = checkMonotonicState(snapshots[turnIndex - 1]!, snapshots[turnIndex]!);
    if (!result.passed) {
      failures.push({ turnIndex, violations: result.violations });
    }
  }

  return { passed: failures.length === 0, failures };
}
