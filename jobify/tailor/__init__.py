"""jobify.tailor — the resume / cover-letter / form-answer half of the pipeline.

Module wiring is unusual here: the modules in this package use unprefixed
imports (``from prompts import ...``, ``from storage import ...``,
``from tailor.Y import ...``)
inherited from when this code lived in its own repo and ran with the
tailor directory as the working directory. ``jobify.tailor.pipeline`` bootstraps ``sys.path`` so those
intra-subtree imports resolve when the package is loaded via the
``jobify-tailor`` console script.

PR-9 rewrote the cross-cutting bare imports (``from config import ...``,
``from db import ...``, ``from notify import ...``) to package-qualified
paths against the canonical ``jobify.config`` / ``jobify.db`` /
``jobify.notify`` modules and removed the per-subtree shims they used
to resolve through. Tailor-only path constants (``OUTPUT_DIR``,
``CANDIDATE_PROFILE_PATH``) moved to ``jobify.tailor.paths``. The
bootstrap stays only for the remaining intra-subtree bare imports above;
a future PR can rewrite those to ``from jobify.tailor.tailor import
X`` etc. and remove it entirely.
"""
