import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface CheckpointInterstitialProps {
  /** modules.checkpoint_hunt truthy on the dealbreakers POST response — branched on HONESTLY, never assumed. */
  fired: boolean;
  matchCount: number;
  onContinue: () => void;
}

/**
 * V3A_DESIGN.md §1.6 — a full-panel product beat, not a toast, at the end of
 * phase 1. One of the two sanctioned emotional-beat animations lives beside
 * this (the PhaseRail sweep-and-settle, driven by the parent panel via
 * `<PhaseRail sweeping />` while this is mounted — this component owns only
 * the copy/layout, not the rail).
 */
export function CheckpointInterstitial({ fired, matchCount, onContinue }: CheckpointInterstitialProps) {
  return (
    <div className="amber-radial-glow panel-enter flex flex-col gap-4 py-8">
      <h2 className="text-3xl tracking-tight text-ink">
        {fired ? "Your first hunt just left." : "Phase one done."}
      </h2>
      <p className="max-w-prose text-lg text-ink-muted">
        {fired
          ? "Phase one is enough to hunt with, so we sent it. Results will be waiting when you're done — and everything you answer from here re-shapes them before you ever see the list."
          : "Depth next — about 10 minutes."}
      </p>
      {fired && matchCount > 0 && (
        <div>
          <Badge tone="amber">{matchCount} matches waiting</Badge>
        </div>
      )}
      <div>
        <Button variant="primary" onClick={onContinue}>
          Keep going — Depth, about 10 minutes.
        </Button>
      </div>
    </div>
  );
}
