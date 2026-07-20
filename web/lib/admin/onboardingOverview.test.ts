import { describe, expect, it } from "vitest";
import { summarizeOnboardingSession } from "./onboardingOverview";

describe("summarizeOnboardingSession", () => {
  it("marks completedAt only when status is complete, and always sets lastActivityAt", () => {
    const inProgress = summarizeOnboardingSession({
      user_id: "u1",
      stage: "targeting",
      status: "in_progress",
      updated_at: "2026-07-20T10:00:00Z",
      messages: [],
      modules: {},
    });
    expect(inProgress.completedAt).toBeNull();
    expect(inProgress.lastActivityAt).toBe("2026-07-20T10:00:00Z");

    const complete = summarizeOnboardingSession({
      user_id: "u1",
      stage: "done",
      status: "complete",
      updated_at: "2026-07-20T11:00:00Z",
      messages: [],
      modules: {},
    });
    expect(complete.completedAt).toBe("2026-07-20T11:00:00Z");
  });

  it("counts turns as the number of user-role messages", () => {
    const row = summarizeOnboardingSession({
      user_id: "u1",
      stage: "targeting",
      status: "in_progress",
      updated_at: "2026-07-20T10:00:00Z",
      messages: [
        { role: "assistant", content: "Hi — tell me about your background?" },
        { role: "user", content: "I'm a backend engineer." },
        { role: "assistant", content: "Great, what else?" },
        { role: "user", content: "That's it for now." },
      ],
      modules: {},
    });
    expect(row.turnCount).toBe(2);
  });

  it("detects a fallback-tainted turn by its canned text marker", () => {
    const row = summarizeOnboardingSession({
      user_id: "u1",
      stage: "resume",
      status: "in_progress",
      updated_at: "2026-07-20T10:00:00Z",
      messages: [
        { role: "user", content: "ok" },
        {
          role: "assistant",
          content: "Got it. Have a resume handy? Paste/upload it — or skip, we already have plenty.",
        },
      ],
      modules: {},
    });
    expect(row.fallbackCount).toBe(1);
    expect(row.loopBreakerCount).toBe(0);
  });

  it("detects the loop-breaker marker distinctly from a canned fallback", () => {
    const row = summarizeOnboardingSession({
      user_id: "u1",
      stage: "targeting",
      status: "in_progress",
      updated_at: "2026-07-20T10:00:00Z",
      messages: [
        { role: "assistant", content: "What's the one thing I haven't asked about that matters most for your search?" },
      ],
      modules: {},
    });
    expect(row.loopBreakerCount).toBe(1);
    expect(row.fallbackCount).toBe(0);
  });

  it("never counts a plain, marker-free assistant turn as a fallback", () => {
    const row = summarizeOnboardingSession({
      user_id: "u1",
      stage: "targeting",
      status: "in_progress",
      updated_at: "2026-07-20T10:00:00Z",
      messages: [{ role: "assistant", content: "What's your ideal team size?" }],
      modules: {},
    });
    expect(row.fallbackCount).toBe(0);
    expect(row.loopBreakerCount).toBe(0);
  });

  it("summarizes all twelve modules, done vs not, from the modules jsonb", () => {
    const row = summarizeOnboardingSession({
      user_id: "u1",
      stage: "done",
      status: "complete",
      updated_at: "2026-07-20T10:00:00Z",
      messages: [],
      modules: {
        anchor: { completed_at: "2026-07-19T00:00:00Z", receipt: "Staff Engineer" },
        mirror: { completed_at: "2026-07-20T00:00:00Z", receipt: "3 verbatim quotes" },
      },
    });
    expect(row.modules).toHaveLength(12);
    const anchor = row.modules.find((m) => m.key === "anchor");
    const mirror = row.modules.find((m) => m.key === "mirror");
    const voice = row.modules.find((m) => m.key === "voice");
    expect(anchor).toEqual({ key: "anchor", done: true, completedAt: "2026-07-19T00:00:00Z" });
    expect(mirror).toEqual({ key: "mirror", done: true, completedAt: "2026-07-20T00:00:00Z" });
    expect(voice).toEqual({ key: "voice", done: false, completedAt: null });
  });
});
