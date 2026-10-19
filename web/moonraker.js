/* klipper-auto-eject web page: a small Moonraker client.
 *
 * JSON-RPC over the Moonraker websocket, plus plain HTTP for file reads.
 * The page is served by the same nginx as Mainsail or Fluidd, so it talks
 * to Moonraker through the same /websocket and /server paths.
 */
"use strict";

(function (root) {
  function Moonraker(base) {
    // base: "" for the same host, or "http://printer.local:7125"
    this.base = base || "";
    this.ws = null;
    this.id = 1;
    this.waiting = new Map();
    this.handlers = {};
    this.open = false;
    this.retry = 0;
    this.closedByUs = false;
  }

  Moonraker.prototype.on = function (event, fn) {
    (this.handlers[event] = this.handlers[event] || []).push(fn);
  };

  Moonraker.prototype.emit = function (event, data) {
    for (const fn of this.handlers[event] || []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  };

  Moonraker.prototype.wsUrl = function () {
    if (this.base) return this.base.replace(/^http/, "ws").replace(/\/$/, "") + "/websocket";
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + "/websocket";
  };

  Moonraker.prototype.connect = function () {
    this.closedByUs = false;
    let ws;
    try { ws = new WebSocket(this.wsUrl()); }
    catch (e) { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.retry = 0;
      this.emit("open");
    };
    ws.onclose = () => {
      const was = this.open;
      this.open = false;
      for (const [, w] of this.waiting) w.reject(new Error("connection closed"));
      this.waiting.clear();
      if (was) this.emit("close");
      else this.whyNot();
      if (!this.closedByUs) this.scheduleReconnect();
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id !== undefined && this.waiting.has(msg.id)) {
        const w = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) w.reject(new Error(msg.error.message || String(msg.error.code)));
        else w.resolve(msg.result);
      } else if (msg.method) {
        this.emit(msg.method, msg.params || []);
      }
    };
  };

  // A browser that is not a trusted client is turned away before the
  // websocket opens; plain HTTP says why.
  Moonraker.prototype.whyNot = function () {
    fetch(this.base + "/server/info", { cache: "no-store" }).then((r) => {
      if (r.status === 401 || r.status === 403) this.emit("unauthorized");
    }).catch(() => {});
  };

  Moonraker.prototype.scheduleReconnect = function () {
    const delay = Math.min(10000, 1000 * Math.pow(1.6, this.retry++));
    setTimeout(() => this.connect(), delay);
  };

  Moonraker.prototype.call = function (method, params) {
    if (!this.open) return Promise.reject(new Error("not connected"));
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params: params || {}, id }));
    });
  };

  // Run G-code. Moonraker answers when the command has finished, which for
  // AUTO_EJECT can be many minutes, so callers should not wait on it.
  Moonraker.prototype.gcode = function (script) {
    return this.call("printer.gcode.script", { script });
  };

  Moonraker.prototype.fetchText = function (path, range) {
    const headers = {};
    if (range) headers.Range = "bytes=" + range;
    return fetch(this.base + path, { headers, cache: "no-store" }).then((r) => {
      if (!r.ok && r.status !== 206) throw new Error("HTTP " + r.status);
      return r.text();
    });
  };

  root.Moonraker = Moonraker;
})(window);
