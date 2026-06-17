/**
 * /dashboard/login — register gate. Same chrome as the rest of the
 * dashboard (dark, mono, hairlines); no nav since nothing behind the
 * gate should leak. Server component — the form posts to the login
 * route and middleware handles the redirect.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const error = searchParams?.error;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        method="POST"
        action="/api/dashboard-login"
        className="flex w-full max-w-xs flex-col gap-3 border border-rule bg-bg-raised p-6"
      >
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-green" />
          Job pipeline — restricted
        </div>
        <h1 className="font-serif text-xl tracking-tight text-ink">Dashboard</h1>
        <label htmlFor="dashboard-password" className="sr-only">
          Password
        </label>
        <input
          id="dashboard-password"
          type="password"
          name="password"
          placeholder="password"
          autoFocus
          className="border border-rule bg-bg px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          className="border border-amber px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-amber transition-colors duration-150 hover:bg-amber hover:text-bg active:duration-0"
        >
          sign in
        </button>
        {error ? (
          <p className="m-0 text-xs text-red">Incorrect password.</p>
        ) : null}
      </form>
    </main>
  );
}
