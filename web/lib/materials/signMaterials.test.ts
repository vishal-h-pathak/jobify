import { describe, expect, it, vi } from "vitest";
import { signMaterials } from "./signMaterials";

/**
 * Chainable fake admin client covering the two storage calls this module
 * performs: `storage.from(bucket).list(prefix)` and
 * `storage.from(bucket).createSignedUrls(paths, expiresIn)`.
 */
function fakeAdmin(
  listing: Array<{ name: string }> | null,
  listError: { message: string } | null = null,
  signed: Array<{ path: string | null; signedUrl: string | null }> | null = null,
  signError: { message: string } | null = null
) {
  const list = vi.fn(async () => ({ data: listing, error: listError }));
  const createSignedUrls = vi.fn(async () => ({ data: signed, error: signError }));
  const from = vi.fn(() => ({ list, createSignedUrls }));
  const admin = { storage: { from } };
  return { admin, from, list, createSignedUrls };
}

describe("signMaterials", () => {
  it("lists the exact user/posting prefix", async () => {
    const { admin, from, list } = fakeAdmin([]);
    await signMaterials(admin as never, "user-1", "posting-1", 300);

    expect(from).toHaveBeenCalledWith("job-materials");
    expect(list).toHaveBeenCalledWith("user-1/posting-1");
  });

  it("returns {} without calling createSignedUrls when nothing is listed", async () => {
    const { admin, createSignedUrls } = fakeAdmin([]);
    const result = await signMaterials(admin as never, "user-1", "posting-1", 300);

    expect(result).toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("returns {} when the listing has only unrecognized filenames", async () => {
    const { admin, createSignedUrls } = fakeAdmin([{ name: "junk.tmp" }]);
    const result = await signMaterials(admin as never, "user-1", "posting-1", 300);

    expect(result).toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("signs only the known artifacts actually present, in one batched call", async () => {
    const { admin, createSignedUrls } = fakeAdmin(
      [{ name: "resume.pdf" }, { name: "cover_letter.pdf" }, { name: "prefill.png" }],
      null,
      [
        { path: "user-1/posting-1/resume.pdf", signedUrl: "https://sign/resume.pdf?token=a" },
        { path: "user-1/posting-1/cover_letter.pdf", signedUrl: "https://sign/cover_letter.pdf?token=b" },
      ]
    );
    const result = await signMaterials(admin as never, "user-1", "posting-1", 300);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(
      ["user-1/posting-1/resume.pdf", "user-1/posting-1/cover_letter.pdf"],
      300
    );
    expect(result).toEqual({
      "resume.pdf": "https://sign/resume.pdf?token=a",
      "cover_letter.pdf": "https://sign/cover_letter.pdf?token=b",
    });
  });

  it("signs all six known artifacts when every one is present", async () => {
    const names = ["resume.pdf", "cover_letter.pdf", "cover_letter.txt", "tailored.json", "claims.json", "render_meta.json"];
    const { admin, createSignedUrls } = fakeAdmin(
      names.map((name) => ({ name })),
      null,
      names.map((name) => ({ path: `user-1/posting-1/${name}`, signedUrl: `https://sign/${name}` }))
    );
    const result = await signMaterials(admin as never, "user-1", "posting-1", 300);

    expect(createSignedUrls).toHaveBeenCalledWith(
      names.map((name) => `user-1/posting-1/${name}`),
      300
    );
    expect(Object.keys(result).sort()).toEqual([...names].sort());
  });

  it("skips a signed entry with a null path or null signedUrl instead of throwing", async () => {
    const { admin } = fakeAdmin(
      [{ name: "resume.pdf" }, { name: "claims.json" }],
      null,
      [
        { path: "user-1/posting-1/resume.pdf", signedUrl: null },
        { path: null, signedUrl: "https://sign/claims.json" },
      ]
    );
    const result = await signMaterials(admin as never, "user-1", "posting-1", 300);

    expect(result).toEqual({});
  });

  it("passes expiresInSeconds through to createSignedUrls verbatim", async () => {
    const { admin, createSignedUrls } = fakeAdmin(
      [{ name: "resume.pdf" }],
      null,
      [{ path: "user-1/posting-1/resume.pdf", signedUrl: "https://sign/resume.pdf" }]
    );
    await signMaterials(admin as never, "user-1", "posting-1", 42);

    expect(createSignedUrls).toHaveBeenCalledWith(expect.anything(), 42);
  });

  it("throws on a list() error instead of swallowing it", async () => {
    const { admin } = fakeAdmin(null, { message: "list failed" });
    await expect(signMaterials(admin as never, "user-1", "posting-1", 300)).rejects.toEqual({
      message: "list failed",
    });
  });

  it("throws on a createSignedUrls() error instead of swallowing it", async () => {
    const { admin } = fakeAdmin([{ name: "resume.pdf" }], null, null, { message: "sign failed" });
    await expect(signMaterials(admin as never, "user-1", "posting-1", 300)).rejects.toEqual({
      message: "sign failed",
    });
  });
});
