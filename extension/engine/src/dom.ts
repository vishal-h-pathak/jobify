// Internal DOM traversal helpers shared by survey.ts and fill.ts. Not part of
// the package's public API (see index.ts / constitution.test.ts).

export const FIELD_ID_ATTR = "data-jf-id";

export function escapeCss(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/**
 * happy-dom (this package's test environment, see vitest.config.ts) doesn't
 * do real layout, so `getBoundingClientRect()`-based visibility (the
 * Python ancestor's approach) would report every element as zero-size and
 * hence "invisible". Use computed style instead — portable across a real
 * browser and this test environment alike. File inputs are exempt: ATSes
 * routinely hide them behind a styled dropzone (F4), and the Python
 * ancestor special-cased them the same way.
 */
export function isHiddenByStyle(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

export function isConsideredVisible(el: Element): boolean {
  const type = (el as HTMLInputElement).type;
  if (el.tagName === "INPUT" && type === "file") return true;
  return !isHiddenByStyle(el);
}

/** Every open shadow root reachable from `root` (root included implicitly by
 * the caller), found by walking the light DOM depth-first. Closed shadow
 * roots are invisible to `Element.shadowRoot` and so are silently skipped —
 * an honest, unavoidable limitation (§ survey fixtures note this). */
export function findShadowRoots(root: ParentNode): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const stack: ParentNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const children = node.querySelectorAll("*");
    for (const el of Array.from(children)) {
      const sr = (el as Element).shadowRoot;
      if (sr && !found.includes(sr)) {
        found.push(sr);
        stack.push(sr);
      }
    }
  }
  return found;
}

/** Same-origin iframes directly under `root` (not crossing into shadow
 * roots — no fixture in this package nests an iframe inside a shadow root,
 * and real ATS forms don't either). Cross-origin iframes throw on
 * `contentDocument` access; caught and skipped (F2 honest limitation). */
export function findAccessibleIframes(root: ParentNode): HTMLIFrameElement[] {
  const out: HTMLIFrameElement[] = [];
  for (const el of Array.from(root.querySelectorAll("iframe"))) {
    try {
      const doc = (el as HTMLIFrameElement).contentDocument;
      if (doc) out.push(el as HTMLIFrameElement);
    } catch {
      // cross-origin — skip
    }
  }
  return out;
}

/** Resolve a `field.frame` path ("" | "iframe0" | "iframe0/iframe1" | ...)
 * against the top `root` document, returning the Document that frame's
 * fields live in, or null if the path no longer resolves (frame removed/
 * navigated since survey()). */
export function resolveFrameDocument(root: Document, framePath: string): Document | null {
  if (!framePath) return root;
  let doc: Document = root;
  for (const token of framePath.split("/")) {
    const m = /^iframe(\d+)$/.exec(token);
    if (!m) return null;
    const index = Number(m[1]);
    const iframes = findAccessibleIframes(doc);
    const iframe = iframes[index];
    if (!iframe) return null;
    const next = iframe.contentDocument;
    if (!next) return null;
    doc = next;
  }
  return doc;
}

/** All live DOM elements tagged with `field.id` (one for most kinds, one per
 * radio for a `radio_group`), resolved through `field.frame`. */
export function findFieldElements(root: Document, field: { id: string; frame: string }): Element[] {
  const doc = resolveFrameDocument(root, field.frame);
  if (!doc) return [];
  return Array.from(doc.querySelectorAll(`[${FIELD_ID_ATTR}="${escapeCss(field.id)}"]`));
}
