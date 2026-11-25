import assert from "node:assert/strict";
import { aiUsageFields } from "../ai-usage-fields.ts";

const zero = { prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, cached_tokens: 0, reasoning_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };

// 1. Missing or malformed usage -> all zeros.
for (const value of [undefined, null, "x", 3, [], {}]) assert.deepEqual(aiUsageFields(value), zero);

// 2. Full OpenRouter shape.
assert.deepEqual(aiUsageFields({
  prompt_tokens: 1200,
  completion_tokens: 300,
  cost: 0.0042,
  prompt_tokens_details: { cached_tokens: 800 },
  completion_tokens_details: { reasoning_tokens: 120 },
  server_tool_use_details: { web_search_requests: 4, web_fetch_requests: 2, tool_calls_requested: 4, tool_calls_executed: 4 },
}), { prompt_tokens: 1200, completion_tokens: 300, cost_usd: 0.0042, cached_tokens: 800, reasoning_tokens: 120, web_search_requests: 4, web_fetch_requests: 2 });

// 3. Real shape without fetch requests -> fetch 0.
const real = aiUsageFields({ server_tool_use_details: { web_search_requests: 4, tool_calls_requested: 4, tool_calls_executed: 4 } });
assert.equal(real.web_search_requests, 4);
assert.equal(real.web_fetch_requests, 0);

// 4. Negative, NaN, empty string and non-object details -> 0; numeric strings and fractions are normalized.
assert.deepEqual(aiUsageFields({
  prompt_tokens: -5,
  completion_tokens: "12.6",
  cost: "nope",
  prompt_tokens_details: "bad",
  completion_tokens_details: { reasoning_tokens: "" },
  server_tool_use_details: { web_search_requests: Number.NaN },
}), { ...zero, completion_tokens: 13 });

console.log("ai-usage selfcheck ok");
