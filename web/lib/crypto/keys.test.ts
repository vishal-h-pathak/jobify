import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptJson, decryptKey, encryptJson, encryptKey, last4 } from "./keys";

const TEST_SECRET_B64 = Buffer.alloc(32, 1).toString("base64");

describe("keys crypto (H6 BYO keys)", () => {
  beforeEach(() => {
    vi.stubEnv("JOBIFY_KEY_ENCRYPTION_SECRET", TEST_SECRET_B64);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a plaintext key", () => {
    const blob = encryptKey("sk-ant-api03-roundtrip-test-key");
    expect(decryptKey(blob)).toBe("sk-ant-api03-roundtrip-test-key");
  });

  it("produces the v1:<nonce>:<ciphertext> wire format", () => {
    const blob = encryptKey("sk-ant-api03-format-test");
    const parts = blob.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("v1");
  });

  it("uses a fresh random nonce every call (two encryptions of the same plaintext differ)", () => {
    const a = encryptKey("sk-ant-api03-same-plaintext");
    const b = encryptKey("sk-ant-api03-same-plaintext");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt under a different secret", () => {
    const blob = encryptKey("sk-ant-api03-wrong-secret-test");
    vi.stubEnv("JOBIFY_KEY_ENCRYPTION_SECRET", Buffer.alloc(32, 2).toString("base64"));
    expect(() => decryptKey(blob)).toThrow();
  });

  it("fails on tampered ciphertext", () => {
    const blob = encryptKey("sk-ant-api03-tamper-test");
    const [version, nonceB64, ctB64] = blob.split(":");
    const ct = Buffer.from(ctB64, "base64");
    ct[0] ^= 0xff;
    const tampered = `${version}:${nonceB64}:${ct.toString("base64")}`;
    expect(() => decryptKey(tampered)).toThrow();
  });

  it("rejects an unrecognized wire format", () => {
    expect(() => decryptKey("not-a-valid-blob")).toThrow(/wire format/);
  });

  it("throws when the secret env var is unset", () => {
    vi.stubEnv("JOBIFY_KEY_ENCRYPTION_SECRET", "");
    expect(() => encryptKey("sk-ant-api03-no-secret")).toThrow(/JOBIFY_KEY_ENCRYPTION_SECRET/);
  });

  it("last4 returns the last four characters, for the settings UI's display", () => {
    expect(last4("sk-ant-api03-abcd1234")).toBe("1234");
  });
});

describe("encryptJson/decryptJson (V3c application profiles)", () => {
  beforeEach(() => {
    vi.stubEnv("JOBIFY_KEY_ENCRYPTION_SECRET", TEST_SECRET_B64);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const sample = {
    contact: {
      phone: "555-0100",
      location: "Remote",
      linkedin_url: "https://linkedin.example/in/alexquinn",
    },
    authorization: { work_authorized: "yes" as const },
    logistics: { notice_period: "2 weeks" },
  };

  it("round-trips a nested object unchanged", () => {
    const blob = encryptJson(sample);
    expect(decryptJson(blob)).toEqual(sample);
  });

  it("produces the v1:<nonce>:<ciphertext> wire format", () => {
    const blob = encryptJson(sample);
    const parts = blob.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("v1");
  });

  it("fails to decrypt under a different secret", () => {
    const blob = encryptJson(sample);
    vi.stubEnv("JOBIFY_KEY_ENCRYPTION_SECRET", Buffer.alloc(32, 2).toString("base64"));
    expect(() => decryptJson(blob)).toThrow();
  });

  it("fails on tampered ciphertext", () => {
    const blob = encryptJson(sample);
    const [version, nonceB64, ctB64] = blob.split(":");
    const ct = Buffer.from(ctB64, "base64");
    ct[0] ^= 0xff;
    const tampered = `${version}:${nonceB64}:${ct.toString("base64")}`;
    expect(() => decryptJson(tampered)).toThrow();
  });
});
