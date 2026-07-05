export type ClaimOutcome =
  | { kind: "success" }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string };

/**
 * The claim endpoint returns 409 for both invalid and already-used codes
 * (never distinguishing which, to avoid code enumeration — see
 * `lib/db/invites.ts`), so 409 always maps to the "might be claimed
 * already" conflict state rather than a generic error.
 */
export function interpretClaimResponse(status: number, body: { error?: string }): ClaimOutcome {
  if (status === 200) return { kind: "success" };
  if (status === 409) {
    return { kind: "conflict", message: body.error ?? "This invite may already be claimed." };
  }
  return { kind: "error", message: body.error ?? "Something went wrong." };
}
