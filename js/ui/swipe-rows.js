/* Left-swipe to reveal 削除 on list rows (touch / pen only). Mouse users
   delete from the dialog. Decisions are in js/swipe.js. */
import { decideStart, decideRelease, offsetFor, ACTION_WIDTH } from "../swipe.js";

const NO_START = ".steps-scroll, .cmp-scroll, input, select, textarea, .swipe-del";

/** onDelete(id): called when the 削除 button is tapped or the row is swiped far. */
export function installSwipeRows(root, { onDelete }) {
  let g = null;          // current gesture
  let openWrap = null;   // the row that shows its 削除 button
  let suppressClick = false;

  const rowOf = (wrap) => wrap.querySelector(":scope > .lrow");
  const btnOf = (wrap) => wrap.querySelector(":scope > .swipe-del");
  function setOffset(wrap, px) { rowOf(wrap).style.transform = px ? `translateX(${-px}px)` : ""; }
  function setOpen(wrap, open) {
    const b = btnOf(wrap);
    b.tabIndex = open ? 0 : -1;
    b.setAttribute("aria-hidden", String(!open));
    setOffset(wrap, open ? ACTION_WIDTH : 0);
    if (open) { if (openWrap && openWrap !== wrap && openWrap.isConnected) setOpen(openWrap, false); openWrap = wrap; }
    else if (openWrap === wrap) openWrap = null;
  }
  function closeOpen() { if (openWrap && openWrap.isConnected) setOpen(openWrap, false); openWrap = null; }

  root.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    const wrap = e.target.closest(".swipe");
    if (openWrap && openWrap !== wrap) closeOpen();
    if (!wrap || e.target.closest(NO_START)) return;
    g = { wrap, id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, lastX: e.clientX, lastT: e.timeStamp, vx: 0, state: "pending", open: wrap === openWrap, width: wrap.getBoundingClientRect().width };
  });
  root.addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    const dt = Math.max(1, e.timeStamp - g.lastT);
    g.vx = (e.clientX - g.lastX) / dt; g.lastX = e.clientX; g.lastT = e.timeStamp;
    if (g.state === "pending") {
      g.state = decideStart(dx, dy, { open: g.open });
      if (g.state === "scroll") { g = null; return; }
      if (g.state === "swipe") { g.wrap.classList.add("dragging"); try { g.wrap.setPointerCapture(e.pointerId); } catch (_) {} }
    }
    if (g.state === "swipe") { e.preventDefault(); setOffset(g.wrap, offsetFor(dx, g.width, g.open)); }
  });
  function finish(e, cancelled) {
    if (!g || e.pointerId !== g.id) return;
    const cur = g; g = null;
    if (cur.state !== "swipe") return;
    cur.wrap.classList.remove("dragging");
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 400);
    if (cancelled) { setOpen(cur.wrap, cur.open); return; }
    const r = decideRelease({ dx: e.clientX - cur.x, width: cur.width, velocity: cur.vx, open: cur.open });
    if (r === "delete") { setOffset(cur.wrap, cur.width); onDelete(cur.wrap.dataset.swipe); }
    else setOpen(cur.wrap, r === "open");
  }
  root.addEventListener("pointerup", (e) => finish(e, false));
  root.addEventListener("pointercancel", (e) => finish(e, true));
  // a swipe must not also count as a tap on the row (which would open the dialog)
  root.addEventListener("click", (e) => {
    if (suppressClick && !e.target.closest(".swipe-del")) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openWrap) { const w = openWrap; closeOpen(); const r = rowOf(w); const f = r && r.querySelector(".who button"); if (f) f.focus(); } });
  addEventListener("scroll", () => { if (openWrap && !g) closeOpen(); }, { passive: true });
  return { close: closeOpen, reset: () => { openWrap = null; g = null; } };
}
