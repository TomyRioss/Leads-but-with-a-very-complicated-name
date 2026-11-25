// Pure OpenRouter `usage` -> ai_usage columns. No `@/` imports so the selfcheck runs under node type stripping.

export type AiUsageFields = {
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  cached_tokens: number;
  reasoning_tokens: number;
  web_search_requests: number;
  web_fetch_requests: number;
};

function nonNegative(value: unknown, integer: boolean) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return integer ? Math.round(parsed) : parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Missing, malformed or negative values become 0. */
export function aiUsageFields(usage: unknown): AiUsageFields {
  const root = asRecord(usage);
  const prompt = asRecord(root.prompt_tokens_details);
  const completion = asRecord(root.completion_tokens_details);
  const tools = asRecord(root.server_tool_use_details);
  return {
    prompt_tokens: nonNegative(root.prompt_tokens, true),
    completion_tokens: nonNegative(root.completion_tokens, true),
    cost_usd: nonNegative(root.cost, false),
    cached_tokens: nonNegative(prompt.cached_tokens, true),
    reasoning_tokens: nonNegative(completion.reasoning_tokens, true),
    web_search_requests: nonNegative(tools.web_search_requests, true),
    web_fetch_requests: nonNegative(tools.web_fetch_requests, true),
  };
}
