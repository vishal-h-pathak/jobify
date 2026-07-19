# V3c — The Submitter (design v2.1, robustness-first — decisions resolved, build-ready)

_Fable design pass, 2026-07-18 (v2.1: all build-blocking questions answered by the owner
same day; §10 is the decision record). Mandate: the submitter drives the **entire
application flow** — every page, every field, every widget — so the human's only job is
to review what will be filed and click the final submit themselves. Robustness across
the whole scrounged-up long tail of ATSes is the priority; a longer buildout is
accepted. Builds on main (V3b complete: `tailor_runs`/0012, `job-materials/{user}/
{posting}/`, claims verifier). Next free migration: **0013**._

---

## 0. Constitution (non-negotiable)

1. **Stop-at-final-submit.** The engine may fill fields, operate widgets (including the
   clicks a combobox or file picker requires), and advance **non-final** navigation. It
   must never trigger the action that files the application. Because the engine clicks,
   enforcement is layered detection, not capability-absence (§4.2): per-ATS final-action
   signatures, a generic deny lexicon, LLM button classification with **unknown →
   treated as final → stop**, and a CI deny-test over all shipped maps. The interactive
   loop's toolset contains no submit tool. CAPTCHA and login walls are never automated —
   they become human checklist steps.
2. **Scrub gate.** Extension workspace + kit pages in `scripts/scrub_gate.sh` scope from
   commit one; Alex Quinn persona in all fixtures; never quote scrub tokens in tracked
   files.
3. **Budget ledger.** Every LLM call writes a ledger row. The extension makes **zero
   client-side LLM calls** — no key ships in a client artifact; all model use routes
   through web APIs that write rows and honor pool/BYO gates.

## 1. Architecture verdicts (condensed from v1)

| | UX | Build | Reach | Per-ATS maint | Hosting $ | Install friction |
|---|---|---|---|---|---|---|
| **WebExtension** (chosen) | ★★★★ | the program below | Chromium family one codebase; Firefox cheap port; Safari = Xcode wrap, deferred | data-driven, server-updatable | ~0 | load-unpacked at friends scale (accepted) |
| Local Playwright companion | ★★★ | high (packaging + per-user auth) | desktop | shared maps | 0 | worst — Python + creds; service-role can't be distributed |
| Hosted browser live-view (Path B) | ★★ | high | any device | worst | per-minute | none |
| Submit kit | ★★ | ~1 session | total | zero | 0 | zero |

Path B stays retired **for cause**: field record of never reaching networkidle before
survey (`runner_legacy.py` header), no user cookies (login-gated ATSes dead), datacenter
bot-detection, and the submit click executing on infrastructure we operate. The
extension runs in the user's real logged-in browser — their cookies, their IP, their
tab — which dissolves the login and bot-detection classes outright. The kit is
stop-at-submit by construction and doubles as the ladder's floor (§3, L4).

## 2. Failure taxonomy (why submitters break — field-informed)

The single-user pipeline's pain, classified; every mechanism in §3–4 answers a row.

- **F1 Timing.** Dynamic renders beat load-state heuristics (killed Path B). Extension
  answer: we're inside the page — settle on MutationObserver quiescence + element-level
  retry, never a global networkidle wait.
- **F2 Discovery.** Fields hidden in open shadow roots (Workday), same- and cross-origin
  iframes (Greenhouse embeds, iCIMS), lazy React mounts. Answer: the survey engine
  (§3.1) traverses shadow roots recursively and injects `all_frames` with host
  permissions — an extension superpower the page itself doesn't have.
- **F3 Fills that don't stick.** React controlled inputs reset synthetic values; masked
  phone inputs; validate-on-blur wipes; typeaheads that require *selecting* an option,
  not typing text. Answer: widget drivers (§3.2) + read-back verification (§3.3) with
  strategy escalation. Honest note: content-script events carry `isTrusted:false`;
  rare frameworks care. Last-resort driver: `chrome.debugger` trusted input (shows a
  banner while attached) — implemented once in the primitives, used only on read-back
  failure.
- **F4 Uploads.** Inputs hidden behind dropzones (DataTransfer → `input.files`),
  immediate-XHR uploaders (fine — input-triggered), drag-drop-only zones (synthesized
  drop events).
- **F5 Multi-page flows.** Fields spread across a wizard; state lost on navigation.
  Answer: the navigator (§4) — a per-application flow session in the background service
  worker; survey → fill → verify per page.
- **F6 Walls.** Workday account creation, logins, email verification, CAPTCHA. Never
  automated; the panel turns each into a checklist step, and the user's browser session
  persists so each wall is paid once per company, ever.
- **F7 URL indirection.** Aggregator links → real ATS endpoint, resolved server-side in
  the packet (port of `tailor/url_resolver`), before the flow starts.
- **F8 Final-action ambiguity.** A "Continue" that files vs a "Submit" that paginates.
  This is the safety-critical class the classifier (§4.2) exists for.

## 3. The fill ladder

Each layer catches what the one above missed; every layer's output flows through the
same read-back verifier; everything unfilled at the bottom becomes checklist + copy
buttons. Layer used per field is recorded (§6).

- **L0 — deterministic per-ATS maps.** GH/Lever/Ashby ported from `field_maps.yml`
  (§7). **New: a Workday map** — Workday is notoriously hostile but unusually mappable:
  stable `data-automation-id` attributes anchor selectors. Further maps (iCIMS,
  SmartRecruiters, …) added in telemetry-ranked order, server-fetched (§3.4).
- **L1 — heuristic autofill, zero-LLM.** For unmapped fields/ATSes: `autocomplete`
  attributes (`given-name`, `email`, `tel`…), input types, and a label lexicon matched
  against the packet's identity keys. Conservative threshold; browsers prove this layer
  covers most contact fields anywhere.
- **L2 — LLM survey mapping (server route, one-shot).** The normalized field survey
  (§3.1) → `POST /api/submit/map` → model returns `{field_id → packet_key | literal,
  confidence}` **plus a classification for every button** (advance / final / other /
  unknown). Verified successes write to the learned-maps cache (§6.2), so the long tail
  converges: the second user on the same form pays $0.
- **L3 — bounded interactive loop (the apex, hosted heir of `prepare_loop.py`).** For
  forms L0–L2 can't finish: server LLM ↔ extension executor. Toolset: `get_survey`,
  `fill_field`, `operate_widget`, `upload`, `screenshot`, `advance` (refuses
  final-classified targets), `finish_preparation`, `queue_for_human` — **no submit tool
  exists**. Each turn is one stateless request/response (serverless-friendly; the
  extension orchestrates turns). Uncapped for now per owner; every turn ledgered;
  per-application cost rolled up and displayed (§6.3).
- **L4 — kit/manual.** The submit-kit page and the panel checklist: labeled copy blocks
  for whatever remains, materials downloads, the human finishes by hand. Always present;
  never removed by higher layers succeeding.

### 3.1 Survey engine (the foundation everything shares)
TS port + upgrade of `browser_tools.py::get_form_fields`: enumerate fields and buttons
with stable ids across document + open shadow roots + frames; label resolution ladder
(`<label for>` → `aria-label`/`aria-labelledby` → placeholder → preceding text →
fieldset legend); emit one normalized survey JSON. That JSON is the lingua franca for
L1 matching, L2/L3 prompts, read-back verification, telemetry, and learned-map
signatures. Survey quality bounds the whole system — it gets the deepest test fixtures
(saved DOM snapshots per ATS, including shadow/iframe cases).

### 3.2 Widget drivers
Detection by role/pattern, not tag: native input/textarea/select; ARIA combobox (open →
type → await listbox → click matching option — widget-scoped clicks are filling, not
navigation); radio/checkbox groups by label similarity; date inputs; typeahead-with-
required-selection (the location-field killer); file dropzones. One driver library,
shared by every ladder layer.

### 3.3 Read-back verification
After each fill: re-survey the element, compare stored vs intended value (normalized),
on mismatch retry the next strategy (native-setter → per-key events → debugger input),
then mark honestly unfilled. Per-page gate: required fields verified before the
navigator may advance. Final cross-page summary — "filled X of Y across N pages" — is
the confirm-gate content (§4.3). Heir of `verify.py`'s Part B.

### 3.4 Map distribution
Bundled JSON fallback + server-fetched maps (shipped + learned, merged: learned-verified
> shipped > heuristic). Selector fixes and new ATS maps deploy without touching the
extension — critical once store review adds latency to every shipped byte.

## 4. The navigator and the confirm gate (safety-critical core)

### 4.1 Flow state machine
One flow session per application attempt, held in the background service worker,
surviving page navigations. States: `resolving → page_form(n) → wall(login|captcha|
verify) → review → awaiting_human_submit → confirmed | abandoned`. Page-state detection:
per-ATS signatures (URL patterns + DOM markers) first, L2 classification fallback. The
navigator advances only when the current page's required fields pass read-back; on a
`wall` state it stops and shows the human step.

### 4.2 Final-action classifier (the constitutional enforcement)
Layered, conservative: (1) per-ATS final signatures in the maps (e.g. Workday's submit
`data-automation-id`, GH "Submit application"); (2) generic deny lexicon
(`submit|apply|send|finish|complete` in application context); (3) L2's per-button
classification; (4) an advance allowlist (`next|continue|save|review`). The engine
clicks **only** allowlist-classified buttons; deny, conflict, or **unknown → stop and
hand to the human**. CI walks every shipped map and fails on any advance-target matching
the deny lexicon; the L3 toolset's `advance` re-checks classification at click time.

**Shadow-mode rollout (owner decision D4):** at launch the navigator *proposes* each
advance and the human clicks it; disagreements are telemetry. Auto-advance unlocks
**per-ATS** after **10 clean owner-only flows** (every proposed click correct, zero
misjudged buttons); the hardening view (§6.1) shows the per-ATS counter and the flip is
a deliberate admin action, not automatic. Friends stay in shadow mode until each ATS
clears the owner's bar.

### 4.3 Confirm gate
On reaching `review` (or the last form page), the engine stops — always. The panel
presents the cross-page fill summary, per-field provenance (which layer filled it),
materials links, and anything unfilled; the ATS's own review UI is in front of the
human. They fix, then click the ATS's submit themselves. The extension then *passively*
detects the confirmation page (URL/DOM signature — read-only, constitutionally clean),
closes the flow as `confirmed`, marks the match applied, and writes the submit event.

## 5. The application profile — submitter onboarding (owner decision D1)

The submitter gets **its own onboarding**: a one-time guided flow, launched the first
time a user opens the kit or the extension panel, collecting everything that repeats
across applications — contact block (phone, location, LinkedIn/GitHub/portfolio),
work authorization + sponsorship, notice period / start availability, salary-expectation
stance, and the voluntary self-identification set (gender/veteran/disability) that
nearly every US form asks — each field skippable, with plain copy: "used only to fill
the boxes you'd otherwise fill by hand; leave anything blank and the submitter leaves
that box blank." A review screen closes the flow; Settings hosts the edit surface
afterward. The main v3 intake stays untouched — story there, logistics here.

**Secure storage (owner requirement: "not accessible to anyone else"):** this data does
NOT live in `profiles.doc` (which has an admin review surface by design). It lives in a
dedicated `application_profiles` row, **encrypted at rest** with the established
`jobify/hosted/keycrypt.py` pattern (same posture as BYO API keys): the client can never
read it back raw except through its own authenticated edit view; the packet endpoint
decrypts server-side per request; **no admin surface renders it, ever**; it is excluded
from any future export/telemetry by construction (submit telemetry stores field labels
and outcomes, never values — §6.1).

## 6. The hardening flywheel

1. **Per-field telemetry.** Every flow writes a `submit_events` row: per-field outcomes
   `{label, layer, filled, stuck_after_readback}`, page count, wall types hit, advance
   proposals vs human clicks (shadow-mode agreement data), final state, cost — labels
   and outcomes only, never filled values. The admin hardening view ranks worst
   ATSes/fields and shows the per-ATS auto-advance counters — that ranking *is* the L0
   map roadmap.
2. **Global learned maps (owner decision D-v2).** `learned_field_maps`: signature =
   `(hostname, field-shape hash)` → verified `field→packet_key` mapping + success
   stats. Structure only — labels, names, selectors; **never values**. Written
   server-side after read-back-verified success; served merged into map fetches. This
   converts LLM spend into permanent deterministic coverage.
3. **Cost gauging (owner decision D-v2).** No per-application cap yet: ledger events
   `submit_map` / `submit_loop_turn` / `submit_classify` / `submit_answers` /
   `tailor_answers`, rolled up into `submit_events.cost_usd` and an admin
   per-application cost view. Pool gate still applies. Revisit a cap at the E4
   checkpoint with real numbers.

## 7. Reuse map (`jobify/submit/` → V3c)

| Asset | Verdict |
|---|---|
| `prepare_dom/field_maps.yml` | **Port verbatim** → L0 maps (selector chains, fill order, required flags, Lever name override = the accumulated ATS knowledge) |
| `prepare_dom/field_maps.py` (`_selectors_for`, `apply_field_map`) | **Port logic** → engine core; same schema + chain rules; strip Playwright `:visible` → visibility helper |
| `prepare_dom/_common.py` (primitives, `build_field_map`, `load_cover_letter`) | **Port logic** → TS primitives + the packet's identity-key contract |
| `adapters/browser_tools.py::get_form_fields` | **Port + upgrade** → the survey engine (§3.1), adding shadow-DOM/iframe traversal it never had |
| `prepare_loop.py` toolset + no-submit shape | **Direct ancestor of L3** — same tool grammar, submit tool still absent, `advance` added under classifier guard |
| `verify.py` Part B ("filled X of Y") | **Pattern** → read-back verifier + confirm-gate summary |
| `handoff.py` (assisted-manual degrade, checklist) | **Pattern** → panel checklist + kit page + wall steps |
| `shared/ats_detect` + `tailor/url_resolver` | **Port rules** → TS ats-kind detection; aggregator resolution stays server-side in the packet |
| `hosted/keycrypt.py` (BYO-key encryption) | **Reuse pattern** → `application_profiles` encryption at rest (§5) |
| `prepare_dom/{greenhouse,lever,ashby}.py` | Knowledge only (detect() URLs; GH direct / Lever `/apply` / Ashby `/application`; React caveat) |
| `browser/local.py` (CDP / persistent profile) | Keep as-is — operator power tool, not shipped |
| `runner_legacy.py`, `router.py`, `confirm.py`, `adapters/deterministic/*`, `adapters/_common.py`, `browser/session.py`, `review_packet.py` | **Not reused** — retired Path B; `confirm.py`'s auto-submit policy constitutionally dead; do not revive |

## 8. Packet, migrations, storage, dispatch (against live schema, 0012 applied)

The submit packet (`GET /api/submit/packet?posting_id=`): posting + `ats_kind` +
resolved URL; identity block (decrypted server-side from `application_profiles`, keyed
to `build_field_map` labels); signed material URLs (V3b posture); answer drafts;
`tailor_run_id`/`doc_sha256`. One contract, three consumers: kit page, extension panel,
and the L2/L3 server prompts. **Auth (owner decision D2): token handoff** — the web app
messages the session to the extension via `externally_connectable`; if no session
exists, the panel deep-links to the login page and receives the handoff on completion.

1. **Migration 0013 — `0013_v3c_submit.sql`:** `submit_events` (user_id FK, posting_id
   FK, source `kit|extension`, final state, `pages int`, `field_outcomes jsonb`,
   `walls jsonb`, `advance_agreement jsonb`, `cost_usd numeric`, created_at; RLS
   own-row) **+** `learned_field_maps` (signature cols, hostname, `ats_kind`,
   `mapping jsonb` — structure only, `verified_count int`, `last_verified_at`;
   service-role only, served via API) **+** `application_profiles` (user_id PK FK,
   `encrypted_payload text` (keycrypt), `updated_at`; service-role only — client
   reads/writes go through authed routes that encrypt/decrypt server-side).
2. **`tailor_runs` (0012) — hybrid answers (owner decision D3):** `mode` CHECK gains
   `'answers'`; the V3b worker pre-drafts the predictable set (why-this-company,
   availability, relocation) into `form_answers.json` — a seventh object in
   `job-materials/{user}/{posting}/`, existing RLS path policy covers it. On-page
   custom questions are drafted on-demand by `POST /api/submit/answers` from their
   exact wording, cached into the same object.
3. **Dispatch: no GHA — deliberate divergence from V3b.** Submit is interactive and
   latency-sensitive: kit = SSR; engine = client; `submit/map`, `submit/loop`,
   `submit/answers` = Vercel routes (each loop turn one stateless request). No new
   workflows, secrets, or dispatch-token changes.
4. **Ledger:** events per §6.3, written server-side per call; extension bundle holds no
   key (manifest: ATS-domain content scripts, `storage`, `debugger` (declared,
   last-resort driver), packet/map/loop API hosts).

## 9. Build phases (the longer program, accepted)

- **P0 — foundations to apply with (1–2 Sonnet sessions, ships first).** Submitter
  onboarding + `application_profiles` (0013 applied here) + packet endpoint + token
  handoff plumbing + `/submit/[postingId]` kit page + applied-marking. The kit makes
  every friend a functioning (manual) submitter while the extension is built.
- **E1 — engine foundation (2 sessions).** Survey engine w/ shadow+iframe fixtures,
  widget drivers, read-back verifier, L0 port (GH/Lever/Ashby) + **Workday map**,
  panel skeleton consuming the packet. No navigation, no LLM.
- **E2 — navigator in shadow mode (1–2 sessions).** Flow state machine, final-action
  classifier + CI deny-tests, confirm gate, passive confirmation detection,
  `submit_events` telemetry writes + advance-agreement capture.
- **E3 — assist + flywheel (1–2 sessions).** L1 heuristics, L2 mapping route,
  learned-maps cache + merged map serving, hybrid answer drafts (worker step + route),
  admin hardening view + per-application cost view.
- **E4 — the loop + auto-advance (1–2 sessions).** L3 interactive loop; per-ATS
  auto-advance flips as owner flows clear the 10-clean bar (D4). **Checkpoint: review
  real per-application costs; set or decline a cap (D-v2).**
- **E5 — reach (ongoing).** Telemetry-ranked new maps (iCIMS next, likely), Firefox
  build, unlisted Web Store listing when load-unpacked chafes, Safari only on demand.

## 10. Decision record (owner, 2026-07-18) — no open build-blockers remain

- **D-v2a Full-flow automation:** engine drives the whole application; human reviews at
  the confirm gate and clicks the ATS's final submit. (Supersedes v1's fills-only.)
- **D-v2b Learned maps:** global shared cache, structure-only, never values.
- **D-v2c Assist budget:** uncapped while gauging; all calls ledgered; per-application
  cost surfaced; cap decision at E4 checkpoint.
- **D1 Application profile:** dedicated submitter onboarding (not a bare settings card);
  data encrypted at rest via the keycrypt pattern; no admin surface; settings = edit
  view. One scope call flagged for veto: voluntary self-ID (EEO) fields are included,
  skippable, never required — cut the section if unwanted.
- **D2 Extension auth:** token handoff from the logged-in web app; login deep-link
  fallback.
- **D3 Answer drafts:** hybrid — predictable answers pre-drafted at tailor time; on-page
  custom questions drafted on-demand from exact wording.
- **D4 Auto-advance bar:** shadow mode at launch; per-ATS unlock after 10 clean
  owner-only flows; admin flips the switch deliberately; friends shadow until then.
