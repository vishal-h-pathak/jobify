import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // "jobify-engine" (see types/jobify-engine.d.ts) has no real target in
      // this worktree — Vite needs *something* resolvable before vi.mock()
      // can intercept it (atsFillBridge.test.ts). The real build
      // (extension/build.mjs) aliases this specifier to the actual engine
      // package instead.
      "jobify-engine": path.resolve(__dirname, "src/testing/jobifyEngineStub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
});
