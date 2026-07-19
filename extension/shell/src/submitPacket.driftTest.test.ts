import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// This package cannot import from `web/` (constitution: the extension is a
// standalone artifact). So this test proves byte-for-byte parity the only
// way available to a standalone package: read both source files as text,
// extract the `SubmitPacket` type block from each, normalize whitespace, and
// diff. Any drift in the canonical `web/lib/submit/types.ts` `SubmitPacket`
// shape that isn't mirrored here fails this test.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_PATH = path.resolve(HERE, "../../../web/lib/submit/types.ts");
const LOCAL_PATH = path.resolve(HERE, "engineTypes.ts");

function extractSubmitPacketBlock(source: string): string {
  const startMarker = "export type SubmitPacket = {";
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`SubmitPacket block not found`);
  let depth = 0;
  let i = start + startMarker.length - 1; // sit on the opening brace
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const semicolon = source.indexOf(";", i);
  if (semicolon === -1) throw new Error("SubmitPacket block missing closing ';'");
  return source.slice(start, semicolon + 1);
}

function normalize(block: string): string {
  return block.replace(/\s+/g, " ").trim();
}

describe("SubmitPacket drift test", () => {
  it("stays byte-identical (modulo whitespace) to web/lib/submit/types.ts's SubmitPacket", () => {
    const canonical = normalize(extractSubmitPacketBlock(readFileSync(CANONICAL_PATH, "utf8")));
    const local = normalize(extractSubmitPacketBlock(readFileSync(LOCAL_PATH, "utf8")));
    expect(local).toBe(canonical);
  });
});
