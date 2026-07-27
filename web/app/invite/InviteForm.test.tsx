import { describe, expect, it } from "vitest";
import { resolveClaimDestination } from "./InviteForm";

/**
 * This repo's vitest config runs in the `node` environment with no
 * jsdom/@testing-library/react (see ResumeForm.test.tsx), so — matching
 * the established convention — the post-claim navigation decision is
 * pulled out into this plain, exported function and tested directly
 * instead of rendering the hook-bearing component.
 */
describe("resolveClaimDestination", () => {
  it("honors a `next` destination when one was carried through", () => {
    expect(resolveClaimDestination("/tailor/abc")).toBe("/tailor/abc");
  });

  it("falls back to /onboarding when there is no `next`", () => {
    expect(resolveClaimDestination(null)).toBe("/onboarding");
  });
});
