"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { switchAccountHref } from "@/lib/auth/switchAccountHref";

/**
 * Signs out the current session and lands back on /login (preserving
 * `next`) so a different account can sign in — the one control every
 * gated, signed-in-but-not-you state (login's already-authed branch, the
 * invite wall) shares.
 */
export function SwitchAccountButton({
  next,
  children = "Switch account",
}: {
  next: string | null;
  children?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = switchAccountHref(next);
  }

  return (
    <Button variant="ghost" busy={busy} onClick={handleClick}>
      {children}
    </Button>
  );
}
