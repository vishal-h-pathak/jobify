import { defineConfig } from "vitest/config";

// happy-dom over jsdom: faster, and (per manual verification during E1)
// supports open shadow roots (`attachShadow({mode:"open"})`) and same-origin
// iframes whose document we populate directly via `contentDocument` — the
// only two DOM features this package's tests need beyond a plain document.
// Known limit: happy-dom's `MutationObserver` fires on a real timer tick, so
// settle-helper tests use fake timers + explicit `await vi.advanceTimersByTimeAsync`
// rather than relying on microtask-only flushing.
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["test/**/*.test.ts"],
  },
});
