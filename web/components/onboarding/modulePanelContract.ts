/**
 * V3A_DESIGN.md §4 — the pinned `ModulePanelProps` slot contract, shared
 * verbatim with B2's session prompt. Every module panel the onboarding page
 * mounts (this wave's structured panels, and B2's future VoicePanel /
 * MetricsPanel / MirrorReveal) takes at minimum these two props: `onComplete`
 * fires once the panel's own POST has succeeded and the module is marked
 * complete server-side, so the page can refresh state and advance to
 * `next_module`; `fetchImpl` is the same DI seam every network call in this
 * repo uses, defaulting to the real `fetch`. Panels that need their own data
 * (e.g. `ValuePairsPanel`'s `valuePairs`) extend this with additional
 * required props — the two below are never optional-away'd or renamed.
 */
export interface ModulePanelProps {
  onComplete: () => void;
  fetchImpl?: typeof fetch;
}
