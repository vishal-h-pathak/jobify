import type { Persona, PersonaContext } from "./types";
import { classifyQuestion } from "./classifyQuestion";
import { ALEX_QUINN_RESUME_MARKDOWN } from "./data";

const CALIBRATION_ANSWER =
  "Depth: a payment webhook started silently dropping events under load — I'd check ingestion lag and DLQ " +
  "wiring first, since the classic bug is treating consumer-offset commits as delivery confirmation. " +
  "Breadth: I get pulled into on-call incident response, capacity planning, and reviewing other teams' " +
  "service-scaffolding requests, well outside just my own service. Range: if I moved outside platform work " +
  "I'd want to stay close to distributed systems, maybe data infra — but honestly more of the same is fine " +
  "too. Evidence: I'd show the Kafka notification-pipeline rebuild — cut p99 latency from 4s to 300ms at " +
  "20k events/sec — and the internal service-scaffolding platform 14 teams adopted.";

const RESUME_CONFIRM_ANSWER = "Yes, that's accurate — nothing to correct.";
const LOGISTICS_ANSWER =
  "Denver, CO — remote is my strong preference, though I'd do hybrid near Denver for the right team. " +
  "Salary floor is $175k.";
const DIRECTION_ANSWER =
  "Two things I'd actually want: platform/infrastructure engineering at a mid-size product company, or the " +
  "data-platform/ML-infra lane — the systems around models, not the modeling itself. Either works; the " +
  "first is the stronger pull.";
const TRADEOFF_ANSWER =
  "Give me the one with more ownership and scale over the bigger brand name — I'd rather ship something " +
  "that matters than coast on a logo.";
const MORE_OF_DONE_WITH_ANSWER =
  "More of: owning a service end-to-end and mentoring engineers who adopt it. Done with: being the sole " +
  "on-call for a legacy monolith nobody wants to touch.";
const COMPANIES_ANSWER = "Stripe and Datadog are on my radar, but no hard requirement there.";
const GENERIC_ANSWER = "That's covered by what I've already told you — happy to add detail on any of it if useful.";

function answerTargeting(ctx: PersonaContext): string {
  switch (classifyQuestion(ctx.stage, ctx.lastAssistantText)) {
    case "logistics":
      return LOGISTICS_ANSWER;
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

/** Clean answers, no rough edges — the baseline persona. */
export function createCooperativePersona(): Persona {
  return {
    name: "cooperative",
    answer(ctx: PersonaContext): string {
      if (ctx.stage === "calibration") return CALIBRATION_ANSWER;
      if (ctx.stage === "resume") {
        return classifyQuestion(ctx.stage, ctx.lastAssistantText) === "resume_confirm"
          ? RESUME_CONFIRM_ANSWER
          : ALEX_QUINN_RESUME_MARKDOWN;
      }
      return answerTargeting(ctx);
    },
  };
}
