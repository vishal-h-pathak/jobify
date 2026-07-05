import { describe, expect, it } from "vitest";
import LoginPage from "./page";

describe("/login page", () => {
  it("passes the decoded next search param through to LoginForm", async () => {
    const result = await LoginPage({ searchParams: Promise.resolve({ next: "/invite?code=ABC" }) });
    const form = result.props.children;
    expect(form.type.name).toBe("LoginForm");
    expect(form.props.next).toBe("/invite?code=ABC");
  });

  it("passes null when there is no next param", async () => {
    const result = await LoginPage({ searchParams: Promise.resolve({}) });
    const form = result.props.children;
    expect(form.props.next).toBeNull();
  });
});
