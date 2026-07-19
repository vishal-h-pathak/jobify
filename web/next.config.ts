import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // Session 43 ships `lib/onboarding/intakeComplete.ts` in a sibling
      // worktree — absent here until merge. See
      // `types/intakeComplete-ambient.d.ts` for the full story. Turbopack
      // requires this relative to the project root (an absolute path 404s
      // as a "server relative import").
      "@/lib/onboarding/intakeComplete": "./lib/onboarding/intakeCompleteStub.ts",
    },
  },
};

export default nextConfig;
