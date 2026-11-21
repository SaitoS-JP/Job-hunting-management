/*
 * Left-swipe on a list row (touch / pen). Pure decisions; the DOM side is
 * js/ui/swipe-rows.js.
 */
export const ACTION_WIDTH = 88;      // width of the revealed 削除 button
export const START_SLOP = 10;        // px before deciding scroll vs swipe
export const DOMINANCE = 1.5;        // |dx| must exceed |dy| * this to swipe
export const OPEN_RATIO = 0.3;       // release past 30% of the row width -> open
export const DELETE_RATIO = 0.6;     // release past 60% -> delete right away
export const FLICK = 0.5;            // px/ms

/**
 * While the finger moves: "pending" (not sure yet), "swipe" (row follows the
 * finger) or "scroll" (leave it to the page). `open`: the row is already open,
 * so a rightward swipe (to close it) is allowed too.
 */
export function decideStart(dx, dy, { open = false } = {}) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < START_SLOP && ay < START_SLOP) return "pending";
  if (ax > START_SLOP && ax > ay * DOMINANCE && (dx < 0 || open)) return "swipe";
  if (ay >= START_SLOP && ay >= ax) return "scroll";
  if (ax > START_SLOP && dx > 0 && !open) return "scroll"; // rightward on a closed row: nothing to do
  return "pending";
}

/** How far the row is shifted (px, ≥ 0 means moved left), clamped to the row width. */
export function offsetFor(dx, width, open = false) {
  return Math.max(0, Math.min(width, (open ? ACTION_WIDTH : 0) - dx));
}

/**
 * On release: "delete", "open" or "close".
 * velocity: px/ms along x (negative = leftward).
 */
export function decideRelease({ dx, width, velocity = 0, open = false }) {
  const off = offsetFor(dx, width, open);
  if (off >= width * DELETE_RATIO) return "delete";
  if (velocity <= -FLICK) return "open";
  if (velocity >= FLICK) return "close";
  return off >= width * OPEN_RATIO || (open && off >= ACTION_WIDTH / 2) ? "open" : "close";
}
