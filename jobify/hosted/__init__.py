"""jobify.hosted — the hosted (multi-tenant) hunt worker (H4).

New in H4 Task 2: this package didn't exist before this task. It houses
the code that runs the hosted pipeline described in
``planning/HOSTED_AGGREGATOR_PLAN.md`` §3-4 and
``planning/session-prompts/13_h4_worker_ladder.md`` — discovery runs ONCE
globally into the shared ``postings`` pool, then per-user scoring fans out
via an increasingly expensive ladder (see ``docs/SCORING.md``).

Modules:
    - ``discovery`` — global, once-per-cycle posting discovery (Task 2).
      Unions every user's ``portals.yml`` boards, fetches each real
      posting exactly once via the existing ``jobify.hunt.sources``
      fetchers, resolves links, and upserts into ``postings``.
    - ``embed`` — Voyage embeddings for postings (global, computed once)
      and profiles (per-user) (Task 2).
    - ``fanout`` — per-user scoring ladder (Task 3; builds on the above).

Nothing here is imported by ``jobify.hunt`` / ``jobify.tailor`` /
``jobify.submit`` — the single-user pipeline is untouched by this
package's existence.
"""

from __future__ import annotations
