import type { Persona, PersonaContext } from "./types";
import { classifyQuestion } from "./classifyQuestion";
import { ALEX_QUINN_RESUME_MARKDOWN } from "./data";

const CALIBRATION_ANSWER =
  "So, funny story, I almost went into frontend work back in school, but anyway — to your first one, there " +
  "was this one time a payment webhook started silently dropping events under load, and yeah, I'd check " +
  "ingestion lag and DLQ wiring first, that's usually where it hides. As for the other stuff, I get pulled " +
  "into a lot of on-call and capacity planning, honestly more than I'd like, and reviewing other teams' " +
  "scaffolding requests eats a chunk of a week too. As for a totally different lane, I don't know, maybe " +
  "data infra, but honestly more of the same is fine, I like what I do. And if I had to show someone one " +
  "thing it'd be the Kafka pipeline rebuild — cut latency a ton, 4 seconds down to about 300 milliseconds " +
  "at something like 20k events a second.";

const RESUME_INTRO =
  "Sorry, this got long — I always over-explain resumes. Anyway, here's roughly where things stand: ";
const RESUME_CONFIRM_ANSWER =
  "Oh — yeah, that's right, I think, unless I'm forgetting something, but no, I think that's accurate.";
const LOGISTICS_ANSWER =
  "So, location-wise, I'm in Denver, and I've thought about this a lot actually — remote is really what I " +
  "want most of the time, but I could do hybrid if the team's near Denver, and on pay, after going back " +
  "and forth, I don't think I'd go below $175k.";
const DIRECTION_ANSWER =
  "I keep going back and forth on this, but if I really think about it, platform and infra work at a " +
  "mid-size product company is probably the one, though the ML/data-platform infra lane keeps pulling at " +
  "me too, if I'm honest.";
const TRADEOFF_ANSWER =
  "Honestly I go back and forth on stuff like this, but if I'm being real with myself, I'd pick the one " +
  "with more ownership and scale over the one with the bigger name.";
const MORE_OF_DONE_WITH_ANSWER =
  "There's a lot here, but if I had to narrow it down — more of owning something end to end and mentoring, " +
  "and done with being the only person who understands some legacy system nobody else will touch.";
const COMPANIES_ANSWER = "I don't have a strict list, but Stripe and Datadog come to mind, if I'm honest.";
const GENERIC_ANSWER = "I think I already touched on that somewhere above, but let me know if you need more.";

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

/** Buries the actual answer mid-paragraph — the real content is still all there, just wordy. */
export function createMeanderingPersona(): Persona {
  return {
    name: "meandering",
    answer(ctx: PersonaContext): string {
      if (ctx.stage === "calibration") return CALIBRATION_ANSWER;
      if (ctx.stage === "resume") {
        return classifyQuestion(ctx.stage, ctx.lastAssistantText) === "resume_confirm"
          ? RESUME_CONFIRM_ANSWER
          : RESUME_INTRO + ALEX_QUINN_RESUME_MARKDOWN;
      }
      return answerTargeting(ctx);
    },
  };
}
