import { describe, expect, it } from "vitest";
import { buildLogisticsPatchBody, initialLogisticsForm, submitLogisticsPatch } from "./LogisticsEditor";

describe("initialLogisticsForm", () => {
  it("seeds the form from derived facts.logistics, defaulting nulls to blank/false", () => {
    expect(
      initialLogisticsForm({ base: null, remoteAcceptable: null, relocation: null, currentCompUsd: null, targetCompUsd: null })
    ).toEqual({ base: "", remoteAcceptable: false, targetCompUsd: "" });
  });

  it("carries over existing values", () => {
    expect(
      initialLogisticsForm({
        base: "Atlanta, GA",
        remoteAcceptable: true,
        relocation: "no",
        currentCompUsd: 165000,
        targetCompUsd: "180000+",
      })
    ).toEqual({ base: "Atlanta, GA", remoteAcceptable: true, targetCompUsd: "180000+" });
  });
});

describe("buildLogisticsPatchBody", () => {
  it("trims blank typed fields out of the body but always sends the remote checkbox", () => {
    expect(buildLogisticsPatchBody({ base: "  ", remoteAcceptable: false, targetCompUsd: "  " })).toEqual({
      remote_acceptable: false,
    });
  });

  it("includes trimmed typed values", () => {
    expect(buildLogisticsPatchBody({ base: " Atlanta, GA ", remoteAcceptable: true, targetCompUsd: " 180000+ " })).toEqual({
      base: "Atlanta, GA",
      remote_acceptable: true,
      target_comp_usd: "180000+",
    });
  });
});

describe("submitLogisticsPatch", () => {
  it("PATCHes /api/profile with the given body and returns ok on success", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const result = await submitLogisticsPatch({ base: "Atlanta, GA" }, fakeFetch);

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/profile");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ base: "Atlanta, GA" });
  });

  it("surfaces the server's error message on failure", async () => {
    const fakeFetch = (async () =>
      ({ ok: false, json: async () => ({ error: "Not authorized" }) }) as Response) as typeof fetch;

    const result = await submitLogisticsPatch({ base: "Atlanta, GA" }, fakeFetch);

    expect(result).toEqual({ ok: false, error: "Not authorized" });
  });

  it("falls back to a generic error when the server sends no error body", async () => {
    const fakeFetch = (async () => ({ ok: false, json: async () => ({}) }) as Response) as typeof fetch;

    const result = await submitLogisticsPatch({ base: "Atlanta, GA" }, fakeFetch);

    expect(result).toEqual({ ok: false, error: "Could not save your changes." });
  });
});
