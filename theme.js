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

/* al-folio enable_progressbar — same reading-position indicator as
   drexel-ice.github.io. A <progress> under the navbar tracks scrollY. */
(function () {
  function mount() {
    if (document.getElementById("progress")) return;
    var bar = document.createElement("progress");
    bar.id = "progress";
    bar.max = 1;
    bar.value = 0;
    bar.setAttribute("aria-hidden", "true");
    document.body.insertBefore(bar, document.body.firstChild);

    function navH() {
      var nav = document.querySelector(".icelab-navbar");
      return nav ? nav.offsetHeight : 72;
    }
    function distance() {
      return Math.max(0, document.documentElement.scrollHeight - innerHeight);
    }
    function update() {
      bar.style.top = navH() + "px";
      var d = distance();
      bar.max = d || 1;
      bar.value = d ? Math.min(d, scrollY) : 0;
    }
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
    update();
    setTimeout(update, 50);
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount);
  else mount();
})();
