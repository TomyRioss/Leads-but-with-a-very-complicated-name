/** What a use case returns: the exact status + JSON its route sends. `refreshSession`: the route re-sets the session cookie. */
export type ApiResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string>; refreshSession?: boolean };

/** Adapts a JSON response from a shared gate (rate limit, request validation) to an ApiResult. */
export async function apiResultFrom(response: Response, refreshSession = false): Promise<ApiResult> {
  const headers = Object.fromEntries([...response.headers].filter(([name]) => name !== "content-type"));
  return { status: response.status, body: await response.json() as Record<string, unknown>, ...(Object.keys(headers).length ? { headers } : {}), ...(refreshSession ? { refreshSession } : {}) };
}
