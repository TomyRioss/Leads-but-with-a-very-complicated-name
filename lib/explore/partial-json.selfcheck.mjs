import assert from "node:assert/strict";
import { parsePartialJson } from "./partial-json.ts";

assert.equal(parsePartialJson(""), undefined);
assert.equal(parsePartialJson("thinking…"), undefined);
assert.deepEqual(parsePartialJson("{"), {});
assert.deepEqual(parsePartialJson("{\"name\":\"Lor"), { name: "Lor" });
assert.deepEqual(parsePartialJson("{\"name\":\"Loruppa\",\"sum"), { name: "Loruppa" });
assert.deepEqual(parsePartialJson("{\"name\":\"Loruppa\",\"summary\":"), { name: "Loruppa" });
assert.deepEqual(parsePartialJson("{\"a\":[\"x\",\"y"), { a: ["x", "y"] });
assert.deepEqual(parsePartialJson("{\"a\":[{\"n\":\"Wix\",\"d\":\"wi"), { a: [{ n: "Wix", d: "wi" }] });
assert.deepEqual(parsePartialJson("{\"fit\":8"), { fit: 8 });
assert.deepEqual(parsePartialJson("{\"ok\":tru"), {});
assert.deepEqual(parsePartialJson("{\"s\":\"a \\\"b\\\" c"), { s: "a \"b\" c" });
assert.deepEqual(parsePartialJson("{\"s\":\"a\\"), {});
assert.deepEqual(parsePartialJson("```json\n{\"a\":1}\n```"), { a: 1 });
assert.deepEqual(parsePartialJson("{\"a\":{\"b\":[1,2],\"c\":\"z\"}}"), { a: { b: [1, 2], c: "z" } });
console.log("partial-json selfcheck ok");
