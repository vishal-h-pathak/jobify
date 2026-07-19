/**
 * A field that only accepts a value change immediately preceded by a real
 * `keydown` — representative of masked/formatted-input libraries that
 * build their own state off keyboard events and revert anything that
 * looks like a bulk, non-typed write. `drivers.ts`'s native strategy
 * writes the whole value in one shot (one `input` event, no `keydown`
 * before it) and gets reverted here; the keystrokes strategy fires a real
 * keydown immediately before each character's `input` event, so it's
 * accepted one character at a time.
 */
export function mountKeystrokeOnlyInput(doc: Document, id: string): HTMLInputElement {
  doc.body.innerHTML = `<input id="${id}">`;
  const input = doc.getElementById(id) as HTMLInputElement;
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;

  let sawKeydown = false;
  let committed = "";
  input.addEventListener("keydown", () => {
    sawKeydown = true;
  });
  input.addEventListener("input", () => {
    if (sawKeydown) {
      committed = input.value;
    } else {
      setter.call(input, committed);
    }
    sawKeydown = false;
  });

  return input;
}
