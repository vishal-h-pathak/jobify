import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // Session 43's `lib/onboarding/intakeComplete.ts` — see
      // `types/intakeComplete-ambient.d.ts`. Must precede the generic "@"
      // alias below so this exact specifier resolves to the stub first.
      {
        find: "@/lib/onboarding/intakeComplete",
        replacement: path.resolve(__dirname, "lib/onboarding/intakeCompleteStub.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, ".") },
    ],
  },
  test: {
    environment: "node",
  },
});
