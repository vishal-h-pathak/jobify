import { NextRequest, NextResponse } from "next/server";

// Next 16 renamed the request-interceptor file convention from
// `middleware.ts` to `proxy.ts` (same runtime, same matcher config). The
// password gate below is the contract — behavior is unchanged from the old
// middleware: every matched route requires the dashboard_auth cookie unless
// DASHBOARD_PASSWORD is unset (open mode) or the path is the login page.
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/dashboard/login")) {
    return NextResponse.next();
  }
  const expected = process.env.DASHBOARD_PASSWORD;
  // If no password is configured, allow access without auth
  if (!expected) {
    return NextResponse.next();
  }
  const cookie = req.cookies.get("dashboard_auth")?.value;
  if (cookie !== expected) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    return NextResponse.redirect(new URL("/dashboard/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/chat",
    "/api/materials/:path*",
    "/api/dashboard/:path*",
  ],
};
