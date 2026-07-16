import { describe, expect, it, vi } from "vitest";
import { initialVoiceState, submitVoice, voiceFormValid, voiceReducer } from "./VoicePanel";

describe("voiceReducer", () => {
  it("mode_changed switches tabs without touching the shared text field", () => {
    let state = voiceReducer(initialVoiceState(), { type: "text_changed", value: "draft text" });
    state = voiceReducer(state, { type: "mode_changed", mode: "fresh" });
    expect(state.mode).toBe("fresh");
    expect(state.text).toBe("draft text");
  });

  it("submit_failed returns to editing without clearing the draft", () => {
    let state = voiceReducer(initialVoiceState(), { type: "text_changed", value: "my sample" });
    state = voiceReducer(state, { type: "submit_started" });
    state = voiceReducer(state, { type: "submit_failed", error: "network down" });
    expect(state.phase).toBe("editing");
    expect(state.text).toBe("my sample");
    expect(state.error).toBe("network down");
  });

  it("submit_succeeded moves to finished", () => {
    const state = voiceReducer(initialVoiceState(), { type: "submit_succeeded" });
    expect(state.phase).toBe("finished");
  });
});

describe("voiceFormValid", () => {
  it("requires non-empty text after trimming — no minimum length beyond that", () => {
    expect(voiceFormValid(initialVoiceState())).toBe(false);
    expect(voiceFormValid({ ...initialVoiceState(), text: "   " })).toBe(false);
    expect(voiceFormValid({ ...initialVoiceState(), text: "hi" })).toBe(true);
  });
});

describe("submitVoice", () => {
  it("POSTs the trimmed sample", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "voice", receipt: "voice: dry, compressed" }) }));
    await submitVoice("  a plainspoken sample  ", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/voice",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sample: "a plainspoken sample" }),
      })
    );
  });

  it("rejects on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({ error: "sample required" }) }));
    await expect(submitVoice("x", fetchImpl as unknown as typeof fetch)).rejects.toThrow("failed to submit voice sample");
  });
});
