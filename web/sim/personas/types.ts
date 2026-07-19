import type { InterviewStage } from "../../lib/anthropic/interview";

export interface PersonaContext {
  stage: InterviewStage;
  /** The most recent assistant message — the question this call must answer. */
  lastAssistantText: string;
  /** 1-indexed count of user replies this persona has already sent while in `stage`. */
  turnInStage: number;
}

export interface Persona {
  name: string;
  /** Scripted, deterministic — chosen by stage + question content, never by turnInStage alone. */
  answer(ctx: PersonaContext): string;
}
