# Shape of the prose profile files

The five markdown files in the profile contract have no machine schema — they
are free prose spliced into LLM prompts. This doc is their "shape": what each
must contain to be useful, and what the loader does with it. WS-E should
generate files that satisfy these; validation here is "loads + non-empty +
contains the expected structure," not strict parsing.

All five load via `jobify.profile_loader` and return `""` when missing (never
fatal). See `profile.example/` for a complete reference instance.

---

## `thesis.md` — `load_thesis()` → raw string

The **judgment** document: how the user decides whether a posting is worth
their time. Read **FIRST** by both the hunt scorer
(`build_profile_prompt_string`) and the tailor (`thesis_section`), with a
banner stating it overrides other profile prose on conflict.

Expected sections (markdown `##` headings, names flexible):
- a one-paragraph thesis,
- **hard constraints** (remote/comp/domain dealbreakers — these mirror the
  scorer's floor),
- **tiers** (what counts as Tier 1 vs lower),
- **energy signals** (JD language that's a strong positive / negative),
- optional **named-company anchors** (generalize from the *why*, not an
  allowlist),
- optional **tone notes** for downstream prompts.

Validity: non-empty; ideally starts with an `# ...` title so the banner reads
cleanly.

---

## `voice-profile.md` — `load_voice_profile()` → `{ raw, sections }`

How the user writes. The loader splits on top-level `## ` headings into a
kebab-cased `sections` dict and also returns the full `raw` text (the tailor's
cached system prefix uses `raw`).

Expected `## ` sections (the tailor benefits from these specific ones):
- **How He Communicates** — voice patterns,
- **What NOT to Do** — anti-patterns / banned phrasings,
- **What TO Do** — positive guidance,
- **Cover Letter Guidelines** — structure + length,
- **Resume Guidelines** — bullet style, do-not-fabricate rule.

Validity: non-empty; at least one `## ` heading so `sections` is populated.

---

## `article-digest.md` — `load_article_digest()` → raw string

Curated **claim → evidence** proof points the tailor + cover-letter prompts
pull from, plus the critical guardrail lists:
- **Metrics we are confident about** (safe to cite verbatim),
- **Metrics we DO NOT have (do not invent)** (the anti-fabrication fence).

Numbers here should stay consistent with `cv.md` (the `cv_sync_check.py` drift
detector compares anchored claims across both).

Validity: non-empty; should contain a "do not invent" guardrail section.

---

## `cv.md` — `load_cv()` → raw string

The master CV / source of truth for resume content (markdown). The tailor may
*select* and *reorder* from it but never invents beyond it. Conventional
sections: contact block, summary, technical skills, experience (reverse-
chronological with bullets), education, optional projects.

Validity: non-empty; contains the user's real experience the tailor can draw
from.

---

## `learned-insights.md` — `load_learned_insights()` → raw string

Generalizable preferences that accumulate over time, loaded **after**
`profile.yml` + `cv.md` so an insight here overrides earlier statements on
conflict. Ships intentionally near-empty in this single-user tool (the
dashboard's automatic writer is trimmed); maintained by hand if at all.

Validity: may be empty/placeholder — this is the one fully-optional file.
