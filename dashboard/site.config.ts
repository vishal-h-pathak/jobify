/**
 * Site identity — single source of truth for the branding shown in the
 * dashboard chrome. Nothing here is hard-coded to a specific person; the
 * display name comes from NEXT_PUBLIC_SITE_NAME (inlined at build time)
 * and falls back to a neutral default so a fresh clone runs out of the box.
 */
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Jobify";

export const SITE_DESCRIPTION =
  "Job-application pipeline cockpit — hunt, tailor, and pre-fill applications.";
