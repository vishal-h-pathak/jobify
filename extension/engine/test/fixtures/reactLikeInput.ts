/**
 * Simulates React's actual controlled-input mechanism (not a caricature of
 * it) without pulling in React: React installs an instance-level property
 * descriptor for `value` that shadows `HTMLInputElement.prototype`'s
 * accessor, so a plain `el.value = x` resolves to React's own setter
 * (which here just ignores the write, standing in for "state didn't
 * change, so the next render puts the old value back"). Calling the
 * PROTOTYPE's setter function directly — `desc.set!.call(el, x)`, which is
 * exactly what `drivers.ts`'s native-setter write does — never goes
 * through property resolution on the instance and so bypasses the shadow
 * entirely. This is the real mechanism F3 refers to, reproduced faithfully.
 */
export function mountReactLikeControlledInput(doc: Document, id: string, initialValue: string): HTMLInputElement {
  doc.body.innerHTML = `<input id="${id}" value="${initialValue}">`;
  const input = doc.getElementById(id) as HTMLInputElement;
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const desc = Object.getOwnPropertyDescriptor(proto, "value")!;
  Object.defineProperty(input, "value", {
    configurable: true,
    get(this: HTMLInputElement) {
      return desc.get!.call(this);
    },
    set(this: HTMLInputElement) {
      // React's controlled input: a write that didn't go through the
      // tracked native setter is dropped — the committed value never
      // changes.
    },
  });
  return input;
}
