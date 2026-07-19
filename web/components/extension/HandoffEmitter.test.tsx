import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildHandoffDetail, emitHandoff, HANDOFF_EVENT, type HandoffDetail } from "./HandoffEmitter";
import type { Session } from "@supabase/supabase-js";

// This repo has neither `@testing-library/react` nor `jsdom` installed
// (checked package.json devDependencies + node_modules; vitest.config.ts
// runs with `environment: "node"`, no DOM global). Per the session
// prompt's fallback, HandoffEmitter.tsx exports its logic as plain,
// injectable functions (`buildHandoffDetail`, `emitHandoff`) so it's
// testable at that level instead of mounting the component.

function session(overrides: Partial<Session> = {}): Session {
  return {
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    token_type: "bearer",
    user: {} as Session["user"],
    ...overrides,
  } as Session;
}

describe("buildHandoffDetail", () => {
  it("maps a session to {access_token, refresh_token}", () => {
    expect(buildHandoffDetail(session({ access_token: "at-x", refresh_token: "rt-x" }))).toEqual({
      access_token: "at-x",
      refresh_token: "rt-x",
    });
  });

  it("returns null when session is null", () => {
    expect(buildHandoffDetail(null)).toBeNull();
  });
});

describe("emitHandoff", () => {
  it("dispatches the jobify:auth-handoff event with {access_token, refresh_token} when a session exists", () => {
    const dispatch = vi.fn();
    emitHandoff(session({ access_token: "at-x", refresh_token: "rt-x" }), dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const event = dispatch.mock.calls[0][0] as CustomEvent<HandoffDetail>;
    expect(event.type).toBe(HANDOFF_EVENT);
    expect(event.detail).toEqual({ access_token: "at-x", refresh_token: "rt-x" });
  });

  it("does NOT dispatch when session is null", () => {
    const dispatch = vi.fn();
    emitHandoff(null, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("never-log rule", () => {
  it("the file never passes token fields to console.log/warn/error", () => {
    const source = readFileSync(path.join(__dirname, "HandoffEmitter.tsx"), "utf-8");
    expect(source).not.toContain("console.");
  });
});
