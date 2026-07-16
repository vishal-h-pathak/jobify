import { describe, expect, it, vi } from "vitest";
import type { MetricClaim } from "@/lib/onboarding/moduleWriters/metrics";
import {
  buildMarksPayload,
  fetchMetricClaims,
  initialMetricsState,
  MetricsMarkingView,
  metricsCanSubmit,
  metricsReducer,
  submitMetricMarks,
  type MetricClaimRow,
} from "./MetricsPanel";

const CLAIMS: MetricClaim[] = [
  { id: "c1", text: "Cut onboarding time 40%", source: "cv", has_number: true },
  { id: "c2", text: "Led a team of 6", source: "range", has_number: true },
];

function noop() {
  /* unused callback slot */
}

describe("metricsReducer", () => {
  it("claims_loaded seeds every row with mark: null — nothing pre-selected", () => {
    const state = metricsReducer(initialMetricsState(), { type: "claims_loaded", claims: CLAIMS });
    expect(state.phase).toBe("marking");
    expect(state.rows).toEqual([
      { ...CLAIMS[0], mark: null },
      { ...CLAIMS[1], mark: null },
    ]);
  });

  it("claims_loaded with zero claims still moves to marking with an empty rows array", () => {
    const state = metricsReducer(initialMetricsState(), { type: "claims_loaded", claims: [] });
    expect(state.phase).toBe("marking");
    expect(state.rows).toEqual([]);
  });

  it("extract_failed moves to the error phase", () => {
    const state = metricsReducer(initialMetricsState(), { type: "extract_failed", error: "model overloaded" });
    expect(state.phase).toBe("error");
    expect(state.error).toBe("model overloaded");
  });

  it("extract_retried resets back to extracting and bumps the reload token", () => {
    const errored = metricsReducer(initialMetricsState(), { type: "extract_failed", error: "x" });
    const retried = metricsReducer(errored, { type: "extract_retried" });
    expect(retried.phase).toBe("extracting");
    expect(retried.reloadToken).toBe(1);
  });

  it("mark_set updates only the targeted row", () => {
    let state = metricsReducer(initialMetricsState(), { type: "claims_loaded", claims: CLAIMS });
    state = metricsReducer(state, { type: "mark_set", id: "c1", mark: "confident" });
    expect(state.rows.find((r) => r.id === "c1")?.mark).toBe("confident");
    expect(state.rows.find((r) => r.id === "c2")?.mark).toBeNull();
  });

  it("mark_all_confident marks every row confident in one action, individually overridable after", () => {
    let state = metricsReducer(initialMetricsState(), { type: "claims_loaded", claims: CLAIMS });
    state = metricsReducer(state, { type: "mark_all_confident" });
    expect(state.rows.every((r) => r.mark === "confident")).toBe(true);
    state = metricsReducer(state, { type: "mark_set", id: "c2", mark: "dont_use" });
    expect(state.rows.find((r) => r.id === "c1")?.mark).toBe("confident");
    expect(state.rows.find((r) => r.id === "c2")?.mark).toBe("dont_use");
  });

  it("submit_failed returns to marking (not error) without losing marks", () => {
    let state = metricsReducer(initialMetricsState(), { type: "claims_loaded", claims: CLAIMS });
    state = metricsReducer(state, { type: "mark_set", id: "c1", mark: "confident" });
    state = metricsReducer(state, { type: "mark_set", id: "c2", mark: "confident" });
    state = metricsReducer(state, { type: "submit_started" });
    state = metricsReducer(state, { type: "submit_failed", error: "network down" });
    expect(state.phase).toBe("marking");
    expect(state.error).toBe("network down");
    expect(state.rows.every((r) => r.mark === "confident")).toBe(true);
  });

  it("submit_succeeded moves to finished", () => {
    const state = metricsReducer(initialMetricsState(), { type: "submit_succeeded" });
    expect(state.phase).toBe("finished");
  });
});

describe("metricsCanSubmit", () => {
  it("false while any row is unmarked", () => {
    let state = metricsReducer(initialMetricsState(), { type: "claims_loaded", claims: CLAIMS });
    expect(metricsCanSubmit(state)).toBe(false);
    state = metricsReducer(state, { type: "mark_set", id: "c1", mark: "confident" });
    expect(metricsCanSubmit(state)).toBe(false);
  });

  it("true once every row carries an explicit mark, even 'dont_use'", () => {
    let state = metricsReducer(initialMetricsState(), { type: "claims_loaded", claims: CLAIMS });
    state = metricsReducer(state, { type: "mark_set", id: "c1", mark: "confident" });
    state = metricsReducer(state, { type: "mark_set", id: "c2", mark: "dont_use" });
    expect(metricsCanSubmit(state)).toBe(true);
  });

  it("vacuously true for a zero-claims extraction — the skip-ahead path", () => {
    const state = metricsReducer(initialMetricsState(), { type: "claims_loaded", claims: [] });
    expect(metricsCanSubmit(state)).toBe(true);
  });

  it("false outside the marking phase (e.g. mid-extract or mid-submit)", () => {
    expect(metricsCanSubmit(initialMetricsState())).toBe(false);
  });
});

describe("buildMarksPayload", () => {
  it("maps confident rows to confident: true and everything else to confident: false", () => {
    const rows: MetricClaimRow[] = [
      { ...CLAIMS[0], mark: "confident" },
      { ...CLAIMS[1], mark: "dont_use" },
    ];
    expect(buildMarksPayload(rows)).toEqual([
      { id: "c1", confident: true },
      { id: "c2", confident: false },
    ]);
  });

  it("empty rows -> empty payload (the zero-claims path still POSTs marks: [])", () => {
    expect(buildMarksPayload([])).toEqual([]);
  });
});

describe("fetchMetricClaims", () => {
  it("POSTs with no body and returns the claims array", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ claims: CLAIMS }) }));
    const claims = await fetchMetricClaims(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/api/onboarding/modules/metrics/extract", { method: "POST" });
    expect(claims).toEqual(CLAIMS);
  });

  it("rejects on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(fetchMetricClaims(fetchImpl as unknown as typeof fetch)).rejects.toThrow("failed to extract metric claims");
  });
});

describe("submitMetricMarks", () => {
  it("POSTs {marks} built from the rows", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "metrics", receipt: "1 confirmed · 1 held back" }) }));
    const rows: MetricClaimRow[] = [
      { ...CLAIMS[0], mark: "confident" },
      { ...CLAIMS[1], mark: "dont_use" },
    ];
    await submitMetricMarks(rows, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/metrics",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          marks: [
            { id: "c1", confident: true },
            { id: "c2", confident: false },
          ],
        }),
      })
    );
  });

  it("empty rows still POSTs marks: []", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "metrics", receipt: "0 confirmed · 0 held back" }) }));
    await submitMetricMarks([], fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/metrics",
      expect.objectContaining({ body: JSON.stringify({ marks: [] }) })
    );
  });
});

describe("MetricsMarkingView — submit stays disabled until every row is explicitly marked", () => {
  it("disabled with claims present and none marked", () => {
    const rows: MetricClaimRow[] = [{ ...CLAIMS[0], mark: null }, { ...CLAIMS[1], mark: null }];
    const view = MetricsMarkingView({
      rows,
      canSubmit: false,
      submitting: false,
      error: null,
      onMark: noop,
      onMarkAllConfident: noop,
      onSubmit: noop,
    });
    const submitButton = view.props.children[view.props.children.length - 1];
    expect(submitButton.props.disabled).toBe(true);
  });

  it("enabled once canSubmit is true (caller has confirmed every row is marked)", () => {
    const rows: MetricClaimRow[] = [{ ...CLAIMS[0], mark: "confident" }, { ...CLAIMS[1], mark: "dont_use" }];
    const view = MetricsMarkingView({
      rows,
      canSubmit: true,
      submitting: false,
      error: null,
      onMark: noop,
      onMarkAllConfident: noop,
      onSubmit: noop,
    });
    const submitButton = view.props.children[view.props.children.length - 1];
    expect(submitButton.props.disabled).toBe(false);
  });

  it("renders exactly one ClaimRow per row, each with a source badge and both mark buttons", () => {
    const rows: MetricClaimRow[] = [{ ...CLAIMS[0], mark: null }];
    const view = MetricsMarkingView({
      rows,
      canSubmit: false,
      submitting: false,
      error: null,
      onMark: noop,
      onMarkAllConfident: noop,
      onSubmit: noop,
    });
    const rowsList = view.props.children[1];
    expect(rowsList.props.children).toHaveLength(1);
  });

  it("zero rows: renders the skip-ahead message and Continue button, not the per-row UI", () => {
    const view = MetricsMarkingView({
      rows: [],
      canSubmit: true,
      submitting: false,
      error: null,
      onMark: noop,
      onMarkAllConfident: noop,
      onSubmit: noop,
    });
    const children = view.props.children as unknown[];
    const message = children[0] as { props: { children: string } };
    const button = children[children.length - 1] as { props: { disabled: boolean; children: string } };
    expect(message.props.children).toBe("Nothing to mark — moving on.");
    expect(button.props.disabled).toBe(false);
    expect(button.props.children).toBe("Continue");
  });
});
