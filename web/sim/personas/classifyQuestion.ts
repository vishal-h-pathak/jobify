import type { InterviewStage } from "../../lib/anthropic/interview";

export type QuestionTopic =
  | "resume_ask"
  | "resume_confirm"
  | "logistics"
  | "name"
  | "direction"
  | "tradeoff"
  | "more_of_done_with"
  | "companies"
  | "generic";

/**
 * Buckets a real (LLM-generated, unpredictable wording) assistant question
 * into a topic a persona has a canned answer for — by stage + content
 * keywords, never by turn index, so a fallback/re-prompt turn that shifts
 * the global turn count can't desync the persona from what's actually
 * being asked. Falls back to "generic" for anything unrecognized, which
 * every persona answers with a safe, non-empty, run-continuing reply.
 */
export function classifyQuestion(stage: InterviewStage, assistantText: string): QuestionTopic {
  const t = assistantText.toLowerCase();

  if (stage === "resume") {
    return t.includes("wrong or missing") ? "resume_confirm" : "resume_ask";
  }

  if (stage === "targeting") {
    if (t.includes("logistics")) return "logistics";
    if (t.includes("trade-off") || t.includes("tradeoff") || t.includes("postings") || t.includes("ranks higher"))
      return "tradeoff";
    if (t.includes("more of") && t.includes("done with")) return "more_of_done_with";
    if (t.includes("compan")) return "companies";
    if (t.includes("direction") || t.includes("next role") || t.includes("next-role")) return "direction";
    // Fix D (session 58): a pure name-only ask (identityAskText's
    // NAME_ONLY_VARIANTS in intentRegistry.ts, e.g. "What's your name?")
    // has none of the keywords above and previously fell through to
    // "generic" — every persona's generic reply is a deflection ("Already
    // said.") that never supplies a name, so identity_name (no skip path)
    // looped the interview to the turn cap. Checked LAST: the combined
    // logistics+name ask contains "logistics" and must keep matching that
    // bucket above unchanged, and targeting's own direction ask literally
    // says "name 2-3 concrete directions" (a verb, not this topic) — caught
    // by the "direction" check above before ever reaching this line.
    if (t.includes("name") || t.includes("call you")) return "name";
  }

  return "generic";
}
