/** One persona's full-run outcome, flattened for display. */
export interface PersonaVerdict {
  persona: string;
  turns: number;
  passed: boolean;
  failureSummary: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/**
 * `npm run sim`'s human-facing output: a per-persona verdict table plus a
 * grand total, and (only when something failed) a failures section — no
 * silent truncation of what went wrong.
 */
export function formatVerdictTable(verdicts: PersonaVerdict[]): string {
  const header = ["PERSONA", "TURNS", "VERDICT", "TOKENS(in/out)", "COST"];
  const rows = verdicts.map((v) => [
    v.persona,
    String(v.turns),
    v.passed ? "PASS" : "FAIL",
    `${v.inputTokens}/${v.outputTokens}`,
    formatCost(v.costUsd),
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");

  const lines = [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)];

  const totalInput = verdicts.reduce((sum, v) => sum + v.inputTokens, 0);
  const totalOutput = verdicts.reduce((sum, v) => sum + v.outputTokens, 0);
  const totalCost = verdicts.reduce((sum, v) => sum + v.costUsd, 0);
  lines.push("", `TOTAL: ${totalInput}/${totalOutput} tokens, ${formatCost(totalCost)}`);

  const failing = verdicts.filter((v) => !v.passed);
  if (failing.length > 0) {
    lines.push("", "FAILURES:");
    for (const v of failing) {
      lines.push(`  ${v.persona}:`);
      for (const failure of v.failureSummary) lines.push(`    - ${failure}`);
    }
  }

  return lines.join("\n");
}
