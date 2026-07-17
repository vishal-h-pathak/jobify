import { describe, expect, it, vi } from "vitest";
import { dispatchRender } from "./TemplateSwitcher";

describe("dispatchRender", () => {
  it("POSTs mode=render with the chosen template, zero-LLM re-render path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, run_id: "render-run-1" }),
    });

    const result = await dispatchRender({ postingId: "posting-1", template: "modern", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("/api/tailor/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posting_id: "posting-1", mode: "render", template: "modern" }),
    });
    expect(result).toEqual({ kind: "started", runId: "render-run-1" });
  });

  it("surfaces a cooldown outcome the same way the tailor button does", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 429,
      json: async () => ({ error: "cooldown" }),
    });

    const result = await dispatchRender({ postingId: "posting-1", template: "classic", fetchImpl });

    expect(result.kind).toBe("cooldown");
  });
});
