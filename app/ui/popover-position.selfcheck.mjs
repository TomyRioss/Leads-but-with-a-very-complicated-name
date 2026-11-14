// node --experimental-strip-types app/ui/popover-position.selfcheck.mjs
import assert from "node:assert/strict";
import { anchorArea, computePosition } from "./popover-position.ts";

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const vp = { width: 360, height: 740 };
const pop = { width: 336, height: 290 };

// Room below: bottom-start, glued to the trigger (8px), shifted inside the right edge.
let p = computePosition(rect(100, 100, 120, 24), pop, "bottom-start", vp);
assert.deepEqual([p.side, p.top, p.left], ["bottom", 132, 16]);
// Near the bottom: flips to top, still 8px from the trigger.
p = computePosition(rect(100, 650, 120, 24), pop, "bottom-start", vp);
assert.deepEqual([p.side, p.top + pop.height], ["top", 642]);
// Near the top with top-start preferred: flips down.
p = computePosition(rect(12, 20, 80, 40), { width: 190, height: 100 }, "top-start", { width: 1280, height: 800 });
assert.deepEqual([p.side, p.top, p.left], ["bottom", 68, 12]);
// Bottom-left corner (sidebar language switcher): opens up, aligned to the trigger's left edge.
p = computePosition(rect(12, 690, 104, 42), { width: 190, height: 102 }, "top-start", { width: 1280, height: 800 });
assert.deepEqual([p.side, p.top, p.left], ["top", 580, 12]);
// Right edge with bottom-end: right edges aligned.
p = computePosition(rect(1180, 20, 90, 42), { width: 190, height: 102 }, "bottom-end", { width: 1280, height: 800 });
assert.equal(p.left + 190, 1270);
// Neither side fits: clamped inside the viewport.
p = computePosition(rect(10, 300, 50, 20), { width: 200, height: 700 }, "bottom-start", vp);
assert.ok(p.top >= 8 && p.top + 700 <= vp.height - 8 + 1);
// Arrow stays within the popover and points at the trigger center.
p = computePosition(rect(300, 100, 40, 20), { width: 200, height: 80 }, "bottom-start", vp);
assert.equal(p.left + p.arrow, 320);

assert.deepEqual(anchorArea("top-start"), { area: "top span-right", margin: "marginBottom" });
assert.deepEqual(anchorArea("bottom-end"), { area: "bottom span-left", margin: "marginTop" });
console.log("popover-position selfcheck ok");
