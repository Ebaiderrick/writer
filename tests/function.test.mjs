/**
 * Unit tests for netlify/functions/ai-assist.js
 * Covers validation layer; no real API calls (no OPENAI_API_KEY set).
 *
 * Run: node --test tests/function.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../netlify/functions/ai-assist.js";

// ── helpers ────────────────────────────────────────────────────────────────

function makeEvent(method, body) {
  return { httpMethod: method, body: body != null ? JSON.stringify(body) : body };
}

function validBody(overrides = {}) {
  return {
    type: "action",
    action: "Continue",
    current: "The hero walks in.",
    context: "",
    instruction: "",
    ...overrides,
  };
}

async function call(method, body) {
  const result = await handler(makeEvent(method, body));
  return { ...result, json: JSON.parse(result.body) };
}

// ── method validation ──────────────────────────────────────────────────────

await test("GET → 405 Method Not Allowed", async () => {
  const r = await call("GET", null);
  assert.equal(r.statusCode, 405);
  assert.equal(r.json.error, "Method Not Allowed");
});

await test("PUT → 405 Method Not Allowed", async () => {
  const r = await call("PUT", null);
  assert.equal(r.statusCode, 405);
});

// ── JSON parsing ───────────────────────────────────────────────────────────

await test("malformed JSON body → 400 Invalid JSON", async () => {
  const result = await handler({ httpMethod: "POST", body: "{bad json" });
  const json = JSON.parse(result.body);
  assert.equal(result.statusCode, 400);
  assert.equal(json.error, "Invalid JSON");
});

// ── required fields ────────────────────────────────────────────────────────

await test("missing current field → 400 Missing current block", async () => {
  const r = await call("POST", { type: "action", action: "Continue" });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json.error, "Missing current block");
});

// ── type/action allowlisting ───────────────────────────────────────────────

await test("unknown type → 400 Invalid block type", async () => {
  const r = await call("POST", validBody({ type: "unknown" }));
  assert.equal(r.statusCode, 400);
  assert.equal(r.json.error, "Invalid block type");
});

await test("unknown action → 400 Invalid action", async () => {
  const r = await call("POST", validBody({ action: "Hack" }));
  assert.equal(r.statusCode, 400);
  assert.equal(r.json.error, "Invalid action");
});

// ── length limits ──────────────────────────────────────────────────────────

await test("current block over 4000 chars → 400 Content too long", async () => {
  const r = await call("POST", validBody({ current: "x".repeat(4001) }));
  assert.equal(r.statusCode, 400);
  assert.equal(r.json.error, "Content too long");
});

await test("context over 15000 chars → 400 Context too long", async () => {
  const r = await call("POST", validBody({ context: "x".repeat(15001) }));
  assert.equal(r.statusCode, 400);
  assert.equal(r.json.error, "Context too long");
});

await test("instruction over 500 chars → 400 Instruction too long", async () => {
  const r = await call("POST", validBody({ instruction: "x".repeat(501) }));
  assert.equal(r.statusCode, 400);
  assert.equal(r.json.error, "Instruction too long");
});

// ── test-mode response (no API key) ───────────────────────────────────────

await test("valid request without API key → 200 test-mode output", async () => {
  const r = await call("POST", validBody());
  assert.equal(r.statusCode, 200);
  assert.ok(typeof r.json.output === "string" && r.json.output.length > 0,
    "should return a non-empty output string");
});

await test("empty type/action still accepted when current is present", async () => {
  const r = await call("POST", { current: "Some text." });
  assert.equal(r.statusCode, 200);
});

// ── request ID header ──────────────────────────────────────────────────────

await test("every response includes X-Request-Id header", async () => {
  // 405 path
  const r405 = await handler(makeEvent("GET", null));
  assert.ok(r405.headers["X-Request-Id"], "405 should have X-Request-Id");

  // 400 path
  const r400 = await handler(makeEvent("POST", validBody({ type: "bad" })));
  assert.ok(JSON.parse(r400.headers ? JSON.stringify(r400.headers) : "{}") !== null);
  assert.ok(r400.headers["X-Request-Id"], "400 should have X-Request-Id");

  // 200 path
  const r200 = await handler(makeEvent("POST", JSON.stringify(validBody())));
  assert.ok(r200.headers["X-Request-Id"], "200 should have X-Request-Id");
});

// ── boundary values ────────────────────────────────────────────────────────

await test("current at exactly 4000 chars is accepted", async () => {
  const r = await call("POST", validBody({ current: "x".repeat(4000) }));
  assert.equal(r.statusCode, 200);
});

await test("context at exactly 15000 chars is accepted", async () => {
  const r = await call("POST", validBody({ context: "x".repeat(15000) }));
  assert.equal(r.statusCode, 200);
});

await test("all valid block types are accepted", async () => {
  const types = ["scene", "dialogue", "action", "character", "parenthetical",
    "transition", "shot", "general"];
  for (const type of types) {
    const r = await call("POST", validBody({ type }));
    assert.equal(r.statusCode, 200, `type "${type}" should be accepted`);
  }
});

await test("all valid actions are accepted", async () => {
  const actions = ["Predict", "Expand", "Fix", "Add Conflict", "Cinematic",
    "Suggest Reply", "Rephrase", "Add Emotion", "Shorten", "Subtext",
    "Continue", "Visualize", "Add Tension", "Describe", "Grammar",
    "Camera Angle", "Improve Shot", "Add Movement"];
  for (const action of actions) {
    const r = await call("POST", validBody({ action }));
    assert.equal(r.statusCode, 200, `action "${action}" should be accepted`);
  }
});
