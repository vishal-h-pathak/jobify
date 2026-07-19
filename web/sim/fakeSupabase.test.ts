import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./fakeSupabase";
import { saveSession } from "../lib/db/onboardingSession";
import { upsertProfileDoc } from "../lib/db/profiles";
import { recordOnboardingTurn } from "../lib/db/ledger";
import { computeCostUsd } from "../lib/anthropic/pricing";

describe("createFakeSupabase", () => {
  it("has no session row for an unseeded user", () => {
    const fake = createFakeSupabase();
    expect(fake.getSessionRow("user-1")).toBeUndefined();
  });

  it("seedSessionRow makes the row readable via getSessionRow", () => {
    const fake = createFakeSupabase();
    fake.seedSessionRow({
      user_id: "user-1",
      stage: "calibration",
      messages: [],
      extracted: {},
      modules: {},
      status: "in_progress",
    });

    expect(fake.getSessionRow("user-1")).toMatchObject({
      user_id: "user-1",
      stage: "calibration",
      status: "in_progress",
    });
  });

  it("the real saveSession() writes through client.from(...).update(...).eq(...) into the fake row", async () => {
    const fake = createFakeSupabase();
    fake.seedSessionRow({
      user_id: "user-1",
      stage: "calibration",
      messages: [],
      extracted: {},
      modules: {},
      status: "in_progress",
    });

    await saveSession(fake.client, "user-1", {
      messages: [{ role: "user", content: "hi" }],
      extracted: { anchor: { free_text: "between roles" } },
      stage: "resume",
      status: "in_progress",
      modules: { anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "between roles" } },
    });

    const row = fake.getSessionRow("user-1");
    expect(row?.stage).toBe("resume");
    expect(row?.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(row?.modules).toEqual({ anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "between roles" } });
    expect(typeof row?.updated_at).toBe("string");
  });

  it("saveSession is a partial column update — omitted columns (e.g. modules) are preserved, not wiped", async () => {
    const fake = createFakeSupabase();
    fake.seedSessionRow({
      user_id: "user-1",
      stage: "calibration",
      messages: [],
      extracted: {},
      modules: { anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "SWE" } },
      status: "in_progress",
    });

    // Mirrors maybeGenerateCalibrationPrompts's saveSession call, which
    // never passes `modules`.
    await saveSession(fake.client, "user-1", {
      messages: [{ role: "assistant", content: "intro" }],
      extracted: { anchor: { free_text: "x" }, calibration: { prompts: ["a", "b", "c", "d"] } },
      stage: "calibration",
      status: "in_progress",
    });

    const row = fake.getSessionRow("user-1");
    expect(row?.modules).toEqual({ anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "SWE" } });
  });

  it("sessionUpdateCount('user-1') increments once per saveSession call — the 'spot saved' counter", async () => {
    const fake = createFakeSupabase();
    fake.seedSessionRow({
      user_id: "user-1",
      stage: "calibration",
      messages: [],
      extracted: {},
      modules: {},
      status: "in_progress",
    });

    expect(fake.sessionUpdateCount("user-1")).toBe(0);
    await saveSession(fake.client, "user-1", { stage: "resume", status: "in_progress" });
    expect(fake.sessionUpdateCount("user-1")).toBe(1);
    await saveSession(fake.client, "user-1", { stage: "targeting", status: "in_progress" });
    expect(fake.sessionUpdateCount("user-1")).toBe(2);
  });

  it("the real upsertProfileDoc() writes a readable profile row with a computed validation_status", async () => {
    const fake = createFakeSupabase();
    const doc = {
      "profile.yml": "identity:\n  name: Alex Quinn\n  email: alex.quinn@example.com\n",
      "thesis.md": "# thesis\n",
      "voice-profile.md": "",
      "article-digest.md": "",
      "learned-insights.md": "",
      "cv.md": "# CV\n",
      "disqualifiers.yml": "hard_disqualifiers: []\nsoft_concerns: []\n",
      "portals.yml": "portals: []\n",
    };

    const result = await upsertProfileDoc(fake.client, "user-1", doc);

    // Decoupled from validateProfileDoc's exact rule set on purpose — this
    // test is about the fake wiring the real write through correctly, not
    // about what "valid" means.
    expect(fake.getProfileRow("user-1")?.doc).toEqual(doc);
    expect(fake.getProfileRow("user-1")?.validation_status).toEqual({ status: result.status, errors: result.errors });
  });

  it("the real recordOnboardingTurn() appends one ledger row with the correctly computed cost", async () => {
    const fake = createFakeSupabase();

    await recordOnboardingTurn(fake.client, {
      userId: "user-1",
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 500,
    });

    const rows = fake.getLedgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: "user-1", model: "claude-sonnet-5", input_tokens: 1000, output_tokens: 500 });
    expect(rows[0]!.cost_usd).toBe(computeCostUsd("claude-sonnet-5", 1000, 500));
  });

  it("getLedgerRows accumulates across multiple recordOnboardingTurn calls, in order", async () => {
    const fake = createFakeSupabase();

    await recordOnboardingTurn(fake.client, { userId: "user-1", model: "claude-sonnet-5", inputTokens: 100, outputTokens: 40 });
    await recordOnboardingTurn(fake.client, { userId: "user-1", model: "claude-sonnet-5", inputTokens: 120, outputTokens: 30 });

    const rows = fake.getLedgerRows();
    expect(rows.map((r) => r.input_tokens)).toEqual([100, 120]);
  });
});
