// Run: node --experimental-strip-types app/landing/live-metrics.selfcheck.mjs
import assert from "node:assert/strict";
import { VEST_INTERVAL_MS, VEST_STEP, isVesting, receiveVesting, startVesting, stepVesting } from "./live-metrics-vesting.ts";

/** Ticks until settled; returns the increments released per tick. */
function drain(state) {
  const increments = [];
  while (isVesting(state)) {
    const next = stepVesting(state);
    assert.ok(next.shown >= state.shown, "never goes down");
    increments.push(next.shown - state.shown);
    state = next;
  }
  return { state, increments };
}

assert.equal(VEST_STEP, 10);
assert.equal(VEST_INTERVAL_MS, 5000);

// First load: real value shown directly.
assert.deepEqual(startVesting(635), { shown: 635, target: 635 });

// +37 -> 10, 10, 10, 7.
assert.deepEqual(drain(receiveVesting(startVesting(635), 672)).increments, [10, 10, 10, 7]);

// User example: +100 -> ten steps of 10, 50 s in total.
{
  const { increments, state } = drain(receiveVesting(startVesting(0), 100));
  assert.deepEqual(increments, Array(10).fill(10));
  assert.equal(increments.length * VEST_INTERVAL_MS, 50_000);
  assert.equal(state.shown, 100);
}

// Accumulation: more arrive mid-vesting and join the queue.
{
  let state = receiveVesting(startVesting(0), 25);
  state = stepVesting(state); // 10
  state = receiveVesting(state, 40); // +15 more
  const { increments, state: end } = drain(state);
  assert.deepEqual(increments, [10, 10, 10]);
  assert.equal(end.shown, 40);
}

// Never goes down: a lower real value is ignored.
{
  const state = startVesting(50);
  assert.equal(receiveVesting(state, 30), state);
  const pending = receiveVesting(state, 70);
  assert.equal(receiveVesting(pending, 60).target, 70);
}

// Settled state is stable.
assert.deepEqual(stepVesting(startVesting(5)), { shown: 5, target: 5 });

console.log("live-metrics vesting selfcheck: ok");
