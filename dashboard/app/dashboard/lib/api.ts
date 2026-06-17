/**
 * Thin fetch wrapper for /api/dashboard/* calls. Throws an Error whose
 * message is the server's `error` field (or status text) so callers —
 * notably useOptimisticAction — can surface the real reason in the
 * rollback toast instead of a bare status code.
 */

export async function requestJSON<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!res.ok) {
    throw new Error(json.error ?? `${method} ${url} failed (${res.status})`);
  }
  return json;
}
