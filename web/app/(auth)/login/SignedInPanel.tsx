import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { BUTTON_VARIANT_CLASSES } from "@/components/ui/Button";
import { SwitchAccountButton } from "@/components/auth/SwitchAccountButton";

/**
 * /login when the visitor is already authenticated: no silent bounce — show
 * who they're signed in as (this is what would have saved an hour lost to
 * an unnoticed stale Google session) with an explicit choice to continue or
 * switch accounts.
 */
export function SignedInPanel({
  email,
  continueTarget,
  next,
}: {
  email: string;
  continueTarget: string;
  next: string | null;
}) {
  return (
    <Card className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">You&apos;re signed in</h1>
        <p className="text-sm text-ink-muted">
          as <span className="text-ink">{email}</span>
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Link
          href={continueTarget}
          className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${BUTTON_VARIANT_CLASSES.primary}`}
        >
          Continue
        </Link>
        <SwitchAccountButton next={next}>Use a different account</SwitchAccountButton>
      </div>
    </Card>
  );
}
