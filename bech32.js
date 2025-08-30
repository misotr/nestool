// Minimal bech32 decoder (BIP-0173) with fromWords helper for npub decoding
// Supports decoding strings like npub1... into bytes; no encoding is implemented.
(function (global) {
  'use strict';

  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const CHARKEY = (() => {
    const map = Object.create(null);
    for (let i = 0; i < CHARSET.length; i++) map[CHARSET[i]] = i;
    return map;
  })();

  function polymod(values) {
    const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (let p = 0; p < values.length; p++) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[p];
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATORS[i];
    }
    return chk >>> 0;
  }

  function hrpExpand(hrp) {
    const ret = [];
    for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >>> 5);
    ret.push(0);
    for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
    return ret;
  }

  function verifyChecksum(hrp, data) {
    return polymod(hrpExpand(hrp).concat(data)) === 1;
  }

  function decode(str) {
    if (typeof str !== 'string') throw new Error('bech32: input must be string');
    const lower = str.toLowerCase();
    if (str !== lower && str !== str.toUpperCase()) throw new Error('bech32: mixed case');
    const s = lower;
    const pos = s.lastIndexOf('1');
    if (pos < 1) throw new Error('bech32: missing hrp separator');
    if (pos + 7 > s.length) throw new Error('bech32: too short data');
    const hrp = s.slice(0, pos);
    const data = [];
    for (let i = pos + 1; i < s.length; i++) {
      const c = s[i];
      if (!(c in CHARKEY)) throw new Error('bech32: invalid char');
      data.push(CHARKEY[c]);
    }
    if (!verifyChecksum(hrp, data)) throw new Error('bech32: invalid checksum');
    return { prefix: hrp, words: data.slice(0, -6) };
  }

  // Convert between bit groups, used for 5-bit words to 8-bit bytes, and vice versa.
  function convertBits(data, from, to, pad) {
    let acc = 0;
    let bits = 0;
    const ret = [];
    const maxv = (1 << to) - 1;
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (value < 0 || value >>> from !== 0) throw new Error('bech32: invalid value');
      acc = (acc << from) | value;
      bits += from;
      while (bits >= to) {
        bits -= to;
        ret.push((acc >>> bits) & maxv);
      }
    }
    if (pad) {
      if (bits > 0) ret.push((acc << (to - bits)) & maxv);
    } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
      throw new Error('bech32: excess padding');
    }
    return ret;
  }

  function fromWords(words) {
    return Uint8Array.from(convertBits(words, 5, 8, false));
  }

  function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Encoding helpers (minimal) — add to support npub encoding
  function toWords(bytes) {
    return convertBits(Array.from(bytes), 8, 5, true);
  }

  function createChecksum(hrp, data) {
    const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const mod = polymod(values) ^ 1;
    const ret = [];
    for (let p = 0; p < 6; p++) ret.push((mod >>> (5 * (5 - p))) & 31);
    return ret;
  }

  function encode(hrp, words) {
    const combined = words.concat(createChecksum(hrp, words));
    let out = hrp + '1';
    for (let i = 0; i < combined.length; i++) out += CHARSET[combined[i]];
    return out;
  }

  function fromHex(hex) {
    if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2) throw new Error('bech32: invalid hex');
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return arr;
  }

  const api = { decode, fromWords, toHex, toWords, encode, fromHex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.bech32 = api;
})(typeof window !== 'undefined' ? window : globalThis);
