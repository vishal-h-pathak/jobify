import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = form.get("password");
  const expected = process.env.DASHBOARD_PASSWORD;

  if (typeof password === "string" && expected && password === expected) {
    const res = NextResponse.redirect(new URL("/dashboard", req.url), 303);
    res.cookies.set("dashboard_auth", expected, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  }

  return NextResponse.redirect(new URL("/dashboard/login?error=1", req.url), 303);
}
