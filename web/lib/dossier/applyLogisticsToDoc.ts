import yaml from "js-yaml";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseYamlObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const parsed = yaml.load(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function dumpYaml(value: unknown): string {
  return yaml.dump(value, { noRefs: true, lineWidth: -1 });
}

/**
 * Surgically merges into profile.yml's `identity.location_and_compensation`
 * key — the dossier's typed comp-floor/location/remote inline edit
 * (session-prompts/33 build item 3) has no home in wave-1's
 * `lib/onboarding/incrementalDoc.ts::applyModuleToDoc` (that switch only
 * covers the phase-1 module cases; location/comp is filled later by the
 * legacy v2 "targeting" stage's completion write, same field shape as
 * `lib/profile/buildDoc.ts::LocationAndCompensation`). Patching just this
 * one key avoids rebuilding the whole file the way that full-doc assembly
 * does, so it can't regress fields this edit never touched.
 */
export function applyLogisticsToDoc(
  doc: Record<string, string>,
  locationAndCompensationPatch: Record<string, unknown>
): Record<string, string> {
  const profile = parseYamlObject(doc["profile.yml"] ?? "");
  const identity = isPlainObject(profile.identity) ? profile.identity : { name: "", email: "" };
  const existingLocationAndComp = isPlainObject(identity.location_and_compensation)
    ? identity.location_and_compensation
    : {};

  const nextProfile = {
    ...profile,
    identity: {
      ...identity,
      location_and_compensation: { ...existingLocationAndComp, ...locationAndCompensationPatch },
    },
  };

  return { ...doc, "profile.yml": dumpYaml(nextProfile) };
}
