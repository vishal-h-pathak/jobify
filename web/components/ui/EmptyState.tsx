/** Icon-free empty state: one short heading, one secondary line. */
export function EmptyState({
  heading,
  message,
  className = "",
}: {
  heading: string;
  message: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-1 py-12 text-center ${className}`}>
      <p className="text-lg font-semibold text-ink">{heading}</p>
      <p className="text-sm text-ink-muted">{message}</p>
    </div>
  );
}
