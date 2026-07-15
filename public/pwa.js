// Wires up PWA behavior for every admin page. Kept as its own file
// (rather than folded into admin.js) so installability is purely
// additive — no existing page logic is touched.
//
// Must load after centre.config.js (for window.CENTRE_CONFIG) and can
// load before or after admin.js; it doesn't depend on it.
(function () {
  const cfg = window.CENTRE_CONFIG;

  // theme-color and apple-mobile-web-app-title can't be templated into
  // the static HTML without a build step, so each admin page ships them
  // as empty placeholders and this fills them in from centre.config.js —
  // the same "everything client-specific reads from config" rule the
  // manifest and icons follow.
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) themeColorMeta.setAttribute("content", cfg.brandColor);

  const appTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appTitleMeta) appTitleMeta.setAttribute("content", cfg.centreName);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a nice-to-have, not a functional requirement —
      // a failed registration shouldn't be treated as a page error.
    });
  }
})();
