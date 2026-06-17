/**
 * GitHub Actions workflow_dispatch helper used by the dashboard
 * "Run hunt" / "Run tailor" buttons (Phase 3 dashboard run-buttons).
 *
 * Server-only — pulls a fine-grained PAT from GITHUB_PAT (workflows:write
 * on the job-pipeline repo only). Do not import from client components.
 */

export type DispatchResult =
  | { ok: true; status: number }
  | { ok: false; status: number; errorMessage: string };

export async function dispatchWorkflow(
  workflow: string,
  inputs: Record<string, string>,
  ref: string = "main",
): Promise<DispatchResult> {
  const pat = process.env.GITHUB_PAT;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!pat || !owner || !repo) {
    return {
      ok: false,
      status: 500,
      errorMessage:
        "Server misconfigured (missing GITHUB_PAT / GITHUB_OWNER / GITHUB_REPO)",
    };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 502, errorMessage: `Network error: ${msg}` };
  }

  if (res.status === 204) {
    return { ok: true, status: 204 };
  }

  let detail = "";
  try {
    detail = await res.text();
  } catch {
    // ignore
  }
  return {
    ok: false,
    status: res.status,
    errorMessage: `GitHub dispatch failed (${res.status}): ${detail.slice(0, 500)}`,
  };
}
