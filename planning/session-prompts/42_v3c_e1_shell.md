# Session 42 — V3C-E1B: the extension shell  (V3c E1, parallel with 41)

**Model: Sonnet.** Spec = `planning/V3C_DESIGN.md` (v2.1) §0, §8 (auth D2),
§9 (E1) — read FIRST. This is the MV3 wrapper around session 41's engine:
manifest, build, auth handoff, panel skeleton, packet plumbing. **E1 has NO
navigation, NO auto-advance, NO telemetry writes, and NO LLM anywhere** —
the panel fills the current page only; the human does everything else.
**Branch:** `feat/v3c-e1-shell` off main, worktree `jobify-wt/v3c-e1-shell`.
**You own:** `extension/manifest.json`, `extension/shell/**`, the root
`extension/` build tooling (one command → `extension/dist/` loadable
unpacked) + `extension/README.md`, and ADDITIVE web changes ONLY for:
the token handoff emitter, `GET /api/submit/ready` (below), and their tests.
Do NOT touch `extension/engine/**` (41's — consume its pinned API exactly),
the kit/setup pages, other api routes, migrations, `jobify/` Python.

## PINNED CONTRACT (shared verbatim with session 41)
The engine API + `Survey`/`FillInstruction`/`FillOutcome`/`FillReport`/
`AtsMapKind`/`EngineFiles` types in `41_v3c_e1_engine.md`'s pinned block —
consume exactly; the engine package root exports nothing else. The engine
carries its own verbatim copy of `SubmitPacket`; you own a **drift test**
asserting it stays byte-identical to `web/lib/submit/types.ts`'s.

## Build

1. **Manifest (MV3, Chromium-first).** Minimal permissions, pinned:
   `storage`, `sidePanel`, `activeTab`; content scripts (`all_frames: true`)
   on the ATS hosts the L0 maps cover (greenhouse.io, lever.co, ashby*.com,
   myworkday*.com — mirror `web/lib/submit/atsDetect.ts`'s domain rules) +
   the app origin for handoff; `host_permissions` for the app origin only.
   A manifest audit test asserts this exact permission set — adding a
   permission must fail a test until deliberately updated. **No `debugger`
   permission in E1.** Pin the extension ID via the manifest `key` field so
   load-unpacked IDs are stable across friends' machines (needed for
   handoff); document how in the README.
2. **Auth: token handoff (owner decision D2).** The web app hands the
   session to the extension; no separate login. Mechanism is yours to pick
   (`externally_connectable` message from the app origin, or an app-origin
   content script relaying via `chrome.runtime.sendMessage`) — requirements
   either way: tokens never appear in URLs or logs (the `dispatchHunt.ts`
   never-log rule applies verbatim), refresh handled via supabase-js in the
   shell's background worker, session stored in `chrome.storage.session`
   (memory-backed) not `.local` unless refresh needs otherwise (justify),
   signed-out panel state deep-links to the app login and completes handoff
   on return. Web side: a small additive emitter (component or layout hook)
   + tests; nothing else in `web/` moves.
3. **`GET /api/submit/ready`** (new, additive; same auth-gate-then-admin-
   client pattern as `/api/submit/packet`): the user's succeeded tailor runs
   as `[{ posting_id, title, company, application_url }]`, newest first —
   this is how the panel knows what's submittable. Tests mirror the packet
   route's (401/403/shape/own-rows-only).
4. **The panel (chrome.sidePanel).** Dependency-light UI (vanilla TS or
   preact — pick one, justify; visually quiet, warm-dark-adjacent). States:
   signed-out → handoff CTA; signed-in + no match → "ready to submit" list
   from `/api/submit/ready`, auto-selected when the active tab's hostname
   matches a posting's `application_url` (manual pick fallback); selected →
   fetch packet, show identity/materials summary + **"Fill this page"**.
   Fill flow: fetch the two PDFs via the packet's signed URLs → `File`s →
   content script runs `survey` → `planFills(survey, packet, ats)` →
   `executeFills` → render the `FillReport` as a per-field checklist
   (filled / stuck / required-empty), the unfilled remainder as copyable
   handoff lines (values from the packet — the `handoff.py` pattern), and
   the closing copy: everything else is yours — review the page and click
   Submit yourself. `ats` comes from `packet.posting.ats_kind` mapped onto
   `AtsMapKind` (anything else → `"generic"` → plan is empty → pure
   handoff view). Errors are honest and specific (packet 409 → "finish
   submitter setup in the app first", expired signed URL → refetch packet
   once).
5. **Build + README.** One command (`npm run build` in `extension/`)
   bundles engine + shell → `dist/`; README documents dev build, the
   load-unpacked steps for friends (with the pinned-ID note), and what the
   extension can NEVER do (no submit clicks, no navigation in E1, no keys,
   no LLM calls — cite V3C_DESIGN §0).

## Constitution (enforced here too)
The shell never calls any engine internals (public API only — 41's export
test is your guarantee); no code path clicks any surveyed button; no
Anthropic/API key, no LLM call, no fetch to any non-app origin except the
packet's signed storage URLs; a grep-test asserts `anthropic` /
`ANTHROPIC` / `api_key` appear nowhere in `extension/`.

## Tests
Mocked-`chrome` unit tests: handoff state machine (signed-out → handoff →
signed-in → refresh; token never serialized into any log/URL string —
assert via spy); ready-list auto-match by hostname (match, multi-match →
manual pick, no match); fill-flow orchestration with a fake engine (PDF
fetch → Files, report rendering incl. stuck + required-empty + handoff
lines, generic → handoff-only); manifest audit; SubmitPacket drift test;
web: emitter + `/api/submit/ready` suites. Alex Quinn everywhere. Full web
suite still green.

## Exit criteria
`extension/` build produces a loadable dist; extension + web tests green;
tsc clean in both; scrub gate PASS; diff inside ownership. Commit:
`V3C-E1B: MV3 shell — manifest, token handoff, ready list, panel fill flow`.
Push; do NOT merge.
