# jobify submitter — browser extension (V3c E1)

An MV3 Chrome extension that fills in job-application forms from your
tailored jobify materials. It **never clicks a final submit button** — see
"What this extension can never do" below.

## Layout

```
extension/
  manifest.json     — MV3 manifest (this session)
  build.mjs          — bundles engine/ + shell/ -> dist/ (this session)
  package.json
  shell/             — auth, panel, fill-flow orchestration, content
                       scripts, background worker (this session,
                       `planning/session-prompts/42_v3c_e1_shell.md`)
  engine/            — pure DOM fill engine: survey, widget drivers,
                       read-back, L0 ATS maps (a parallel session,
                       `planning/session-prompts/41_v3c_e1_engine.md`)
```

`shell/` and `engine/` are independent standalone TS packages — each has
its own `package.json`/`tsconfig.json`/`vitest.config.ts` and never imports
from the other at the source level. `shell/` consumes `engine/`'s pinned
public API (`survey`/`planFills`/`executeFills`, see
`shell/src/engineApi.ts`) only through the bare specifier `"jobify-engine"`,
which `build.mjs` aliases to the real engine package at bundle time.

## Dev build

Requires both `extension/engine/` and `extension/shell/` present (i.e. this
branch merged with session 41's — until then, `npm run build` fails loudly
and tells you why).

```bash
cd extension
npm install
JOBIFY_SUPABASE_URL=https://<project>.supabase.co \
JOBIFY_SUPABASE_ANON_KEY=<anon key> \
JOBIFY_APP_ORIGIN=https://<your deployed app origin> \
  npm run build
```

This writes `extension/dist/` — bundled `background.js`, `content/
handoffRelay.js`, `content/atsFillBridge.js`, `panel.js` (+ sourcemaps),
`panel.html`, `panel.css`, and a `manifest.json` with `__APP_ORIGIN__`
substituted for the real origin you passed in `JOBIFY_APP_ORIGIN`.

`JOBIFY_SUPABASE_ANON_KEY` is the Supabase **anon** key — the same public
value every signed-out browser tab already receives via
`web/lib/supabase/browser.ts`. It is not a secret; RLS is the security
boundary, not key secrecy.

To iterate on `shell/` alone (types, auth state machine, ready-list
matching, fill-flow orchestration, panel view logic — everything except the
one content-script file that imports the real engine) without a full build:

```bash
cd extension/shell
npm install
npx vitest run
npx tsc --noEmit
```

## Load unpacked

1. Run the build above.
2. Chrome -> `chrome://extensions` -> enable **Developer mode** -> **Load
   unpacked** -> select `extension/dist/`.
3. Sign in to the jobify web app in a normal tab. The app emits a
   `jobify:auth-handoff` event on every page load / auth change
   (`web/components/extension/HandoffEmitter.tsx`); the extension's
   app-origin content script relays it to the background worker, which
   stores the session in `chrome.storage.session` (memory-backed — cleared
   when the browser fully quits, never written to `.local`) and refreshes
   it as needed via `supabase-js`.
4. Open the side panel (toolbar icon). Signed-out shows a **Sign in** deep
   link to the app; signed-in shows your tailored-and-ready postings,
   auto-highlighting one that matches the current tab's hostname.
5. Navigate to an application page for a highlighted (or manually picked)
   posting, click **Fill this page**, review the per-field checklist and
   any copyable handoff lines, then **submit the application yourself** —
   the extension never does this step.

### Pinned extension ID

`manifest.json`'s `key` field embeds a fixed RSA public key so
`chrome://extensions`'s load-unpacked ID is identical on every machine that
loads this exact `dist/` — the app-origin content script depends on that
stability for the handoff (`__APP_ORIGIN__` match pattern is independent of
the ID, but a stable ID matters for anything keyed to it later, e.g. a
future `externally_connectable` allowlist entry). Nobody needs the
corresponding private key for anything in this session — it was generated
once, the public half committed, and the private half discarded; regenerate
with `openssl genrsa 2048 | openssl rsa -pubout -outform DER | base64 -w0`
if a new ID is ever deliberately needed (this changes the ID for everyone —
don't do it casually).

## What this extension can never do (V3C_DESIGN.md §0)

- **No final submit.** It fills fields and operates widgets; it never
  clicks the button that files an application. In E1 specifically, it
  additionally does **no navigation between pages/steps at all** — the
  panel fills the current page only, full stop. Every result ends with:
  review the page and click Submit yourself.
- **No `chrome.debugger`.** Not in this manifest's permission set (audited
  by `shell/src/manifestAudit.test.ts`), and E1's engine never references
  it either (`extension/engine`'s own constitution tests).
- **No LLM provider keys or calls, ever.** `shell/src/constitution.test.ts`
  greps the whole `extension/` tree for the forbidden provider-name and
  key-variable tokens (see that file for the exact pattern — not repeated
  here so this README doesn't itself trip the grep) on every test run.
- **No network calls outside three destinations:** the app origin (packet,
  ready-list, and the handoff relay), the packet's short-lived signed
  Storage URLs (the two material PDFs), and Supabase's own auth endpoint
  for token refresh (`shell/src/auth/supabaseAuthClient.ts` — see that
  file's header for why refresh is read as compliant with "no fetch to any
  non-app origin", flagged there for reviewer sign-off).
