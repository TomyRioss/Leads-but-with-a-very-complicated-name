import assert from "node:assert/strict";
import { trialAccess, trialEndsAt, TRIAL_CUTOFF } from "./trial.ts";

// Cuentas viejas, vacías o inválidas: sin vencimiento.
assert.equal(trialEndsAt("2026-11-01 10:00:00.000Z"), "");
assert.equal(trialEndsAt(""), "");
assert.equal(trialEndsAt(undefined), "");
assert.equal(trialEndsAt("nope"), "");
// Desde el corte: 7 días exactos, con el formato de PocketBase (espacio) y con ISO.
assert.equal(trialEndsAt(TRIAL_CUTOFF), "2026-12-03T03:00:00.000Z");
assert.equal(trialEndsAt("2026-11-27 12:00:00.000Z"), "2026-12-04T12:00:00.000Z");

const end = "2026-12-04T12:00:00.000Z";
assert.equal(trialAccess("", false), "ok");
assert.equal(trialAccess(end, true, Date.parse("2027-01-01T00:00:00Z")), "ok");
assert.equal(trialAccess(end, false, Date.parse("2026-12-04T11:59:59Z")), "trial");
assert.equal(trialAccess(end, false, Date.parse(end)), "expired");
console.log("trial selfcheck ok");
