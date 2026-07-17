"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { interpretTailorResponse, type TailorOutcome } from "@/app/(app)/feed/tailorOutcome";
import { TEMPLATE_OPTIONS } from "./types";

export interface DispatchRenderDeps {
  postingId: string;
  template: string;
  fetchImpl: typeof fetch;
}

/**
 * Zero-LLM re-render (design §1.1's `mode=render` path): re-renders the
 * already-verified, already-stored `tailored.json`/claims with a different
 * template at ~$0 — never re-runs generation or the verifier.
 */
export async function dispatchRender({ postingId, template, fetchImpl }: DispatchRenderDeps): Promise<TailorOutcome> {
  const res = await fetchImpl("/api/tailor/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posting_id: postingId, mode: "render", template }),
  });
  const body = await res.json();
  return interpretTailorResponse(res.status, body);
}

export function TemplateSwitcher({
  postingId,
  currentTemplate,
  onRun,
}: {
  postingId: string;
  currentTemplate: string | null;
  onRun: (outcome: TailorOutcome) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function pick(templateId: string) {
    if (templateId === currentTemplate) return;
    setBusyId(templateId);
    const outcome = await dispatchRender({ postingId, template: templateId, fetchImpl: fetch });
    setBusyId(null);
    onRun(outcome);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TEMPLATE_OPTIONS.map((option) => (
        <Button
          key={option.id}
          variant={option.id === currentTemplate ? "primary" : "secondary"}
          busy={busyId === option.id}
          onClick={() => pick(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
