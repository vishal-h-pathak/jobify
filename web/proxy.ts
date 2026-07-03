import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/updateSession";

// Renamed from `middleware.ts` in Next.js 16 — see
// node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md
// "middleware to proxy".
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
