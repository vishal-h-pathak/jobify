import type { InterviewStage } from "../../lib/anthropic/interview";

export type QuestionTopic =
  | "resume_ask"
  | "resume_confirm"
  | "logistics"
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
  }

  return "generic";
}
