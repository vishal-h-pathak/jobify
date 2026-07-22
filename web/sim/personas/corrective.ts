import type { Persona, PersonaContext } from "./types";
import { classifyQuestion } from "./classifyQuestion";
import { ALEX_QUINN_RESUME_MARKDOWN, ALEX_QUINN_NAME } from "./data";

const CALIBRATION_ANSWER =
  "Depth: a payment webhook started silently dropping events under load — I'd check ingestion lag and DLQ " +
  "wiring first. Breadth: on-call incident response, capacity planning, and reviewing other teams' " +
  "service-scaffolding requests. Range: maybe data infra, but more of the same is fine too. Evidence: the " +
  "Kafka notification-pipeline rebuild — cut p99 latency from 4s to 300ms at 20k events/sec.";
const RESUME_CONFIRM_ANSWER = "Yes, that's accurate — nothing to correct.";
const LOGISTICS_ANSWER = "Denver, CO — remote preferred, hybrid near Denver okay. Salary floor is $175k.";
const DIRECTION_ANSWER =
  "Platform/infrastructure engineering at a mid-size product company is the strongest pull, with the " +
  "data-platform/ML-infra lane as the close second.";
const TRADEOFF_ANSWER = "More ownership and scale over the bigger brand name, every time.";
const MORE_OF_DONE_WITH_ANSWER =
  "More of: owning a service end-to-end and mentoring. Done with: being the sole on-call for a legacy monolith.";
const COMPANIES_ANSWER = "Stripe and Datadog, loosely.";
const GENERIC_ANSWER = "Already covered above, but happy to add detail if useful.";

// Reproduces the owner's real mid-interview self-correction move generically
// (Alex Quinn data only, per session-prompt 45 task 2): give a real
// logistics answer, then correct one fact on a LATER turn — the exact
// shape that destroyed location_and_compensation mid-interview before
// applyToolCalls.ts's record_identity merge fix.
const CORRECTED_SALARY_FLOOR = "$190k";
const CORRECTION_PREFIX = `Actually, quick correction before that — my salary floor is ${CORRECTED_SALARY_FLOOR}, not $175k, after a competing offer. `;

// Fix D (session 58): the SAME one-shot self-correction shape as the salary
// wrinkle above, applied to a name question instead — gives a real but
// misspelled name once, then corrects the spelling on a LATER targeting
// turn. Independent state from the salary correction (either, both, or
// neither may fire in a given run, depending on which topics actually come up).
const MISSPELLED_NAME = "Alex Quin";
const NAME_CORRECTION_PREFIX = `Actually, one correction — it's spelled "${ALEX_QUINN_NAME}", with two Ns, not "${MISSPELLED_NAME}". `;

function baseTargetingAnswer(ctx: PersonaContext): { topic: string; text: string } {
  const topic = classifyQuestion(ctx.stage, ctx.lastAssistantText);
  switch (topic) {
    case "logistics":
      return { topic, text: LOGISTICS_ANSWER };
    case "name":
      return { topic, text: MISSPELLED_NAME };
    case "direction":
      return { topic, text: DIRECTION_ANSWER };
    case "tradeoff":
      return { topic, text: TRADEOFF_ANSWER };
    case "more_of_done_with":
      return { topic, text: MORE_OF_DONE_WITH_ANSWER };
    case "companies":
      return { topic, text: COMPANIES_ANSWER };
    default:
      return { topic, text: GENERIC_ANSWER };
  }
}

/**
 * Cooperative in every other respect; the one deliberate wrinkle is a
 * one-shot correction inserted on the first targeting turn after
 * logistics — real conversations correct themselves mid-interview, and
 * this is the exact path that re-calls record_identity with a partial
 * update (session-prompt 45's reviewer addendum / MONOTONIC-STATE).
 */
export function createCorrectivePersona(): Persona {
  let sawLogistics = false;
  let correctionIssued = false;
  let sawName = false;
  let nameCorrectionIssued = false;

  return {
    name: "corrective",
    answer(ctx: PersonaContext): string {
      if (ctx.stage === "calibration") return CALIBRATION_ANSWER;
      if (ctx.stage === "resume") {
        return classifyQuestion(ctx.stage, ctx.lastAssistantText) === "resume_confirm"
          ? RESUME_CONFIRM_ANSWER
          : ALEX_QUINN_RESUME_MARKDOWN;
      }

      const { topic, text } = baseTargetingAnswer(ctx);
      if (topic === "logistics") {
        sawLogistics = true;
        return text;
      }
      if (topic === "name") {
        sawName = true;
        return text;
      }
      if (sawLogistics && !correctionIssued) {
        correctionIssued = true;
        return CORRECTION_PREFIX + text;
      }
      if (sawName && !nameCorrectionIssued) {
        nameCorrectionIssued = true;
        return NAME_CORRECTION_PREFIX + text;
      }
      return text;
    },
  };
}
