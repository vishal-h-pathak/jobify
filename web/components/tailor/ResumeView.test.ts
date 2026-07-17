import { describe, expect, it } from "vitest";
import { groupResumeUnits } from "./ResumeView";
import type { ClaimUnit } from "./types";

const ALEX_QUINN_UNITS: ClaimUnit[] = [
  {
    id: "r.summary",
    surface: "resume",
    kind: "summary",
    text: "Product manager focused on developer tools.",
    sources: [{ file: "cv.md", quote: "Product manager focused on developer tools." }],
    status: "verified",
  },
  {
    id: "r.exp0.header",
    surface: "resume",
    kind: "header",
    fields: { org: "Acme Corp", title: "Senior PM", location: "Remote", period: "2022–Present" },
    status: "verified",
  },
  {
    id: "r.exp0.b0",
    surface: "resume",
    kind: "bullet",
    text: "Shipped a self-serve onboarding flow, cutting time-to-value from 14 days to 3 days.",
    sources: [{ file: "cv.md", quote: "onboarding flow ... 14 days to 3 days", start_line: 12 }],
    numbers: [{ token: "14 days", basis: "confirmed_metric" }, { token: "3 days", basis: "confirmed_metric" }],
    status: "verified",
  },
  {
    id: "r.exp0.b1",
    surface: "resume",
    kind: "bullet",
    text: "Led a cross-functional team of 6 engineers.",
    sources: [{ file: "cv.md", quote: "team of 6 engineers", start_line: 18 }],
    status: "verified",
  },
  { id: "r.edu0", surface: "resume", kind: "edu", fields: { school: "State University", degree: "B.S. Computer Science", period: "2014–2018" }, status: "verified" },
  { id: "r.skill0", surface: "resume", kind: "skill", text: "SQL, Amplitude, Figma", sources: [], status: "verified" },
];

describe("groupResumeUnits", () => {
  it("groups a header with its bullets under one experience, ordered by parsed bullet index", () => {
    const grouped = groupResumeUnits(ALEX_QUINN_UNITS);
    expect(grouped.experience).toHaveLength(1);
    expect(grouped.experience[0].header?.id).toBe("r.exp0.header");
    expect(grouped.experience[0].bullets.map((b) => b.id)).toEqual(["r.exp0.b0", "r.exp0.b1"]);
  });

  it("collects education and skill units, ordered by parsed index", () => {
    const grouped = groupResumeUnits(ALEX_QUINN_UNITS);
    expect(grouped.education.map((e) => e.id)).toEqual(["r.edu0"]);
    expect(grouped.skills.map((s) => s.id)).toEqual(["r.skill0"]);
  });

  it("picks out the summary unit by its fixed id", () => {
    expect(groupResumeUnits(ALEX_QUINN_UNITS).summary?.id).toBe("r.summary");
  });

  it("summary is null when no r.summary unit is present", () => {
    expect(groupResumeUnits(ALEX_QUINN_UNITS.filter((u) => u.id !== "r.summary")).summary).toBeNull();
  });

  it("drops an experience whose header did not survive, even if a bullet unit is present (defensive backstop)", () => {
    const orphanBullet: ClaimUnit = {
      id: "r.exp1.b0",
      surface: "resume",
      kind: "bullet",
      text: "orphan",
      status: "verified",
    };
    const grouped = groupResumeUnits([...ALEX_QUINN_UNITS, orphanBullet]);
    expect(grouped.experience.map((e) => e.index)).toEqual([0]);
  });

  it("ignores cover-letter units entirely", () => {
    const clUnit: ClaimUnit = { id: "cl.s0", surface: "cover_letter", kind: "voice", text: "Hi.", status: "verified" };
    const grouped = groupResumeUnits([...ALEX_QUINN_UNITS, clUnit]);
    expect(grouped.experience).toHaveLength(1);
    expect(grouped.skills).toHaveLength(1);
  });

  it("orders bullets by parsed numeric id, not by array/encounter position, even with a gap from a dropped bullet", () => {
    // b1 is intentionally absent (simulates a bullet the verifier dropped),
    // and b2 is placed BEFORE b0 in the array. A naive encounter-order
    // implementation would emit ["r.exp0.b2", "r.exp0.b0"]; only an
    // id-parsing sort produces ascending numeric order.
    const header: ClaimUnit = {
      id: "r.exp0.header",
      surface: "resume",
      kind: "header",
      fields: { org: "Acme Corp", title: "Senior PM", location: "Remote", period: "2022–Present" },
      status: "verified",
    };
    const b2: ClaimUnit = {
      id: "r.exp0.b2",
      surface: "resume",
      kind: "bullet",
      text: "Ran quarterly planning across three product pods.",
      status: "verified",
    };
    const b0: ClaimUnit = {
      id: "r.exp0.b0",
      surface: "resume",
      kind: "bullet",
      text: "Shipped a self-serve onboarding flow.",
      status: "verified",
    };
    const grouped = groupResumeUnits([b2, header, b0]);
    expect(grouped.experience).toHaveLength(1);
    expect(grouped.experience[0].bullets.map((b) => b.id)).toEqual(["r.exp0.b0", "r.exp0.b2"]);
  });

  it("returns empty sections for an empty units array", () => {
    const grouped = groupResumeUnits([]);
    expect(grouped).toEqual({ experience: [], education: [], skills: [], summary: null });
  });

  it("last unit wins when two units share the same id (Map keyed by parsed index)", () => {
    const firstHeader: ClaimUnit = {
      id: "r.exp0.header",
      surface: "resume",
      kind: "header",
      fields: { org: "Acme Corp", title: "Senior PM", location: "Remote", period: "2022–Present" },
      status: "verified",
    };
    const secondHeader: ClaimUnit = {
      id: "r.exp0.header",
      surface: "resume",
      kind: "header",
      fields: { org: "Globex Inc", title: "Staff PM", location: "Hybrid", period: "2023–Present" },
      status: "verified",
    };
    const grouped = groupResumeUnits([firstHeader, secondHeader]);
    expect(grouped.experience).toHaveLength(1);
    expect(grouped.experience[0].header).toBe(secondHeader);
    expect(grouped.experience[0].header?.fields?.org).toBe("Globex Inc");
  });

  it("silently excludes a resume unit whose id matches none of the known patterns, from every section", () => {
    const unknownUnit: ClaimUnit = {
      id: "r.something.weird",
      surface: "resume",
      kind: "voice",
      text: "unrecognized id shape",
      status: "verified",
    };
    const grouped = groupResumeUnits([...ALEX_QUINN_UNITS, unknownUnit]);
    expect(grouped.experience).toHaveLength(1);
    expect(grouped.experience[0].bullets.map((b) => b.id)).toEqual(["r.exp0.b0", "r.exp0.b1"]);
    expect(grouped.education.map((e) => e.id)).toEqual(["r.edu0"]);
    expect(grouped.skills.map((s) => s.id)).toEqual(["r.skill0"]);
    expect(grouped.summary?.id).toBe("r.summary");
  });
});
