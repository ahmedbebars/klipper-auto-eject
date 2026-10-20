/* klipper-auto-eject website: show the latest release on the home page. */
(function () {
  var API = "https://api.github.com/repos/ahmedbebars/klipper-auto-eject/releases?per_page=1";

  function show(rel) {
    var el = document.querySelector("[data-ae-release]");
    if (el && rel && rel.tag) {
      el.textContent = rel.tag;
      el.href = rel.url;
    }
  }

  function latest() {
    if (!document.querySelector("[data-ae-release]")) return;
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem("ae.release") || "null"); } catch (e) { cached = null; }
    if (cached) { show(cached); return; }
    fetch(API).then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      if (!list.length) return;
      var rel = { tag: list[0].tag_name, url: list[0].html_url };
      try { sessionStorage.setItem("ae.release", JSON.stringify(rel)); } catch (e) { /* private mode */ }
      show(rel);
    }).catch(function () { /* offline: keep the link to the releases page */ });
  }

  if (window.document$ && window.document$.subscribe) window.document$.subscribe(latest);
  else document.addEventListener("DOMContentLoaded", latest);
})();
