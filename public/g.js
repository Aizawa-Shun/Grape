/**
 * Grape tracking snippet. Served as a static file so it works even if the
 * Next.js app it came from is later swapped out from under it — nothing here
 * imports from the app.
 *
 * Usage (generated per-product on the product page):
 *
 *   <script>window.grape=window.grape||function(){(window.grape.q=window.grape.q||[]).push(arguments)}</script>
 *   <script async src="https://<ingest-host>/g.js" data-product="<productId>"></script>
 *
 * A pageview is sent automatically. For the Activate stage of the funnel,
 * call the key event the product owner picked on the dashboard:
 *
 *   grape('track', 'signup')
 */
(function () {
  "use strict";

  var doc = document;
  var win = window;

  // document.currentScript is null by the time an async script's own body
  // finishes in some old WebKit builds; capture it before anything else runs.
  var thisScript = doc.currentScript;
  if (!thisScript) return;

  var productId = thisScript.getAttribute("data-product");
  if (!productId) return;

  // The collect endpoint lives on the same origin this script was loaded
  // from, so nothing here needs to know INGEST_BASE_URL — it already ran the
  // resolution once, to fetch g.js itself.
  var collectUrl = new URL("/api/collect", thisScript.src).toString();

  var ANON_KEY = "grape_anon_id";
  var SESSION_KEY = "grape_session";
  var SESSION_TIMEOUT_MS = 30 * 60 * 1000;

  function uuid() {
    if (win.crypto && win.crypto.randomUUID) return win.crypto.randomUUID();
    // Good enough for an anonymous device id; this is not a security token.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function readStorage(storage, key) {
    try {
      return storage.getItem(key);
    } catch (e) {
      // Safari private mode and similar throw on access, not just quota.
      return null;
    }
  }

  function writeStorage(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (e) {
      // Ignore — tracking degrades to session-less rather than breaking the host page.
    }
  }

  function getAnonId() {
    var existing = readStorage(win.localStorage, ANON_KEY);
    if (existing) return existing;
    var id = uuid();
    writeStorage(win.localStorage, ANON_KEY, id);
    return id;
  }

  /**
   * A session id that survives navigations within one visit but starts over
   * after 30 minutes of inactivity — the conventional definition, and the one
   * the funnel's Visit/Engage stages are computed against.
   */
  function getSessionId() {
    var now = Date.now();
    var raw = readStorage(win.sessionStorage, SESSION_KEY);
    if (raw) {
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        parsed = null;
      }
      if (parsed && now - parsed.lastSeen < SESSION_TIMEOUT_MS) {
        writeStorage(win.sessionStorage, SESSION_KEY, JSON.stringify({ id: parsed.id, lastSeen: now }));
        return parsed.id;
      }
    }
    var id = uuid();
    writeStorage(win.sessionStorage, SESSION_KEY, JSON.stringify({ id: id, lastSeen: now }));
    return id;
  }

  function utmParams() {
    var out = {};
    var search;
    try {
      search = new URLSearchParams(win.location.search);
    } catch (e) {
      return out;
    }
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(function (key) {
      var value = search.get(key);
      if (value) out[key] = value;
    });
    return out;
  }

  function send(name, props) {
    var payload = {
      productId: productId,
      anonId: getAnonId(),
      sessionId: getSessionId(),
      name: name,
      path: win.location.pathname,
      referrer: doc.referrer || null,
      utm: utmParams(),
      props: props || undefined,
      ts: Date.now(),
    };

    var body = JSON.stringify(payload);

    // text/plain keeps this a CORS-simple request — no preflight, and the
    // ingest endpoint parses the body as JSON regardless of the declared
    // content type. sendBeacon also survives the page unloading immediately
    // after, which matters for the pageview-then-navigate case.
    if (win.navigator && win.navigator.sendBeacon) {
      try {
        win.navigator.sendBeacon(collectUrl, new Blob([body], { type: "text/plain" }));
        return;
      } catch (e) {
        // fall through to fetch
      }
    }

    if (win.fetch) {
      win.fetch(collectUrl, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "text/plain" },
        keepalive: true,
        mode: "cors",
      }).catch(function () {});
    }
  }

  function grape(command, name, props) {
    if (command === "track" && typeof name === "string") send(name, props);
  }

  // Replace the queueing stub (if the host page set one up) and flush
  // whatever was called before this script finished loading.
  var queued = (win.grape && win.grape.q) || [];
  win.grape = grape;
  for (var i = 0; i < queued.length; i++) {
    grape.apply(null, queued[i]);
  }

  send("pageview");
})();
