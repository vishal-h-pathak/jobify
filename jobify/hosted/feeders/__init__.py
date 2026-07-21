"""jobify.hosted.feeders — the three candidate-discovery feeders (HUNT2 P2
S4, planning/HUNT2_SOURCES.md §4.2). Each feeder is a pure, side-effect-free
function returning a list of `jobify.hosted.candidates.enqueue`-shaped
items; `jobify.hosted.worker` concatenates all three and hands the batch
to `jobify.hosted.candidates.run_candidates_cycle`, which owns every
actual write (dedup, probe, auto-admit, volume rails)."""
