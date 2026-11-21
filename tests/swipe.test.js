import test from "node:test";
import assert from "node:assert/strict";
import { decideStart, decideRelease, offsetFor, ACTION_WIDTH } from "../js/swipe.js";

test("swipe start: horizontal must clearly dominate", () => {
  assert.equal(decideStart(-5, 2), "pending");
  assert.equal(decideStart(-30, 5), "swipe");
  assert.equal(decideStart(-20, 16), "pending"); // not dominant enough yet
  assert.equal(decideStart(-12, 30), "scroll");
  assert.equal(decideStart(2, 25), "scroll");
  assert.equal(decideStart(30, 2), "scroll"); // rightward on a closed row
  assert.equal(decideStart(30, 2, { open: true }), "swipe");
});
test("swipe release: snap back, open, delete, flicks", () => {
  const w = 360;
  assert.equal(decideRelease({ dx: -40, width: w }), "close");
  assert.equal(decideRelease({ dx: -0.4 * w, width: w }), "open");
  assert.equal(decideRelease({ dx: -0.7 * w, width: w }), "delete");
  assert.equal(decideRelease({ dx: -40, width: w, velocity: -0.9 }), "open");
  assert.equal(decideRelease({ dx: 10, width: w, open: true, velocity: 0.8 }), "close");
  assert.equal(decideRelease({ dx: 60, width: w, open: true }), "close");
  assert.equal(decideRelease({ dx: 0, width: w, open: true }), "open");
  assert.equal(offsetFor(-1000, w), w);
  assert.equal(offsetFor(50, w), 0);
  assert.equal(offsetFor(-10, w, true), ACTION_WIDTH + 10);
});
