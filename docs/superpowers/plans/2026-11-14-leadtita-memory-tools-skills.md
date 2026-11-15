# Leadtita Memory, Skills, and Tool Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Leadtita remember explicit account context, send a trusted Leadta knowledge and mode skill bundle to the model, run eligible free analysis automatically, and stream accessible tool progress into the chat.

**Architecture:** Store bounded structured account memory and idempotent chat turn results in server-only PocketBase collections. Compose trusted, versioned skills separately from commercial profile, account memory, lead context, and user content. The agent emits typed progress events over SSE; the existing chat client renders them in the active turn while preserving confirmation cards for consequential actions.

**Tech Stack:** Next.js App Router Route Handlers, React client components, TypeScript, PocketBase migrations and `pocketBaseFetch`, OpenRouter chat completions, existing chat styles and `next-intl` messages.

**Spec:** `docs/superpowers/specs/2026-11-14-leadtita-memory-tools-skills-design.md`

## Global Constraints

- Scope all account memory and turn records to the authenticated user ID.
- Save only explicit, stable account facts; never save whole transcripts, secrets, or lead data as account memory.
- Only zero-credit read and analysis tools may run automatically; writes, external sends, and credit-bearing actions retain confirmation.
- Keep system instructions, skill bundle, profile, memory, lead context, and current user input as separate prompt sections.
- Treat memory, lead context, attachments, and conversation text as untrusted data.
- Apply lead-mention styling only to explicit selected-lead references; plain `@` text and email addresses remain ordinary text.
- Do not add dependencies or manually author SVGs.
- Preserve unrelated pre-existing workspace changes; stage only files created for this feature if staging is needed.
- Do not add automated test files. Verify through focused lint/type checks and Dogfood flows required by the project instructions.

## Review Focus

- Cross-account memory access: query, update, and turn replay must always be scoped by authenticated user ID.
- Untrusted memory candidates: accept only values grounded in an explicit excerpt from the latest user-authored text, excluding attachments, assistant text, and lead data.
- Tool authorization: only an explicit server allowlist can auto-run free tools; cost or side-effect changes must not be model-controlled.
- SSE interruption: retries with the same turn ID must replay the saved result or report an in-progress turn without executing tools twice.
- Accessibility and recovery: tool status changes must be announced, errors must be understandable, and the composer must remain usable after failure.
- Mention boundary: a plain `@Proveedor` or `ventas@example.com` must not acquire selected-lead reference styling.

---

## File map

- Create `pb_migrations/1794450000_add_leadtita_account_memory.js`: server-only account memory collection with a unique user relation and bounded JSON facts.
- Create `pb_migrations/1794460000_add_leadtita_chat_turns.js`: server-only turn idempotency/result collection unique on account, conversation, and turn ID.
- Create `lib/server/leadtita-memory.ts`: validate, read, and upsert bounded explicit account facts.
- Create `lib/server/leadtita-chat-turns.ts`: claim a turn, replay completed results, and finalize the result under user/conversation scope.
- Create `lib/server/leadtita-skills.ts`: export a cached, versioned product-knowledge skill and seller, generator, and planner mode skills.
- Modify `lib/server/lead-suite-agent.ts`: compose prompt sections, expose the account-memory tool, execute only allowlisted automatic tools, and emit progress callbacks.
- Modify `app/api/lead-suite/chat/route.ts`: validate `turnId`, claim/replay it, and stream typed SSE events while preserving pre-stream validation errors and refreshed session cookies.
- Modify `app/[locale]/lead-suite/chat-panel.tsx` and `chat-panel.css`: create one turn ID per send, parse SSE, show pending/success/error tool status in the active assistant turn, and avoid automatic POST retries.
- Modify `lib/client/leadtita-history.ts`: persist selected-lead reference spans with user messages so history styling is based on explicit selection metadata.
- Modify `messages/lead-suite-chat/es.json` and `messages/lead-suite-chat/en.json`: localized labels and accessible state copy for tool progress and recoverable failures.

## Interfaces

- `AccountMemoryFact`: `{ key: "serviceOffering" | "commercialSectors" | "preferredTone" | "businessContext"; value: string; sourceText: string; updatedAt: string }`.
- `getAccountMemory(userId: string): Promise<AccountMemoryFact[]>` reads only the authenticated account's bounded fact set.
- `rememberAccountFacts(userId: string, candidates: unknown, latestUserText: string): Promise<AccountMemoryFact[]>` validates key allowlist, length/count, exact source excerpt inclusion in latest user text, and value grounding before upsert.
- `ChatTurnRecord`: `{ userId: string; conversationId: string; turnId: string; status: "running" | "completed" | "failed"; result?: LeadSuiteChatResult; errorCode?: string }`.
- `claimChatTurn(userId, conversationId, turnId): Promise<{ kind: "claimed" } | { kind: "running" } | { kind: "completed"; result: LeadSuiteChatResult } | { kind: "failed"; errorCode: string }>` uses the unique index to prevent duplicate execution.
- `finishChatTurn(userId, conversationId, turnId, outcome): Promise<void>` stores either the final result or terminal safe error code for replay.
- `ToolProgressEvent`: `{ type: "tool_started" | "tool_succeeded" | "tool_failed"; id: string; label: string }`. `runLeadSuiteChat` accepts optional `onToolProgress(event)` and keeps its `Promise<LeadSuiteChatResult>` final contract.
- `LeadMentionSpan`: `{ start: number; end: number; leadId: string; name: string }`; client history preserves spans, while the server sends only message text to the model.
- SSE event names: `progress` carries `ToolProgressEvent`; `complete` carries `LeadSuiteChatResult`; `failure` carries a localized-safe error code. No event includes prompts, credentials, or internal lead identifiers.

### Task 1: Persist account memory and add trusted runtime skills

**Files:**
- Create: `pb_migrations/1794450000_add_leadtita_account_memory.js`
- Create: `lib/server/leadtita-memory.ts`
- Create: `lib/server/leadtita-skills.ts`
- Modify: `lib/server/lead-suite-agent.ts`

**Interfaces:**
- Produces `AccountMemoryFact[]`, `getAccountMemory`, `rememberAccountFacts`, and `getLeadtitaSkillBundle(mode)` for later tasks.
- `rememberAccountFacts` receives only the latest user text as grounding evidence and never accepts model-provided user IDs or source attribution.

- [ ] Add the server-only `leadtita_account_memory` collection migration: required user relation with cascade delete, JSON facts capped at 20 KB, one row per user through a unique index, and no client API rules.
- [ ] Implement fact cleaning with a four-key allowlist, maximum 20 facts, per-value limit 300 characters, normalized whitespace, deduplication by key, and updated timestamp.
- [ ] Validate every candidate `sourceText` is a literal substring of the latest user-authored message and every value is grounded in that excerpt; reject attachments and values copied only from conversation history or lead context.
- [ ] Implement read/upsert by authenticated user ID. Make PocketBase read/write failures return an empty/no-op memory result to the chat caller without logging memory text.
- [ ] Add versioned runtime modules for Leadta product knowledge and the Vendedor, Generador, and Planificador modes. Keep each module concise and independent; do not include user-specific memory in these modules.
- [ ] Add `remember_account_context` as an internal model tool with strict schema and dispatch it through `rememberAccountFacts`; suppress it from user-facing action cards and treat tool arguments as untrusted.
- [ ] Compose the prompt in distinct labeled sections: base rules, product/mode skills, commercial profile, account memory, lead/conversation context, and current user request. Cache the static skill bundle once per process.
- [ ] Run `npm run lint -- --no-warn-ignored` on the changed server files and inspect migration syntax. Expected: no lint errors, migration registers a unique per-user collection.

### Task 2: Add durable turn idempotency and automatic free analysis

**Files:**
- Create: `pb_migrations/1794460000_add_leadtita_chat_turns.js`
- Create: `lib/server/leadtita-chat-turns.ts`
- Modify: `lib/server/lead-suite-agent.ts`
- Modify: `lib/server/leadtita-tools.ts`

**Interfaces:**
- Produces `claimChatTurn`, `finishChatTurn`, `ChatTurnRecord`, and `ToolProgressEvent` behavior for the route and client.
- Automatic tool execution is selected from a constant server allowlist, never from client input or model-supplied cost metadata.

- [ ] Add server-only `leadtita_chat_turns`: user relation, conversation ID, turn ID, `running|completed` status, bounded result JSON, timestamps, cascade delete, and a unique index on user + conversation + turn.
- [ ] Implement atomic claim using PocketBase's unique index: new turn returns `claimed`, a completed duplicate returns its stored result, and a running duplicate returns `running` without invoking the model or tools.
- [ ] Add finalization that stores only the final chat result and changes the status to `completed`; do not persist provider prompts, API keys, or progress logs.
- [ ] Convert the zero-credit `propose_analyze_pains` path into a server-side auto-execution path using the existing validated analysis/application logic. Preserve the pending confirmation behavior for other writes and all paid tools.
- [ ] Emit `tool_started`, then `tool_succeeded` or `tool_failed` around each executed model tool call; map internal tool names to safe display labels and do not emit tool arguments or lead IDs.
- [ ] Treat memory writes as idempotent upserts keyed by fact key. A replayed or running turn must not invoke memory extraction again.
- [ ] Run lint on the changed server files and review the allowlist against `CREDITS_PER_PAIN_ANALYSIS` and each tool's side effects. Expected: only approved zero-cost read/analysis tools auto-run.

### Task 3: Stream chat progress through the Route Handler

**Files:**
- Modify: `app/api/lead-suite/chat/route.ts`
- Modify: `lib/server/lead-suite-agent.ts`
- Read: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`

**Interfaces:**
- Request body adds `turnId` matching the existing client ID format, alongside `conversationId` and messages.
- Successful response uses `text/event-stream`; events are `progress`, `complete`, and `failure` as defined above.

- [ ] Keep authentication, request size, conversation state, timezone, mode, and sales channel validation before opening the SSE stream.
- [ ] Claim the turn before calling the model. Return the saved result as a `complete` event for duplicates; return a recoverable `turn_in_progress` failure for an already-running duplicate.
- [ ] Build a `ReadableStream` that encodes each event as `event: <name>\ndata: <JSON>\n\n`, passes the abort signal to the agent, and closes after `complete` or `failure`.
- [ ] On successful model completion, persist the final result before sending `complete`. On caught errors, mark the turn `failed` with a safe error code and send a failure event; duplicate failed turns replay the same failure without re-running tools. Retain current HTTP errors for validation failures before the stream starts.
- [ ] Preserve refreshed session cookies with the streaming `Response`, and set `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `X-Accel-Buffering: no`.
- [ ] Ensure client disconnect/abort does not start a second execution; do not implement automatic retry or resumable event replay beyond returning the stored completed result for the same turn ID.
- [ ] Review against the installed Next.js Route Handler guide and run lint for the route/agent. Expected: pre-stream errors remain JSON, successful chat uses valid SSE framing, duplicate turn IDs never re-run the agent.

### Task 4: Render accessible tool states in the chat

**Files:**
- Modify: `app/[locale]/lead-suite/chat-panel.tsx`
- Modify: `app/[locale]/lead-suite/chat-panel.css`
- Modify if needed: `app/[locale]/lead-suite/lead-mention-popover.tsx`, to ensure selected reference state drives mention styling.
- Modify: `messages/lead-suite-chat/es.json`
- Modify: `messages/lead-suite-chat/en.json`

**Interfaces:**
- The client creates one `turnId` when sending and reuses it only for a deliberate replay of that exact request.
- A streaming turn state stores progress events in received order and the final assistant content/actions.
- User messages preserve `LeadMentionSpan[]` selected through the lead picker; editing text inside a span invalidates that span, while edits before or after it adjust its offsets.

- [ ] Replace `response.json()` in `request()` with a streaming reader that parses SSE frames incrementally, including events split across network chunks.
- [ ] On `progress`, render a compact status line in the active assistant turn. Use `role="status"` and `aria-live="polite"`; show active text such as “Analizando dolores…” and completion text such as “Analizó dolores”.
- [ ] On `complete`, append the final assistant message/actions exactly once and clear the sending state. On `failure`, show localized recoverable error copy, keep the conversation usable, and do not present success.
- [ ] Keep the existing retry button behavior explicit. Reuse the same turn ID when retrying after a transport interruption so the server can replay or reject it without duplicate execution.
- [ ] Ensure only explicit selected-lead references receive mention styling. Verify plain `@Proveedor Fulanito`, an email address, and a selected lead reference each render with the correct distinct style.
- [ ] Preserve selected-reference spans through conversation history. Retain untouched spans, shift later spans by the edit delta, and drop spans intersected by edits.
- [ ] Style progress with the Leadta semantic tokens, existing type and spacing, reduced-motion support, and no SVG or new package.
- [ ] Add localized strings for all three modes of progress and failure in Spanish and English.
- [ ] Run `npm run lint` and Dogfood: normal free pain analysis, empty/failed tool response, paid or mutating action still asks confirmation, duplicate retry, keyboard/screen-reader status announcement, and inspect browser console. Capture only feature-relevant reproduction notes; do not use unrelated dirty files.

## Self-review

- Spec coverage: account memory persistence and isolation are Task 1; knowledge/mode skills and prompt separation are Task 1; automatic free analysis and confirmation boundaries are Task 2; SSE and duplicate-turn safety are Tasks 2-3; accessible client progress and error handling are Task 4.
- Placeholder scan: implementation steps include concrete files, interfaces, and expected outcomes.
- Interface consistency: route, agent, and client share one turn ID and the `progress|complete|failure` event contract; turn records store the same `LeadSuiteChatResult` the current JSON route returns.
- Review-focus coverage: isolation and grounding are Task 1; automatic-tool allowlist is Task 2; duplicate claims and final replay are Tasks 2-3; accessibility and failures are Task 4.
- Scope: one implementation plan is appropriate because memory, skill composition, tool events, mention formatting, and chat presentation are integrated parts of the same chat surface and turn. It does not include token streaming, automatic external sending, or organization-shared memory.
