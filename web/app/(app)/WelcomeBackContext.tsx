"use client";

import { createContext, useContext } from "react";
import type { WelcomeBackInfo } from "@/lib/onboarding/welcomeBack";

const WelcomeBackContext = createContext<WelcomeBackInfo | null>(null);

/**
 * Carries the (app) layout's server-computed "Welcome back" data down to
 * `/onboarding` (a client component) without a new API-route field or a
 * second client fetch — the layout already reads the session row to derive
 * nav progress, so it derives this too and hands it down via context.
 */
export function WelcomeBackProvider({
  value,
  children,
}: {
  value: WelcomeBackInfo | null;
  children: React.ReactNode;
}) {
  return <WelcomeBackContext.Provider value={value}>{children}</WelcomeBackContext.Provider>;
}

export function useWelcomeBack(): WelcomeBackInfo | null {
  return useContext(WelcomeBackContext);
}
