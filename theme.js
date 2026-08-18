/* Theme switch, shared by the three pages.

   Applied before first paint so navigating between pages never flashes the
   wrong theme, and remembered, because the leaderboard, the explorer and the
   playground hand off to each other constantly.

   Pages that draw to a canvas listen for the themechange event and redraw. */
(function () {
  var KEY = "eda-schema-theme";
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
  var theme = saved ||
    (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);

  window.setTheme = function (next) {
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));
  };

  addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("themebtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  });
})();
