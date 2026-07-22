import type { Persona, PersonaContext } from "./types";
import { classifyQuestion } from "./classifyQuestion";
import { RESUME_SKIP_MESSAGE } from "../../lib/onboarding/handleTurn";
import { ALEX_QUINN_NAME } from "./data";

const CALIBRATION_ANSWER = "Depth: fix pipeline, check acks. Breadth: on-call, reviews, scaffolding. Range: data infra, or same is fine. Evidence: Kafka rebuild, 4s to 300ms.";
const LOGISTICS_ANSWER = "Denver. Remote-only. $175k floor.";
// Fix D (session 58): a curt real name — the minimum-viable-words persona
// answers a direct name question the same as anything else, tersely.
const NAME_ANSWER = ALEX_QUINN_NAME;
const DIRECTION_ANSWER = "Platform/infra roles.";
const TRADEOFF_ANSWER = "Bigger scope, not brand.";
const MORE_OF_DONE_WITH_ANSWER = "More ownership. Less legacy on-call.";
const COMPANIES_ANSWER = "None specific.";
const GENERIC_ANSWER = "Already said.";

function answerTargeting(ctx: PersonaContext): string {
  switch (classifyQuestion(ctx.stage, ctx.lastAssistantText)) {
    case "logistics":
      return LOGISTICS_ANSWER;
    case "name":
      return NAME_ANSWER;
    case "direction":
      return DIRECTION_ANSWER;
    case "tradeoff":
      return TRADEOFF_ANSWER;
    case "more_of_done_with":
      return MORE_OF_DONE_WITH_ANSWER;
    case "companies":
      return COMPANIES_ANSWER;
    default:
      return GENERIC_ANSWER;
  }
}

/** Minimum viable words — also exercises the zero-LLM resume-skip sentinel path. */
export function createTersePersona(): Persona {
  return {
    name: "terse",
    answer(ctx: PersonaContext): string {
      if (ctx.stage === "calibration") return CALIBRATION_ANSWER;
      // The resume-skip sentinel never reaches a resume_confirm turn — it
      // bypasses the model entirely (handleTurn.ts intercepts it before
      // any LLM call), so every resume-stage turn this persona sees gets
      // the same sentinel regardless of content.
      if (ctx.stage === "resume") return RESUME_SKIP_MESSAGE;
      return answerTargeting(ctx);
    },
  };
}
