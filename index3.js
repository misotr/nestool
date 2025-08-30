'use strict';

// Default relays (NIP-50 対応リレーである必要があります)
const RELAYS = ['wss://relay.nostr.band'];

function $(sel) { return document.querySelector(sel); }
function create(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else if (c) el.appendChild(c);
  }
  return el;
}

function toHexFromNpub(npub) {
  const s = (npub || '').trim();
  if (s.startsWith('npub1')) {
    const { prefix, words } = bech32.decode(s);
    if (prefix !== 'npub') throw new Error('npub の接頭辞が不正です');
    const bytes = bech32.fromWords(words);
    if (bytes.length !== 32) throw new Error('npub の長さが不正です');
    return bech32.toHex(bytes);
  }
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  throw new Error('npub または 64 桁 hex を入力してください');
}

function parseAuthorsMulti(input) {
  const raw = (input || '').trim();
  if (!raw) return null; // optional
  const tokens = raw.split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
  const set = new Set();
  for (const t of tokens) set.add(t);
  const list = [];
  for (const t of set) list.push(toHexFromNpub(t));
  if (list.length === 0) return null;
  // NIP-01 relays often accept up to a few dozen authors; keep modest
  return list.slice(0, 40);
}

function parseDateToEpoch(input) {
  const s = (input || '').trim();
  if (!s) return null;
  // datetime-local yields "YYYY-MM-DDTHH:mm" (no timezone). Interpret as local time.
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error('日時の形式が不正です');
  return Math.floor(ms / 1000);
}

function fmtTime(ts) {
  try { return new Date(ts * 1000).toLocaleString(); } catch { return String(ts); }
}

function renderEvents(container, events) {
  container.textContent = '';
  for (const ev of events) {
    const meta = create('div', { className: 'meta mono' });
    const idShort = ev.id ? (ev.id.length > 12 ? ev.id.slice(0,12) + '…' : ev.id) : '';
    const pkShort = ev.pubkey ? (ev.pubkey.length > 12 ? ev.pubkey.slice(0,12) + '…' : ev.pubkey) : '';
    meta.append(
      create('span', {}, `time: ${fmtTime(ev.created_at)}`),
      create('span', {}, `kind: ${ev.kind}`),
      create('span', {}, `id: ${idShort}`),
      create('span', {}, `pubkey: ${pkShort}`),
    );

    const content = create('div', { className: 'content' });
    content.textContent = ev.content ?? '';

    const jsonToggle = create('details', { className: 'toggle' },
      create('summary', {}, 'JSON を表示'),
      create('pre', { className: 'json' }, JSON.stringify(ev, null, 2))
    );

    const box = create('div', { className: 'event' }, meta, content, jsonToggle);
    container.appendChild(box);
  }
}

async function queryNip50(relays, { search, authors, since, until }, limit = 50, timeoutMs = 12000, onProgress) {
  const subId = 's-' + Math.random().toString(36).slice(2, 10);
  const sockets = [];
  const events = new Map();
  const done = new Set();

  function finalize() {
    return Array.from(events.values())
      .sort((a,b) => (b.created_at||0) - (a.created_at||0))
      .slice(0, limit);
  }

  const filter = { kinds: [1], search, limit };
  if (authors && authors.length) filter.authors = authors;
  if (since != null) filter.since = since;
  if (until != null) filter.until = until;
  const reqMsg = JSON.stringify(['REQ', subId, filter]);

  await new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      for (const ws of sockets) try { ws.close(); } catch {}
      finished = true;
      resolve();
    }, timeoutMs);

    const tryResolve = () => {
      if (finished) return;
      if (done.size === relays.length) {
        finished = true;
        clearTimeout(timer);
        resolve();
      }
    };

    for (const url of relays) {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        done.add(url);
        onProgress && onProgress({ type: 'error', url, error: '接続できませんでした' });
        tryResolve();
        continue;
      }
      sockets.push(ws);
      ws.onopen = () => { ws.send(reqMsg); onProgress && onProgress({ type: 'open', url }); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (!Array.isArray(msg)) return;
          const [typ, sid, payload] = msg;
          if (sid !== subId) return;
          if (typ === 'EVENT') {
            const e = payload;
            if (e && typeof e.id === 'string') {
              events.set(e.id, e);
              onProgress && onProgress({ type: 'event', url, count: events.size });
            }
          } else if (typ === 'EOSE') {
            done.add(url);
            try { ws.close(); } catch {}
            onProgress && onProgress({ type: 'eose', url });
            tryResolve();
          }
        } catch {}
      };
      ws.onerror = () => { onProgress && onProgress({ type: 'error', url, error: 'エラー' }); };
      ws.onclose = () => { if (!done.has(url)) { done.add(url); tryResolve(); } };
    }
  });

  return finalize();
}

function setStatus(text) { const el = $('#status'); if (el) el.textContent = text || ''; }
function setErrors(text) { const el = $('#errors'); if (el) el.textContent = text || ''; }

window.addEventListener('DOMContentLoaded', () => {
  const form = $('#nip50-form');
  const keywordEl = $('#keyword');
  const authorsEl = $('#authors');
  const sinceEl = $('#since');
  const untilEl = $('#until');
  const submitBtn = $('#submit');
  const summary = $('#summary');
  const results = $('#results');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setErrors('');
    setStatus('');
    summary.textContent = '';
    results.textContent = '';

    let search, authors, since, until;
    try {
      search = (keywordEl.value || '').trim();
      if (!search) throw new Error('キーワードを入力してください');
      authors = parseAuthorsMulti(authorsEl.value);
      since = parseDateToEpoch(sinceEl.value);
      until = parseDateToEpoch(untilEl.value);
      if (since != null && until != null && since > until) {
        throw new Error('開始日時は終了日時より前にしてください');
      }
    } catch (err) {
      setErrors(err.message || String(err));
      return;
    }

    submitBtn.disabled = true;
    const start = Date.now();
    let lastCount = 0;
    setStatus('接続中…');

    try {
      const events = await queryNip50(
        RELAYS,
        { search, authors, since, until },
        50,
        12000,
        (p) => {
          if (p.type === 'event') { lastCount = p.count || lastCount; setStatus(`受信中… ${lastCount} 件`); }
          else if (p.type === 'open') setStatus('接続しました。受信中…');
          else if (p.type === 'eose') setStatus('受信完了待ち…');
          else if (p.type === 'error') setStatus(`一部リレーでエラー: ${p.url}`);
        }
      );

      const ms = Date.now() - start;
      const authorsPart = authors && authors.length ? `authors=${authors.length}件 ` : '';
      const rangePart = (since ? `since=${fmtTime(since)} ` : '') + (until ? `until=${fmtTime(until)} ` : '');
      summary.textContent = `条件: "${search}" ${authorsPart}${rangePart}| 取得 ${events.length} 件 | ${ms}ms`;
      renderEvents(results, events);
      setStatus('完了');
    } catch (err) {
      setErrors(err.message || String(err));
    } finally {
      submitBtn.disabled = false;
    }
  });
});

