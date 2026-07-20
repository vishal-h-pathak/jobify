/**
 * Session-prompt 45, task 1: "the sim must NEVER touch a real database —
 * assert no network except api.anthropic.com." The fake Supabase clients
 * already guarantee zero db I/O by construction, but this is the belt to
 * that suspenders: it wraps `globalThis.fetch` for the duration of a sim
 * run and throws — synchronously, before any bytes leave the process — on
 * any request to a host other than the real Anthropic API. The
 * pytest-hit-prod incident is the cautionary tale this exists to prevent
 * from ever having a serverless-onboarding-sim sibling.
 */

const ALLOWED_HOSTS = new Set(["api.anthropic.com"]);

function hostOf(input: RequestInfo | URL): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return new URL(url).host;
}

export interface NetworkGuardHandle {
  restore(): void;
  callCount(): number;
}

export function installNetworkGuard(): NetworkGuardHandle {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  const guardedFetch = (input: RequestInfo | URL, init?: RequestInit): ReturnType<typeof fetch> => {
    const host = hostOf(input);
    if (!ALLOWED_HOSTS.has(host)) {
      throw new Error(
        `INTSIM network guard: blocked a network call to "${host}" — the sim must never touch a real ` +
          `database or any service other than api.anthropic.com. Offending URL: ${String(input)}`
      );
    }
    calls++;
    return originalFetch(input, init);
  };

  globalThis.fetch = guardedFetch as typeof fetch;

  return {
    restore() {
      globalThis.fetch = originalFetch;
    },
    callCount() {
      return calls;
    },
  };
}
