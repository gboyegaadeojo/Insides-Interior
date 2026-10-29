/* global localStorage, location, navigator, Blob, document, URL, console */
// SPEC 12.1 step 3: the old app silently saved to this browser when Firestore
// failed, so some records may exist only here. On EACH device the old app was
// used on: open the old app, sign in, open the browser's developer console
// (desktop: F12; iPad/iPhone: connect to a Mac and use Safari > Develop),
// paste everything below and press Enter. A file named
// insides-browser-export-<date>.json downloads. Nothing is changed or sent.
(() => {
  const keys = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("invoiceos_demo_")) keys[key] = localStorage.getItem(key);
  }
  const data = {
    source: "browser",
    exportedAt: new Date().toISOString(),
    origin: location.origin,
    userAgent: navigator.userAgent,
    keys,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `insides-browser-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log(`Exported ${Object.keys(keys).length} keys:`, Object.keys(keys));
})();
