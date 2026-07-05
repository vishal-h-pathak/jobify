import { describe, expect, it } from "vitest";
import { interpretClaimResponse } from "./claimOutcome";

describe("interpretClaimResponse", () => {
  it("maps 200 to success", () => {
    expect(interpretClaimResponse(200, {})).toEqual({ kind: "success" });
  });

  it("maps 409 to a conflict outcome — invalid and already-used codes are indistinguishable by design", () => {
    const outcome = interpretClaimResponse(409, { error: "invalid or already-used invite code" });
    expect(outcome).toEqual({ kind: "conflict", message: "invalid or already-used invite code" });
  });

  it("falls back to a generic conflict message when the body has none", () => {
    expect(interpretClaimResponse(409, {})).toEqual({
      kind: "conflict",
      message: "This invite may already be claimed.",
    });
  });

  it("maps any other status to a generic error, passing the server message through", () => {
    expect(interpretClaimResponse(500, { error: "boom" })).toEqual({ kind: "error", message: "boom" });
  });

  it("falls back to a generic error message when the body has none", () => {
    expect(interpretClaimResponse(400, {})).toEqual({ kind: "error", message: "Something went wrong." });
  });
});
