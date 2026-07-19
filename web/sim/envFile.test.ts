import { describe, expect, it } from "vitest";
import { parseEnvFile } from "./envFile";

describe("parseEnvFile", () => {
  it("parses simple KEY=VALUE lines", () => {
    expect(parseEnvFile("ANTHROPIC_API_KEY=sk-ant-abc123\nFOO=bar")).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-abc123",
      FOO: "bar",
    });
  });

  it("skips blank lines and full-line comments", () => {
    expect(parseEnvFile("# a comment\n\nFOO=bar\n  # indented comment\n")).toEqual({ FOO: "bar" });
  });

  it("strips matching single or double quotes around the value", () => {
    expect(parseEnvFile('FOO="bar baz"\nQUUX=\'single\'')).toEqual({ FOO: "bar baz", QUUX: "single" });
  });

  it("keeps everything after the first '=' when the value itself contains one", () => {
    expect(parseEnvFile("FOO=a=b=c")).toEqual({ FOO: "a=b=c" });
  });

  it("allows an empty value", () => {
    expect(parseEnvFile("FOO=")).toEqual({ FOO: "" });
  });

  it("ignores a malformed line with no '='", () => {
    expect(parseEnvFile("not a valid line\nFOO=bar")).toEqual({ FOO: "bar" });
  });
});
