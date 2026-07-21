import { describe, expect, it } from "vitest";
import {
  approveCandidate,
  listPendingCandidates,
  listRecentAutoAdmittedCandidates,
  rejectCandidate,
} from "./candidates";

function fakeAdmin(opts: { candidateRow?: unknown; listData?: unknown[] } = {}) {
  const candidateUpdateCalls: unknown[] = [];
  const catalogUpsertCalls: unknown[] = [];

  const candidateBoardsTable: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    candidateBoardsTable[method] = () => candidateBoardsTable;
  }
  candidateBoardsTable.then = (resolve: (v: unknown) => void) =>
    resolve({ data: opts.listData ?? [], error: null });
  candidateBoardsTable.maybeSingle = () => Promise.resolve({ data: opts.candidateRow ?? null, error: null });
  candidateBoardsTable.update = (payload: unknown) => {
    candidateUpdateCalls.push(payload);
    return { eq: () => Promise.resolve({ error: null }) };
  };

  const boardCatalogTable = {
    upsert: (payload: unknown) => {
      catalogUpsertCalls.push(payload);
      return Promise.resolve({ error: null });
    },
  };

  const admin = {
    from: (table: string) => {
      if (table === "candidate_boards") return candidateBoardsTable;
      if (table === "board_catalog") return boardCatalogTable;
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin: admin as never, candidateUpdateCalls, catalogUpsertCalls };
}

describe("listPendingCandidates / listRecentAutoAdmittedCandidates", () => {
  const row = {
    id: "c1",
    company_name: "Acme Corp",
    normalized_name: "acme corp",
    evidence_kind: "hn_thread",
    evidence_url: "https://news.ycombinator.com/item?id=1",
    proposed_ats: "greenhouse",
    proposed_slug: "acme-corp",
    probe_result: { found: true, confidence: 0.9 },
    status: "pending",
    reject_reason: null,
    created_at: "2026-07-20T00:00:00Z",
    decided_at: null,
  };

  it("maps candidate_boards rows to camelCase view objects", async () => {
    const { admin } = fakeAdmin({ listData: [row] });
    const result = await listPendingCandidates(admin as never);
    expect(result).toEqual([{
      id: "c1",
      companyName: "Acme Corp",
      evidenceKind: "hn_thread",
      evidenceUrl: "https://news.ycombinator.com/item?id=1",
      proposedAts: "greenhouse",
      proposedSlug: "acme-corp",
      probeResult: { found: true, confidence: 0.9 },
      status: "pending",
      rejectReason: null,
      createdAt: "2026-07-20T00:00:00Z",
      decidedAt: null,
    }]);
  });

  it("returns an empty list when nothing matches", async () => {
    const { admin } = fakeAdmin({ listData: [] });
    expect(await listRecentAutoAdmittedCandidates(admin as never)).toEqual([]);
  });
});

describe("approveCandidate", () => {
  it("returns not_found when the candidate doesn't exist", async () => {
    const { admin } = fakeAdmin({ candidateRow: null });
    expect(await approveCandidate(admin as never, "missing")).toEqual({ kind: "not_found" });
  });

  it("returns not_pending when the candidate was already decided", async () => {
    const { admin } = fakeAdmin({ candidateRow: { status: "rejected", proposed_ats: "lever", proposed_slug: "acme" } });
    expect(await approveCandidate(admin as never, "c1")).toEqual({ kind: "not_pending" });
  });

  it("returns missing_board_info when the probe never resolved a board", async () => {
    const { admin, catalogUpsertCalls } = fakeAdmin({
      candidateRow: { status: "pending", proposed_ats: null, proposed_slug: null },
    });
    const result = await approveCandidate(admin as never, "c1");
    expect(result).toEqual({ kind: "missing_board_info" });
    expect(catalogUpsertCalls).toHaveLength(0);
  });

  it("upserts board_catalog and marks the candidate approved", async () => {
    const { admin, candidateUpdateCalls, catalogUpsertCalls } = fakeAdmin({
      candidateRow: {
        id: "c1", status: "pending", proposed_ats: "greenhouse", proposed_slug: "acme-corp",
        company_name: "Acme Corp",
      },
    });

    const result = await approveCandidate(admin as never, "c1");

    expect(result).toEqual({ kind: "ok" });
    expect(catalogUpsertCalls).toHaveLength(1);
    const catalogPayload = catalogUpsertCalls[0] as Record<string, unknown>;
    expect(catalogPayload).toMatchObject({
      ats: "greenhouse", slug: "acme-corp", company_name: "Acme Corp",
      tags: [], status: "active", added_by: "admin",
    });
    expect(candidateUpdateCalls).toHaveLength(1);
    expect(candidateUpdateCalls[0]).toMatchObject({ status: "approved" });
  });
});

describe("rejectCandidate", () => {
  it("returns not_found when the candidate doesn't exist", async () => {
    const { admin } = fakeAdmin({ candidateRow: null });
    expect(await rejectCandidate(admin as never, "missing", "spam")).toEqual({ kind: "not_found" });
  });

  it("returns not_pending when already decided", async () => {
    const { admin } = fakeAdmin({ candidateRow: { status: "approved" } });
    expect(await rejectCandidate(admin as never, "c1", "spam")).toEqual({ kind: "not_pending" });
  });

  it("records the reject reason and marks the candidate rejected", async () => {
    const { admin, candidateUpdateCalls } = fakeAdmin({ candidateRow: { status: "pending" } });

    const result = await rejectCandidate(admin as never, "c1", "not a real company");

    expect(result).toEqual({ kind: "ok" });
    expect(candidateUpdateCalls[0]).toMatchObject({ status: "rejected", reject_reason: "not a real company" });
  });

  it("stores a null reason when none is given", async () => {
    const { admin, candidateUpdateCalls } = fakeAdmin({ candidateRow: { status: "pending" } });
    await rejectCandidate(admin as never, "c1", "");
    expect(candidateUpdateCalls[0]).toMatchObject({ reject_reason: null });
  });
});
