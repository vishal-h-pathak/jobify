import { redirect } from "next/navigation";

/**
 * No public marketing homepage in the standalone cockpit — the root path
 * sends straight to the dashboard. The dashboard_auth middleware then
 * bounces unauthenticated visitors to /dashboard/login.
 */
export default function Home() {
  redirect("/dashboard");
}
