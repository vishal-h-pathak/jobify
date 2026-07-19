# Session 40 — V3C-PACKET: application profile + submit packet (backend)  (V3c P0, parallel with 39)

**Model: Sonnet.** Spec = `planning/V3C_DESIGN.md` (v2.1) §5 + §8 — read FIRST.
This is the data half of V3c P0: the encrypted application profile and the
submit-packet endpoint that the kit (session 39) and later the extension
consume. **No UI in this session. No LLM calls in this session.**
**Branch:** `feat/v3c-packet` off main, worktree `jobify-wt/v3c-packet`.
**You own:** `jobify/migrations/0013_v3c_submit.sql` (+ its `README.md` entry),
`web/lib/crypto/**` (additive only — decrypt + JSON helpers beside the existing
BYO-key encrypt), `web/lib/submit/**` (new), `web/app/api/submit/**` (new),
`web/lib/supabase/types.ts` (additive), tests. Do NOT touch: any UI/components
(39's), `web/app/api/tailor/**`, `web/lib/tailor/**` behavior, `jobify/` Python,
onboarding/dossier/feed/admin.

## PINNED CONTRACT (shared verbatim with session 39 — implement EXACTLY)

```ts
// POST /api/submit/profile   body: ApplicationProfile → 204
// GET  /api/submit/profile   → 200 ApplicationProfile | 404 (never onboarded)
// GET  /api/submit/packet?posting_id=<id>
//   → 200 SubmitPacket
//   | 409 {error:"no_application_profile"}   (UI redirects to submitter setup)
//   | 404 {error:"no_materials"}             (no succeeded tailor run yet)

type ApplicationProfile = {
  contact: { phone?: string; location?: string; linkedin_url?: string;
             github_url?: string; portfolio_url?: string };
  authorization: { work_authorized?: "yes"|"no";
                   visa_sponsorship_needed?: "yes"|"no"; notes?: string };
  logistics: { notice_period?: string; earliest_start?: string;
               salary_expectation?: string };
  self_id: { gender?: string; race_ethnicity?: string;
             veteran_status?: string; disability_status?: string };
  updated_at?: string;  // set server-side on save; every field optional
};

type SubmitPacket = {
  posting: { id: string; title: string; company: string;
             application_url: string; ats_kind: string };
  identity: { first_name: string; last_name: string; full_name: string;
              email: string; phone: string; location: string; linkedin_url: string;
              github_url: string; portfolio_url: string };  // missing = "" (render-what-exists)
  materials: { resume_pdf_url: string; cover_letter_pdf_url: string;
               cover_letter_text: string };  // short-lived signed URLs
  authorization: ApplicationProfile["authorization"];
  logistics: ApplicationProfile["logistics"];
  self_id: ApplicationProfile["self_id"];
  meta: { tailor_run_id: string; doc_sha256: string | null; generated_at: string };
};
```

Identity keys deliberately mirror the single-user `build_field_map` labels
(`jobify/submit/adapters/prepare_dom/_common.py:188`) — the future extension
fills from these keys unchanged.

## Build

1. **Migration `0013_v3c_submit.sql`** — three tables per V3C_DESIGN §8.1, in
   the house style of `0012_v3b_tailor.sql` (idempotent; comment header citing
   the design doc): `application_profiles` (user_id PK → auth.users CASCADE,
   `encrypted_payload text NOT NULL` in the keycrypt `v1:<b64 nonce>:<b64
   ciphertext+tag>` wire format, `updated_at`; RLS **service-role only, NO
   authenticated policies on purpose** — client never touches ciphertext, no
   admin surface ever renders it; say so in SQL comments); `submit_events`
   (user_id, posting_id FKs, `source CHECK (source IN ('kit','extension'))`,
   `final_state text`, `pages int`, `field_outcomes jsonb DEFAULT '[]'` —
   labels/layers/outcomes only, NEVER filled values (comment it), `walls jsonb`,
   `advance_agreement jsonb`, `cost_usd numeric`, created_at; RLS own-row
   SELECT + service-role ALL); `learned_field_maps` (hostname, ats_kind,
   `field_signature text`, `mapping jsonb` — structure only NEVER values,
   `verified_count int DEFAULT 0`, `last_verified_at`, `UNIQUE (hostname,
   field_signature)`; RLS service-role only — served via API in E3). Nothing
   writes the last two yet — they lock the V3c schema now. Migrations README
   entry. **Do not apply to the live DB — the reviewer applies verbatim
   post-merge.**
2. **Crypto** — `web/lib/crypto/keys.ts` already encrypts BYO keys in the
   `v1:` AES-256-GCM wire format (Python twin: `jobify/hosted/keycrypt.py`).
   Add the decrypt counterpart + thin `encryptJson`/`decryptJson` wrappers
   (same format, same `JOBIFY_KEY_ENCRYPTION_SECRET`), additive beside the
   existing exports. Round-trip + tamper + wrong-secret tests.
3. **`web/lib/submit/applicationProfile.ts`** — load/save via the service
   client (table is service-role only): auth first, then encrypt/decrypt
   server-side. Zod-or-manual shape validation on save (strip unknown keys —
   nothing but the pinned shape is ever stored). Routes
   `web/app/api/submit/profile/route.ts` per the pinned contract.
4. **`web/lib/submit/atsDetect.ts`** — port the URL-rule detection from
   `jobify/shared/ats_detect.py` + the prepare_dom `detect()` patterns
   (greenhouse / lever / ashby / workday / icims / smartrecruiters / linkedin /
   generic). Pure function + table-driven tests. (Full aggregator URL
   *resolution* is explicitly deferred to E1 — packet ships the posting's
   stored URL.)
5. **`web/lib/submit/packet.ts` + `web/app/api/submit/packet/route.ts`** —
   auth → application profile (else 409) → latest **succeeded** `tailor_runs`
   row for `posting_id` (else 404) → posting row → identity assembly
   (name from the profile doc's identity — reuse the canonical accessor the
   dossier/tailor paths use, do NOT re-parse ad hoc; **email = auth email,
   ground truth** per the established rule; contact fields from the decrypted
   application profile) → signed URLs via `web/lib/materials/signMaterials.ts`
   (own-run verification exactly as the tailor materials route does) +
   `cover_letter_text` read from storage → `ats_kind` via atsDetect →
   `meta` from the run row. Every absent value is `""`, never invented.
6. **types.ts** — additive entries for all three 0013 tables.

## Tests
Profile round-trip (save→load), 404-before-first-save, unknown-key stripping,
encryption-at-rest asserted (raw row ≠ plaintext, decrypts back); packet: 409 /
404 / happy path (identity precedence: auth email wins; profile contact wins
over blanks), signed-URL scoping refuses another user's run — copy the refusal
matrix style from the tailor materials route tests; atsDetect table. Alex Quinn
persona everywhere. Full suites green.

## Exit criteria
Web vitest + tsc + build green; Python suite untouched + green; scrub gate
PASS; migration number is **0013** and nothing else; diff inside ownership.
Commit: `V3C-PACKET: application_profiles + 0013 + submit packet endpoint`.
Push; do NOT merge.
