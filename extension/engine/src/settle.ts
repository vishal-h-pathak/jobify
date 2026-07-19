// settle.ts — MutationObserver-based quiescence helper (F1: dynamic renders
// beat load-state heuristics). Resolves once no mutations fire for
// `quietMs`, bounded by `maxWaitMs` so a page that never quiets down (some
// background poller, an animated spinner) can't hang a fill/read-back pass
// forever. Never a global load-state wait.

export function settle(root: Node, opts?: { quietMs?: number; maxWaitMs?: number }): Promise<void> {
  const quietMs = opts?.quietMs ?? 300;
  const maxWaitMs = opts?.maxWaitMs ?? 3000;
  const doc = root.ownerDocument ?? (root as Document);
  const view = doc.defaultView ?? globalThis;

  return new Promise((resolve) => {
    let done = false;
    let quietTimer: ReturnType<typeof setTimeout>;

    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      resolve();
    };

    const observer = new view.MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });

    quietTimer = setTimeout(finish, quietMs);
    const maxTimer = setTimeout(finish, maxWaitMs);
  });
}
