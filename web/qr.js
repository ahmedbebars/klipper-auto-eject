/* klipper-auto-eject web page: QR codes, made in the page.
 *
 * The farm prints a label for each printer: its name and a QR code of its
 * page, so a phone camera opens it. Made here, offline, with no library:
 * byte mode, versions 1 to 40, error correction L, M, Q or H, the mask
 * picked by the standard's penalty rules (ISO/IEC 18004).
 * tests/test_qr.py checks the codes against a reference encoder.
 */
"use strict";

(function (root) {
  const LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
  const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  // error correction codewords in each block, and how many blocks, for
  // each level (L, M, Q, H) and version (1 to 40)
  const ECC_PER_BLOCK = [
    [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  const BLOCKS = [
    [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  // the codewords a version holds, data and error correction together
  function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const align = Math.floor(ver / 7) + 2;
      n -= (25 * align - 10) * align - 55;
      if (ver >= 7) n -= 36;
    }
    return n;
  }
  function dataCodewords(ver, level) {
    const l = LEVELS[level];
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[l][ver - 1] * BLOCKS[l][ver - 1];
  }

  // where the alignment patterns sit along each side
  function alignments(ver) {
    if (ver === 1) return [];
    const count = Math.floor(ver / 7) + 2;
    const size = ver * 4 + 17;
    const step = ver === 32 ? 26 : Math.ceil((size - 13) / (count * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  /* --------------------------------------------- Reed-Solomon, in GF(256) */

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function rsDivisor(degree) {
    const out = new Array(degree).fill(0);
    out[degree - 1] = 1;
    let r = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        out[j] = gfMul(out[j], r);
        if (j + 1 < degree) out[j] ^= out[j + 1];
      }
      r = gfMul(r, 2);
    }
    return out;
  }
  function rsRemainder(data, divisor) {
    const out = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ out.shift();
      out.push(0);
      divisor.forEach((c, i) => { out[i] ^= gfMul(c, factor); });
    }
    return out;
  }

  /* ------------------------------------------------------------ the data */

  function utf8(text) {
    const out = [];
    for (const ch of String(text)) {
      let c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  // the smallest version that holds the bytes, then the codewords: mode,
  // length, the bytes, the end, padding, split in blocks with their
  // error correction, interleaved
  function codewords(bytes, level, minVersion) {
    let ver = Math.max(1, minVersion || 1);
    for (; ver <= 40; ver++) {
      const bits = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
      if (bits <= dataCodewords(ver, level) * 8) break;
    }
    if (ver > 40) throw new Error("too long for a QR code");
    const cap = dataCodewords(ver, level) * 8;
    const bits = [];
    const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    put(4, 4);
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    const l = LEVELS[level];
    const blocks = BLOCKS[l][ver - 1];
    const eccLen = ECC_PER_BLOCK[l][ver - 1];
    const raw = Math.floor(rawModules(ver) / 8);
    const short = blocks - raw % blocks;
    const shortLen = Math.floor(raw / blocks);
    const divisor = rsDivisor(eccLen);
    const parts = [];
    for (let i = 0, k = 0; i < blocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, divisor);
      if (i < short) dat.push(null);                // short blocks line up with the long ones
      parts.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < parts[0].length; i++) {
      parts.forEach((p, j) => { if (i !== shortLen - eccLen || j >= short) out.push(p[i]); });
    }
    return { version: ver, words: out };
  }

  /* ---------------------------------------------------------- the matrix */

  function drawFixed(m, fixed, ver) {
    const size = m.length;
    const set = (x, y, dark) => { m[y][x] = dark ? 1 : 0; fixed[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, d !== 2 && d !== 4);
        }
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignments(ver);
    al.forEach((ax, i) => al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));
    drawFormat(m, fixed, "M", 0);                    // reserved now, written with the mask
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = (bits >>> i) & 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
        set(a, b, dark);
        set(b, a, dark);
      }
    }
  }

  function drawFormat(m, fixed, level, mask) {
    const size = m.length;
    const val = (FORMAT_BITS[level] << 3) | mask;
    let rem = val;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((val << 10) | rem) ^ 0x5412;
    const set = (x, y, i) => { m[y][x] = (bits >>> i) & 1; fixed[y][x] = true; };
    for (let i = 0; i <= 5; i++) set(8, i, i);
    set(8, 7, 6); set(8, 8, 7); set(7, 8, 8);
    for (let i = 9; i < 15; i++) set(14 - i, 8, i);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
    m[size - 8][8] = 1;                               // the dark module
    fixed[size - 8][8] = true;
  }

  // the codewords in the zigzag, two columns at a time from the bottom right
  function drawData(m, fixed, words) {
    const size = m.length;
    let i = 0;
    const bitCount = words.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fixed[y][x] && i < bitCount) {
            m[y][x] = (words[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
  ];
  function applyMask(m, fixed, mask) {
    const f = MASKS[mask];
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m.length; x++) if (!fixed[y][x] && f(x, y)) m[y][x] ^= 1;
    }
  }

  // the standard's four penalties: runs of one colour, 2 x 2 blocks, the
  // finder look-alike 1:1:3:1:1 with four light on one side, and the
  // balance of dark and light
  function penalty(m) {
    const size = m.length;
    let score = 0, dark = 0;
    const line = (get) => {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && get(i) === get(i - 1)) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      // past the edge is the quiet zone: light
      const light = (k) => k < 0 || k >= size || !get(k);
      for (let i = 0; i + 7 <= size; i++) {
        if (get(i) && light(i + 1) && get(i + 2) && get(i + 3) && get(i + 4) && light(i + 5) && get(i + 6) &&
            ([1, 2, 3, 4].every((k) => light(i - k)) || [7, 8, 9, 10].every((k) => light(i + k)))) score += 40;
      }
    };
    for (let y = 0; y < size; y++) line((x) => m[y][x]);
    for (let x = 0; x < size; x++) line((y) => m[y][x]);
    for (let y = 0; y + 1 < size; y++) {
      for (let x = 0; x + 1 < size; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    m.forEach((row) => row.forEach((c) => { dark += c; }));
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  }

  // A QR code of the text: { version, level, mask, size, modules } where
  // modules[y][x] is 1 for dark. Options: level ("M"), version (the
  // smallest it fits), mask (the one with the lowest penalty).
  function qrEncode(text, opts) {
    opts = opts || {};
    const level = LEVELS[opts.level] !== undefined ? opts.level : "M";
    const { version, words } = codewords(utf8(text), level, opts.version);
    const size = version * 4 + 17;
    const grid = () => Array.from({ length: size }, () => new Array(size).fill(0));
    const base = grid();
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    drawFixed(base, fixed, version);
    drawData(base, fixed, words);
    const make = (mask) => {
      const m = base.map((row) => row.slice());
      applyMask(m, fixed, mask);
      drawFormat(m, fixed, level, mask);
      return m;
    };
    let mask = typeof opts.mask === "number" && opts.mask >= 0 && opts.mask < 8 ? opts.mask : -1;
    let modules;
    if (mask < 0) {
      let best = Infinity;
      for (let k = 0; k < 8; k++) {
        const m = make(k), p = penalty(m);
        if (p < best) { best = p; mask = k; modules = m; }
      }
    } else modules = make(mask);
    return { version, level, mask, size, modules };
  }

  // The dark modules as one SVG path, a module a unit, with a quiet zone
  // of `border` modules around (4 by the standard).
  function qrPath(qr, border) {
    const b = border === undefined ? 4 : border;
    let d = "";
    qr.modules.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (!row[x]) continue;
        let w = 1;
        while (x + w < row.length && row[x + w]) w++;
        d += "M" + (x + b) + " " + (y + b) + "h" + w + "v1h-" + w + "z";
        x += w - 1;
      }
    });
    return { d, size: qr.size + 2 * b };
  }

  const api = { qrEncode, qrPath, qrPenalty: penalty, qrCapacity: dataCodewords };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AEQr = api;
})(typeof window !== "undefined" ? window : this);
