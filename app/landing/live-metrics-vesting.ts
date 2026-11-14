// Pure vesting logic for the landing live metrics (no React; tested by live-metrics.selfcheck.mjs).

/** Max increase released per metric on each tick. */
export const VEST_STEP = 10;
/** Time between ticks. */
export const VEST_INTERVAL_MS = 5_000;

/** `shown` = value released to the UI; `target` = highest real value received. */
export type Vesting = { shown: number; target: number };

/** First load: show the real value directly, no vesting. */
export function startVesting(real: number): Vesting {
  const value = Math.max(0, Math.floor(real));
  return { shown: value, target: value };
}

/** New real value: queue the increase. A lower value is ignored so the number never goes down. */
export function receiveVesting(state: Vesting, real: number): Vesting {
  const value = Math.floor(real);
  return value > state.target ? { shown: state.shown, target: value } : state;
}

/** One tick: release at most VEST_STEP of the pending increase. */
export function stepVesting(state: Vesting): Vesting {
  if (state.shown >= state.target) return state;
  return { shown: Math.min(state.target, state.shown + VEST_STEP), target: state.target };
}

export function isVesting(state: Vesting): boolean {
  return state.shown < state.target;
}
