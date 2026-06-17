"use client";

/**
 * useOptimisticAction — the dashboard's single mutate-action lifecycle.
 *
 * Every button that writes goes through run():
 *
 *   run("approve:job-123", {
 *     optimistic: () => { applyLocalChange(); return rollbackFn; },
 *     perform: () => requestJSON("PATCH", url, body),
 *     errorLabel: "Approve",
 *   })
 *
 * Lifecycle: the optimistic update lands synchronously (UI reacts within
 * the same frame), the key is marked pending while the request flies,
 * and on failure the rollback runs and a red toast explains why. On
 * success the key "flashes" for ~1.2s so rows/buttons can render a
 * confirmation tick.
 *
 * Keys are per-action strings (`${verb}:${rowId}`), so one hook instance
 * can track any number of concurrent row-level actions.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../components/Toast";

type RunOptions<T> = {
  /** Apply local state now; return the function that undoes it. */
  optimistic?: () => () => void;
  /** The server write. Reject/throw → rollback + error toast. */
  perform: () => Promise<T>;
  /** Action name for the failure toast, e.g. "Approve". */
  errorLabel?: string;
  /** Toast on success — only for results the user can't see in place. */
  successToast?: string;
  onSuccess?: (result: T) => void;
  onError?: (message: string) => void;
};

const FLASH_MS = 1200;

export function useOptimisticAction() {
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [flashKeys, setFlashKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const timers = useRef<Map<string, number>>(new Map());
  const toast = useToast();

  useEffect(() => {
    const m = timers.current;
    return () => {
      for (const t of m.values()) window.clearTimeout(t);
      m.clear();
    };
  }, []);

  const setKey = (
    setter: typeof setPendingKeys,
    key: string,
    present: boolean,
  ) => {
    setter((prev) => {
      if (prev.has(key) === present) return prev;
      const next = new Set(prev);
      if (present) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const run = useCallback(
    async <T,>(key: string, opts: RunOptions<T>): Promise<T | null> => {
      if (pendingKeys.has(key)) return null;
      const rollback = opts.optimistic?.();
      setKey(setPendingKeys, key, true);
      try {
        const result = await opts.perform();
        setKey(setFlashKeys, key, true);
        const t = window.setTimeout(() => {
          setKey(setFlashKeys, key, false);
          timers.current.delete(key);
        }, FLASH_MS);
        timers.current.set(key, t);
        if (opts.successToast) toast.push("ok", opts.successToast);
        opts.onSuccess?.(result);
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        rollback?.();
        toast.push(
          "error",
          opts.errorLabel ? `${opts.errorLabel} failed — ${message}` : message,
        );
        opts.onError?.(message);
        return null;
      } finally {
        setKey(setPendingKeys, key, false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingKeys, toast],
  );

  const isPending = useCallback(
    (key: string) => pendingKeys.has(key),
    [pendingKeys],
  );
  const isFlashing = useCallback(
    (key: string) => flashKeys.has(key),
    [flashKeys],
  );
  /** True when any key with the given prefix is pending (row-level checks). */
  const anyPending = useCallback(
    (prefix?: string) =>
      prefix
        ? [...pendingKeys].some((k) => k.startsWith(prefix))
        : pendingKeys.size > 0,
    [pendingKeys],
  );

  return { run, isPending, isFlashing, anyPending };
}
