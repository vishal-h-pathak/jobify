// Stub — the feed UI (scored postings, save/dismiss/applied) is H5. This
// route exists so the onboarding chat has somewhere to send a finished
// user; it's intentionally not wired to `matches`/`postings` yet.
export default function FeedPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Your feed</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Your profile is built. Scored postings will show up here once the daily discovery run is live — coming in
        H5.
      </p>
    </div>
  );
}
