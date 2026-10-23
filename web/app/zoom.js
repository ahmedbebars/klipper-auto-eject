/* klipper-auto-eject web page. Pictures shown bigger under the mouse, anywhere on the page.
 */

import { h } from "./core.js";

/* ==================================================== pictures, bigger */

// A picture under the mouse shows bigger next to it, anywhere in the page:
// a file's thumbnail, a camera, a drawing. Only with a mouse: a finger
// opens what it touches. A picture already shown large is left as it is.
const zoom = { el: null, img: null, timer: 0, x: 0, y: 0 };
function zoomHide() {
  clearTimeout(zoom.timer);
  if (zoom.el) zoom.el.hidden = true;
}
function zoomPlace() {
  const el = zoom.el;
  if (!el || el.hidden) return;
  const gap = 18, edge = 12;
  let left = zoom.x + gap, top = zoom.y + gap;
  if (left + el.offsetWidth > innerWidth - edge) left = Math.max(edge, zoom.x - gap - el.offsetWidth);
  if (top + el.offsetHeight > innerHeight - edge) top = Math.max(edge, innerHeight - edge - el.offsetHeight);
  el.style.left = left + "px";
  el.style.top = top + "px";
}
function zoomShow(img) {
  if (!zoom.el) {
    zoom.img = h("img", { alt: "" });
    zoom.el = h("div", { class: "zoom-pop", "aria-hidden": "true", hidden: true }, zoom.img);
    zoom.img.addEventListener("load", zoomPlace);
    document.body.appendChild(zoom.el);
  }
  // the part's backdrop, as its thumbnail has it
  const thumb = img.closest(".thumb");
  zoom.el.className = "zoom-pop" + (thumb && thumb.classList.contains("ink-dark") ? " ink-dark" : thumb && thumb.classList.contains("ink-light") ? " ink-light" : "");
  zoom.img.src = img.currentSrc || img.src;
  zoom.img.style.width = Math.min(420, Math.max(240, img.naturalWidth || 420)) + "px";
  zoom.el.hidden = false;
  zoomPlace();
}
if (window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.addEventListener("mouseover", (e) => {
    const img = e.target instanceof HTMLImageElement ? e.target : null;
    if (!img || !img.src || img.closest(".zoom-pop, .top") || !img.complete) return;
    if (img.getBoundingClientRect().width >= 300) return;          // large already
    zoom.x = e.clientX;
    zoom.y = e.clientY;
    clearTimeout(zoom.timer);
    zoom.timer = setTimeout(() => zoomShow(img), 180);
  });
  document.addEventListener("mousemove", (e) => { zoom.x = e.clientX; zoom.y = e.clientY; zoomPlace(); }, { passive: true });
  document.addEventListener("mouseout", (e) => { if (e.target instanceof HTMLImageElement) zoomHide(); });
  document.addEventListener("mousedown", zoomHide);
  window.addEventListener("scroll", zoomHide, { capture: true, passive: true });
  window.addEventListener("hashchange", zoomHide);
}
