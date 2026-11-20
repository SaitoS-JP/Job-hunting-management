/* Applies the saved theme before the first paint (loaded synchronously in <head>).
   Names and colours must match js/themes.js (checked by tests/themes.test.js). */
(function () {
  var T = {pop:["#fbf6f1","#1f1830"],wa:["#f5f1e8","#171513"],yo:["#f6f1e4","#10201a"],sf:["#e9eef4","#070b14"]};
  var n = null;
  try { n = localStorage.getItem("shukatsu.theme"); } catch (e) { n = null; }
  if (!n || !Object.prototype.hasOwnProperty.call(T, n)) return;
  var d = document.documentElement;
  d.setAttribute("data-theme-name", n);
  var l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "./fonts/theme-" + n + ".css"; l.id = "theme-font";
  document.head.appendChild(l);
  var m = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < m.length; i++) m[i].setAttribute("content", T[n][/dark/.test(m[i].getAttribute("media") || "") ? 1 : 0]);
})();
