import { describe, expect, it } from "vitest";
import { roundTripSnapshot } from "./recoverySnapshot";
import type { SessionSnapshot } from "../lib/onboarding/handleTurn";

describe("roundTripSnapshot", () => {
  it("produces a deep-equal but referentially distinct object — 'throw the loop away, rebuild from the snapshot'", () => {
    const session: SessionSnapshot = {
      stage: "targeting",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Logistics, all in one go: ..." },
      ],
      extracted: {
        anchor: { current_title: "Staff Engineer", current_company: "Northwind" },
        identity: { name: "Alex Quinn", email: "alex.quinn@example.com" },
      },
      status: "in_progress",
      modules: { anchor: { completed_at: "2026-01-01T00:00:00.000Z", receipt: "Staff Engineer · Northwind" } },
    };

    const rebuilt = roundTripSnapshot(session);

    expect(rebuilt).toEqual(session);
    expect(rebuilt).not.toBe(session);
    expect(rebuilt.messages).not.toBe(session.messages);
    expect(rebuilt.extracted).not.toBe(session.extracted);
  });

  it("extracted state is byte-identical (JSON-stable) across the boundary", () => {
    const session: SessionSnapshot = {
      stage: "resume",
      messages: [],
      extracted: { calibration: { skills: ["Go", "Python"], evidence: ["Shipped X"], range_statement: "r" } },
      status: "in_progress",
      modules: {},
    };

    const rebuilt = roundTripSnapshot(session);

    expect(JSON.stringify(rebuilt.extracted)).toBe(JSON.stringify(session.extracted));
  });

  it("drops explicit `undefined` optional fields, same as a real jsonb column would", () => {
    const session: SessionSnapshot = {
      stage: "targeting",
      messages: [],
      extracted: {
        identity: {
          name: "Alex Quinn",
          email: "alex.quinn@example.com",
          phone: undefined,
          location_and_compensation: { base: "Denver, CO", remote_acceptable: true, target_comp_usd: undefined },
        },
      },
      status: "in_progress",
      modules: {},
    };

    const rebuilt = roundTripSnapshot(session);

    expect("phone" in (rebuilt.extracted.identity as object)).toBe(false);
    expect(rebuilt.extracted.identity?.location_and_compensation?.base).toBe("Denver, CO");
    expect("target_comp_usd" in (rebuilt.extracted.identity?.location_and_compensation as object)).toBe(false);
  });
});
