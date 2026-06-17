/**
 * Skeletons — first-load placeholders. The register never shows a
 * page-level spinner; surfaces sketch their final shape in hairline
 * blocks (`.skeleton` in _internal.css — breathing opacity, static
 * under prefers-reduced-motion).
 */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className ?? ""}`} />;
}

/** A stack of row-shaped blocks (lists, queues, run ledgers). */
export function SkeletonRows({
  rows = 4,
  rowClassName = "h-16",
}: {
  rows?: number;
  rowClassName?: string;
}) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skeleton ${rowClassName}`} />
      ))}
    </div>
  );
}
