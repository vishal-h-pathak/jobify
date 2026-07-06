import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { TextArea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CALIBRATION_INTRO_COPY } from "@/lib/anthropic/interview";
import type { ChatMessage } from "@/lib/anthropic/interview";

/**
 * The 4 generated calibration prompts only ever reach the browser embedded
 * as text inside the persisted intro assistant message (see
 * web/lib/onboarding/maybeGenerateCalibration.ts) — GET /api/onboarding/state
 * never sends `extracted` to the client. This recovers the 4 prompt strings
 * from that message rather than requiring a backend contract change.
 */
export function parseCalibrationPrompts(messages: ChatMessage[]): string[] {
  const introMessage = [...messages].reverse().find(
    (m) => m.role === "assistant" && m.content.startsWith(CALIBRATION_INTRO_COPY)
  );
  if (!introMessage) return [];

  const rest = introMessage.content.slice(CALIBRATION_INTRO_COPY.length).trim();
  if (!rest) return [];

  return rest
    .split(/\n(?=\d+\.\s)/)
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

/** Sent as one POST /api/onboarding/turn message — the ingest prompt (§2)
 * expects "one message covering all four", numbered to match the intro. */
export function formatCalibrationSubmission(answers: string[]): string {
  return answers.map((answer, i) => `${i + 1}. ${answer.trim()}`).join("\n\n");
}

export function calibrationAnswersValid(answers: string[]): boolean {
  return answers.length === 4 && answers.every((a) => a.trim().length > 0);
}

export const CALIBRATION_LOADING_LINES = ["Reading your role…", "Writing your four prompts…"] as const;

export function nextLoadingLineIndex(current: number, total: number): number {
  return (current + 1) % total;
}

const PROMPT_LABELS = ["Depth", "Breadth", "Range", "Evidence"] as const;

export interface CalibrationPanelProps {
  introCopy: string;
  prompts: string[];
  answers: string[];
  submitting: boolean;
  error: string;
  onAnswerChange: (index: number, value: string) => void;
  onSubmit: () => void;
}

/** "Show your range" (ONBOARDING_REDESIGN.md §2/§3): elevated prompt cards,
 * one autosizing textarea each, a single submit for all four. */
export function CalibrationPanel({
  introCopy,
  prompts,
  answers,
  submitting,
  error,
  onAnswerChange,
  onSubmit,
}: CalibrationPanelProps) {
  const valid = calibrationAnswersValid(answers);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-3xl font-semibold tracking-tight text-ink">Show your range</h2>
        <p className="max-w-prose text-lg text-ink">{introCopy}</p>
      </div>

      <div className="flex flex-col gap-4">
        {prompts.map((prompt, i) => (
          <Card key={i} variant="elevated" className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-muted">{PROMPT_LABELS[i] ?? `Prompt ${i + 1}`}</p>
            <p className="text-ink">{prompt}</p>
            <TextArea
              value={answers[i] ?? ""}
              onChange={(e) => onAnswerChange(i, e.target.value)}
              placeholder="A few sentences — plain language is fine."
              disabled={submitting}
            />
          </Card>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button variant="primary" busy={submitting} disabled={submitting || !valid} onClick={onSubmit}>
        Submit
      </Button>
    </div>
  );
}

/**
 * Calibration generation is a slow (~5-10s) LLM call that happens inside
 * GET /api/onboarding/state itself (maybeGenerateCalibrationPrompts runs
 * synchronously before the route responds) — so the moment to show this is
 * client-driven: right after AnchorForm's submit succeeds, while the page
 * awaits the follow-up state fetch that will return with prompts populated.
 * Skeleton cards + a rotating line, per §3 — not the chat typing dots.
 */
export function CalibrationGeneratingSkeleton() {
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setLineIndex((i) => nextLoadingLineIndex(i, CALIBRATION_LOADING_LINES.length));
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="h-8 w-48 animate-pulse rounded bg-surface" />
      <div className="flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} variant="elevated" className="flex flex-col gap-2">
            <div className="h-3 w-16 animate-pulse rounded bg-line" />
            <div className="h-4 w-full animate-pulse rounded bg-line" />
            <div className="h-16 w-full animate-pulse rounded bg-line" />
          </Card>
        ))}
      </div>
      <p role="status" className="text-sm text-ink-muted">
        {CALIBRATION_LOADING_LINES[lineIndex]}
      </p>
    </div>
  );
}
