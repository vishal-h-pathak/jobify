// maps.ts — L0 deterministic per-ATS field maps (§3 L0), TS port of
// `jobify/submit/adapters/prepare_dom/field_maps.yml` + the schema rules in
// `field_maps.py::_selectors_for`. Transcribed verbatim: same keys, same
// order (fill order = list order), same required flags, same selector
// chains — with Playwright's `:visible` pseudo dropped from every chain
// (per the porting note: visibility is a runtime helper here, not a
// selector concern). Data only; the join against a live Survey happens in
// plan.ts.

export type FieldType = "text" | "file" | "textarea" | "select";

export type FieldSpec = {
  key: string; // profile key into planFills' value map ("First Name", "__resume__", "__cover_letter__")
  label?: string; // human label; defaults to `key`
  name?: string; // canonical input `name` attribute, if the ATS has one
  type?: FieldType; // default "text"
  required?: boolean;
  selectors?: string[]; // explicit lead (text) or whole chain (file/textarea/select)
  fuzzy_name_fallback?: boolean; // text-only; append input[name*="..."] fuzzy selectors
};

const GREENHOUSE: FieldSpec[] = [
  { key: "First Name", name: "job_application[first_name]", required: true },
  { key: "Last Name", name: "job_application[last_name]", required: true },
  { key: "Full Name" }, // not in the GH name map -> label fallback only
  { key: "Name" },
  { key: "Email", name: "job_application[email]", required: true },
  {
    key: "Phone",
    required: true,
    selectors: [
      // intl-tel-input anchor first; see _common phone notes
      'input[type="tel"]',
      'input[name="job_application[phone]"]',
      'input[id="phone"]',
      'input[aria-label="Phone"]',
    ],
  },
  { key: "LinkedIn URL", name: "job_application[urls][LinkedIn]" },
  { key: "LinkedIn", name: "job_application[urls][LinkedIn]" },
  { key: "GitHub URL", name: "job_application[urls][GitHub]" },
  { key: "GitHub", name: "job_application[urls][GitHub]" },
  { key: "Portfolio", name: "job_application[urls][Portfolio]" },
  { key: "Website", name: "job_application[urls][Website]" },
  { key: "Location", name: "job_application[location]" },
  { key: "Current Location", name: "job_application[location]" },
  { key: "City", name: "job_application[location]" },
  { key: "Current Company", name: "job_application[company]" },
  { key: "Company" }, // not in the GH name map -> label fallback only
  { key: "Current Title", name: "job_application[title]" },
  { key: "Title" },
  {
    key: "__resume__",
    label: "Resume",
    type: "file",
    required: true,
    selectors: [
      'input[type="file"][name="job_application[resume]"]',
      'input[type="file"][name*="resume" i]',
      'input[type="file"][accept*=".pdf"]',
      'input[type="file"]',
    ],
  },
  {
    key: "__cover_letter__",
    label: "Cover Letter",
    type: "textarea",
    selectors: [
      'textarea[name="job_application[cover_letter]"]',
      'textarea[name*="cover" i]',
      'textarea[aria-label*="cover" i]',
      'textarea[placeholder*="cover" i]',
      "textarea",
    ],
  },
];

const LEVER: FieldSpec[] = [
  // Lever puts the full name in a single field (name="name"). plan.ts
  // overrides the Name / Full Name *values* to the computed full name
  // before joining; First Name still maps to name="name" too and is
  // overwritten by the later Full Name / Name specs — net result: full name.
  { key: "First Name", name: "name" },
  { key: "Last Name" }, // not in the Lever name map -> label fallback only
  { key: "Full Name", name: "name" },
  { key: "Name", name: "name", required: true },
  { key: "Email", name: "email", required: true },
  {
    key: "Phone",
    required: true,
    selectors: [
      'input[type="tel"]',
      'input[name="phone"]',
      'input[id="phone"]',
      'input[aria-label="Phone"]',
    ],
  },
  { key: "LinkedIn URL", name: "urls[LinkedIn]" },
  { key: "LinkedIn", name: "urls[LinkedIn]" },
  { key: "GitHub URL", name: "urls[GitHub]" },
  { key: "GitHub", name: "urls[GitHub]" },
  { key: "Portfolio", name: "urls[Portfolio]" },
  { key: "Website", name: "urls[Other]" },
  { key: "Location", name: "location" },
  { key: "Current Location", name: "location" },
  { key: "City", name: "location" },
  { key: "Current Company", name: "org" },
  { key: "Company", name: "org" },
  { key: "Current Title", name: "title" },
  { key: "Title", name: "title" },
  {
    key: "__resume__",
    label: "Resume",
    type: "file",
    required: true,
    selectors: [
      'input[type="file"][name="resume"]',
      'input[type="file"][name*="resume" i]',
      'input[type="file"][accept*=".pdf"]',
      'input[type="file"]',
    ],
  },
  {
    key: "__cover_letter__",
    label: "Cover Letter",
    type: "textarea",
    selectors: [
      'textarea[name="comments"]',
      'textarea[name*="cover" i]',
      'textarea[aria-label*="cover" i]',
      'textarea[placeholder*="cover" i]',
      'textarea[placeholder*="why" i]',
      "textarea",
    ],
  },
];

// Ashby renders a React app with no canonical name map, so every text field
// falls back to label selectors + the two input[name*=...] fuzzy matches
// (fuzzy_name_fallback: true on every field, mirroring the YAML's
// `defaults:` block).
const ASHBY: FieldSpec[] = [
  { key: "First Name", required: true, fuzzy_name_fallback: true },
  { key: "Last Name", required: true, fuzzy_name_fallback: true },
  { key: "Full Name", fuzzy_name_fallback: true },
  { key: "Name", fuzzy_name_fallback: true },
  { key: "Email", required: true, fuzzy_name_fallback: true },
  {
    key: "Phone",
    required: true,
    fuzzy_name_fallback: true,
    selectors: ['input[type="tel"]', 'input[id="phone"]', 'input[aria-label="Phone"]'],
  },
  { key: "LinkedIn URL", fuzzy_name_fallback: true },
  { key: "LinkedIn", fuzzy_name_fallback: true },
  { key: "GitHub URL", fuzzy_name_fallback: true },
  { key: "GitHub", fuzzy_name_fallback: true },
  { key: "Portfolio", fuzzy_name_fallback: true },
  { key: "Website", fuzzy_name_fallback: true },
  { key: "Location", fuzzy_name_fallback: true },
  { key: "Current Location", fuzzy_name_fallback: true },
  { key: "City", fuzzy_name_fallback: true },
  { key: "Current Company", fuzzy_name_fallback: true },
  { key: "Company", fuzzy_name_fallback: true },
  { key: "Current Title", fuzzy_name_fallback: true },
  { key: "Title", fuzzy_name_fallback: true },
  {
    key: "__resume__",
    label: "Resume",
    type: "file",
    required: true,
    fuzzy_name_fallback: true, // merged from the YAML `defaults:` block; inert for type "file"
    selectors: ['input[type="file"]', 'input[accept*=".pdf"]', 'input[accept*="application/pdf"]'],
  },
  {
    key: "__cover_letter__",
    label: "Cover Letter",
    type: "textarea",
    fuzzy_name_fallback: true, // merged from the YAML `defaults:` block; inert for type "textarea"
    selectors: [
      'textarea[name*="cover" i]',
      'textarea[aria-label*="cover" i]',
      'textarea[placeholder*="cover" i]',
      'textarea[name*="additional" i]',
      'textarea[aria-label*="additional" i]',
      "textarea",
      'div[contenteditable="true"]',
    ],
  },
];

// Workday map — NEW for E1 (no Python ancestor). Workday is notoriously
// hostile to name-attribute-based selectors (obfuscated, regenerated per
// deploy), but its `data-automation-id` attributes are stable across a
// given Workday tenant version, so every spec anchors there instead of
// `name`. Provenance of each id (observed pattern in Workday's own
// "Create Account" / "My Information" candidate-facing form):
//   - legalNameSection_firstName / _lastName — the legal-name field group
//   - email — the account/contact email field
//   - phone-number — the phone field within the phone-device section
//   - addressSection_city / _postalCode — the address field group. The
//     packet carries one `location` string (no separate postal code), so
//     City/Location/Current Location all target `addressSection_city`
//     (same "cram one string into the closest single field" approach GH/
//     Lever already take) and `addressSection_postalCode` is left
//     unmapped — no packet source, and it's never `required` here, so an
//     empty value is silently skipped (matches every other optional spec).
//   - file-upload-input — the resume/CV dropzone's underlying file input
//   - source — the "How Did You Hear About Us?" dropdown. No packet key
//     answers this (identity carries no such field), so the spec is
//     present as a known anchor but always resolves empty and is skipped.
const WORKDAY: FieldSpec[] = [
  { key: "First Name", required: true, selectors: ['[data-automation-id="legalNameSection_firstName"]'] },
  { key: "Last Name", required: true, selectors: ['[data-automation-id="legalNameSection_lastName"]'] },
  { key: "Email", required: true, selectors: ['[data-automation-id="email"]'] },
  { key: "Phone", required: true, selectors: ['[data-automation-id="phone-number"]'] },
  { key: "Location", selectors: ['[data-automation-id="addressSection_city"]'] },
  { key: "Current Location", selectors: ['[data-automation-id="addressSection_city"]'] },
  { key: "City", selectors: ['[data-automation-id="addressSection_city"]'] },
  { key: "Source", label: "How did you hear about us?", selectors: ['[data-automation-id="source"]'] },
  {
    key: "__resume__",
    label: "Resume",
    type: "file",
    required: true,
    selectors: ['[data-automation-id="file-upload-input"]'],
  },
];

export const MAPS: Record<"greenhouse" | "lever" | "ashby" | "workday", FieldSpec[]> = {
  greenhouse: GREENHOUSE,
  lever: LEVER,
  ashby: ASHBY,
  workday: WORKDAY,
};

/**
 * Ordered selector chain for one spec — parity-exact with the pre-rewrite
 * per-ATS adapters (`field_maps.py::_selectors_for`):
 *   - explicit `selectors` lead (phone's tel anchor, or the whole file/
 *     textarea/select list);
 *   - then the `name` attr pair (`input[name=]` / `textarea[name=]`);
 *   - for TEXT only: the label-fallback rung (handled by plan.ts matching
 *     `field.label` directly — see plan.ts's join comment for why the
 *     four discrete `label_selectors` strings collapse into one check),
 *     then (if flagged) the two `input[name*=...]` fuzzy selectors.
 * file / textarea / select use the explicit list (+ name pair) ONLY — they
 * never fell back to label selectors in the Python ancestor either.
 */
export function selectorsFor(spec: FieldSpec, label: string): string[] {
  const chain: string[] = [...(spec.selectors ?? [])];
  if (spec.name) {
    chain.push(`input[name="${spec.name}"]`, `textarea[name="${spec.name}"]`);
  }
  const type = spec.type ?? "text";
  if (type === "text" && spec.fuzzy_name_fallback) {
    const low = label.toLowerCase();
    chain.push(`input[name*="${low.replace(/ /g, "_")}"]`, `input[name*="${low.replace(/ /g, "")}"]`);
  }
  return chain;
}
