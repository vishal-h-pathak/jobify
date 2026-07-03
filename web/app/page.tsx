import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">jobify</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        You&apos;ve got an invite? Sign in and we&apos;ll walk you through a short interview to build your hunting
        profile.
      </p>
      <Link
        href="/login"
        className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:opacity-90"
      >
        Sign in
      </Link>
    </div>
  );
}
