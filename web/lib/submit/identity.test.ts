import { describe, expect, it } from "vitest";
import { buildIdentity } from "./identity";
import type { ApplicationProfile } from "./types";

const AUTH_EMAIL = "alex@example.com";

function docWithIdentity(identity: Record<string, unknown>): Record<string, string> {
  const lines = Object.entries(identity).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`);
  return { "profile.yml": ["identity:", ...lines].join("\n") };
}

function emptyApplicationProfile(): ApplicationProfile {
  return { contact: {}, authorization: {}, logistics: {}, self_id: {} };
}

describe("buildIdentity", () => {
  it("falls back to profile.yml identity everywhere when there is no application profile", () => {
    const doc = docWithIdentity({
      name: "Alex Quinn",
      phone: "555-0100",
      location_base: "Remote",
      linkedin: "https://linkedin.com/in/alexquinn",
      website: "https://alexquinn.example.com",
      github: "https://github.com/alexquinn",
    });

    const identity = buildIdentity(doc, null, AUTH_EMAIL);

    expect(identity).toEqual({
      first_name: "Alex",
      last_name: "Quinn",
      full_name: "Alex Quinn",
      email: AUTH_EMAIL,
      phone: "555-0100",
      location: "Remote",
      linkedin_url: "https://linkedin.com/in/alexquinn",
      github_url: "https://github.com/alexquinn",
      portfolio_url: "https://alexquinn.example.com",
    });
  });

  it("uses the application profile's contact fields when there is no profile.yml doc at all, leaving name fields blank", () => {
    const applicationProfile: ApplicationProfile = {
      ...emptyApplicationProfile(),
      contact: {
        phone: "555-0199",
        location: "Atlanta, GA",
        linkedin_url: "https://linkedin.com/in/app-profile",
        github_url: "https://github.com/app-profile",
        portfolio_url: "https://app-profile.example.com",
      },
    };

    const identity = buildIdentity(null, applicationProfile, AUTH_EMAIL);

    expect(identity).toEqual({
      first_name: "",
      last_name: "",
      full_name: "",
      email: AUTH_EMAIL,
      phone: "555-0199",
      location: "Atlanta, GA",
      linkedin_url: "https://linkedin.com/in/app-profile",
      github_url: "https://github.com/app-profile",
      portfolio_url: "https://app-profile.example.com",
    });
  });

  it("prefers the application profile's contact fields over profile.yml's when both are present, and auth email always wins over profile.yml's identity.email", () => {
    const doc = docWithIdentity({
      name: "Alex Quinn",
      email: "not-the-real-email@example.com",
      phone: "555-0100",
      location_base: "Remote",
      linkedin: "https://linkedin.com/in/doc-value",
      website: "https://doc-value.example.com",
      github: "https://github.com/doc-value",
    });
    const applicationProfile: ApplicationProfile = {
      ...emptyApplicationProfile(),
      contact: {
        phone: "555-0199",
        location: "Atlanta, GA",
        linkedin_url: "https://linkedin.com/in/app-profile",
        github_url: "https://github.com/app-profile",
        portfolio_url: "https://app-profile.example.com",
      },
    };

    const identity = buildIdentity(doc, applicationProfile, AUTH_EMAIL);

    expect(identity.email).toBe(AUTH_EMAIL);
    expect(identity.phone).toBe("555-0199");
    expect(identity.location).toBe("Atlanta, GA");
    expect(identity.linkedin_url).toBe("https://linkedin.com/in/app-profile");
    expect(identity.github_url).toBe("https://github.com/app-profile");
    expect(identity.portfolio_url).toBe("https://app-profile.example.com");
    expect(identity.first_name).toBe("Alex");
    expect(identity.last_name).toBe("Quinn");
  });

  it("falls back to profile.yml per-field when the application profile's contact fields are blank strings", () => {
    const doc = docWithIdentity({
      name: "Alex Quinn",
      phone: "555-0100",
      location_base: "Remote",
    });
    const applicationProfile: ApplicationProfile = {
      ...emptyApplicationProfile(),
      contact: { phone: "", location: "" },
    };

    const identity = buildIdentity(doc, applicationProfile, AUTH_EMAIL);

    expect(identity.phone).toBe("555-0100");
    expect(identity.location).toBe("Remote");
  });

  it("splits a one-word name into first_name only, with an empty last_name", () => {
    const doc = docWithIdentity({ name: "Cher" });
    const identity = buildIdentity(doc, null, AUTH_EMAIL);
    expect(identity.first_name).toBe("Cher");
    expect(identity.last_name).toBe("");
    expect(identity.full_name).toBe("Cher");
  });

  it("returns all-blank name fields and contact fields when the name/contact data is missing or blank", () => {
    const identity = buildIdentity(null, null, AUTH_EMAIL);
    expect(identity).toEqual({
      first_name: "",
      last_name: "",
      full_name: "",
      email: AUTH_EMAIL,
      phone: "",
      location: "",
      linkedin_url: "",
      github_url: "",
      portfolio_url: "",
    });
  });

  it("splits only on the first space, keeping middle/last names together in last_name", () => {
    const doc = docWithIdentity({ name: "Alex Q. Quinn Jr." });
    const identity = buildIdentity(doc, null, AUTH_EMAIL);
    expect(identity.first_name).toBe("Alex");
    expect(identity.last_name).toBe("Q. Quinn Jr.");
    expect(identity.full_name).toBe("Alex Q. Quinn Jr.");
  });
});
