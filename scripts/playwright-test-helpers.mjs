// scripts/playwright-test-helpers.mjs
//
// Shared setup for ad hoc Playwright verification scripts against the
// admin dashboard (this project has no test framework/runner — these are
// one-off scripts run with `node`, not a suite, but they should all share
// this setup rather than each re-deriving it).
//
// serviceWorkers: "block" is not optional here. public/pwa.js registers a
// service worker (public/sw.js) on every admin page for PWA
// installability. Its fetch handler intercepts network requests at a
// layer page.route() does not cover, so a mocked response can be silently
// bypassed while the real request goes out over the live network — with
// a fake test session token, that means a real 401, a real (failing)
// token refresh, and a redirect to the login page that looks like a
// broken feature rather than an unmocked service worker underneath the
// test. This was discovered the hard way by a false failure in a
// delete-fee test; every admin test context must block service workers
// so that gap can't reopen silently.
//
// This file intentionally does not import anything from the "playwright"
// package — this project ships zero npm dependencies (see package.json),
// and playwright is only ever available ad hoc wherever a test script is
// run from, not installed here. Callers already import chromium/devices
// themselves; just spread devices["iPhone 12"] (or a plain viewport) into
// the options passed to newAdminContext.
//
// Usage:
//   import { chromium, devices } from "playwright";
//   import { newAdminContext } from "<path>/scripts/playwright-test-helpers.mjs";
//   const context = await newAdminContext(browser, { ...devices["iPhone 12"] });
//   const context = await newAdminContext(browser, { viewport: { width: 1280, height: 800 } });
//   const context = await newAdminContext(browser, { session: null }); // e.g. testing the login page itself

export async function newAdminContext(browser, options = {}) {
  const { session = { access_token: "fake", refresh_token: "fake" }, ...contextOptions } = options;

  const context = await browser.newContext({
    ...contextOptions,
    serviceWorkers: "block",
  });

  if (session) {
    // addInitScript re-runs on every navigation in this context, not just
    // the first page load. Without the sentinel guard below, a test that
    // exercises an expired-session redirect (dashboard.html -> clears the
    // session -> navigates to index.html) would have this script
    // immediately re-inject the fake session on index.html's load too —
    // index.html's own getSession() check would then see a "valid"
    // session and bounce straight back to dashboard.html, which 401s
    // again, clears again, redirects again... an infinite loop that looks
    // like a real app bug but is purely a test-harness artifact. The
    // sentinel key survives clearSession() (which only removes the
    // session key itself), so the fake session is seeded exactly once
    // per context, and a real clearSession() during the test sticks.
    await context.addInitScript((s) => {
      if (!localStorage.getItem("__pw_session_seeded__")) {
        localStorage.setItem("cc_admin_session", JSON.stringify(s));
        localStorage.setItem("__pw_session_seeded__", "1");
      }
    }, session);
  }

  return context;
}
