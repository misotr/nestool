'use strict';

// Utilities
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

function toHex(bytes) { return bech32.toHex(bytes); }
function toNpubFromHex(hex) {
  const bytes = bech32.fromHex(hex);
  const words = bech32.toWords(bytes);
  return bech32.encode('npub', words);
}
function hashRelays(relays) {
  // djb2 hash
  let h = 5381;
  for (const s of relays.join(',')) h = ((h << 5) + h) + s.charCodeAt(0);
  return (h >>> 0).toString(16);
}

// Persistence
const STORAGE_KEY = 'nostr-event-search-viewer.form';
function loadFormState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch {}
  return null;
}
function saveFormState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// Validation & decoding
function parseRelays(input) {
  const parts = input
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
  const urls = Array.from(new Set(parts));
  const re = /^wss:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
  for (const u of urls) if (!re.test(u)) throw new Error(`不正な Relay URL: ${u}`);
  if (urls.length === 0) throw new Error('Relay を 1 件以上入力してください');
  if (urls.length > 5) throw new Error('Relay は最大 5 件までにしてください');
  return urls;
}

function decodeAuthor(input) {
  const s = input.trim();
  if (s === '') return null; // optional author
  if (s.startsWith('npub1')) {
    const { prefix, words } = bech32.decode(s);
    if (prefix !== 'npub') throw new Error('npub の接頭辞が不正です');
    const bytes = bech32.fromWords(words);
    if (bytes.length !== 32) throw new Error('npub の長さが不正です');
    return toHex(bytes);
  }
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  throw new Error('公開鍵は npub もしくは 64 桁 hex で入力してください');
}

function parseKind(input) {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 0) throw new Error('kind は 0 以上の整数で入力してください');
  return n;
}

function parseTagFilter(nameInput, valueInput) {
  const name = (nameInput || '').trim();
  const value = (valueInput || '').trim();
  if (name === '' && value === '') return null; // optional
  if (name === '' || value === '') throw new Error('タグ名とタグ値はセットで入力してください');
  if (!/^[a-z]$/.test(name)) throw new Error('タグ名は英小文字 1 文字で入力してください（例: g）');
  return { name, value };
}

// WebSocket Nostr query
async function queryRelays(relays, authorHex, kind, tagFilter, limit = 20, timeoutMs = 10000, onProgress) {
  const subId = 'sub-' + Math.random().toString(36).slice(2, 10);
  const events = new Map();
  const done = new Set();
  const sockets = [];

  function finalize() {
    const list = Array.from(events.values()).sort((a, b) => b.created_at - a.created_at).slice(0, limit);
    return list;
  }
  
  const filter = { kinds: [kind], limit };
  if (authorHex) filter.authors = [authorHex];
  if (tagFilter) filter['#' + tagFilter.name] = [tagFilter.value];
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
      } catch (e) {
        done.add(url);
        onProgress && onProgress({ type: 'error', url, error: '接続できませんでした' });
        tryResolve();
        continue;
      }
      sockets.push(ws);
      ws.onopen = () => {
        ws.send(reqMsg);
        onProgress && onProgress({ type: 'open', url });
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (!Array.isArray(msg)) return;
          const [typ, sid, payload] = msg;
          if (sid !== subId) return;
          if (typ === 'EVENT') {
            const ev = payload;
            if (ev && typeof ev.id === 'string') {
              events.set(ev.id, ev);
              onProgress && onProgress({ type: 'event', url, count: events.size });
            }
          } else if (typ === 'EOSE') {
            done.add(url);
            try { ws.close(); } catch {}
            onProgress && onProgress({ type: 'eose', url });
            tryResolve();
          }
        } catch {
          // ignore malformed message
        }
      };
      ws.onerror = () => {
        onProgress && onProgress({ type: 'error', url, error: 'エラーが発生しました' });
      };
      ws.onclose = () => {
        if (!done.has(url)) {
          done.add(url);
          tryResolve();
        }
      };
    }
  });

  return finalize();
}

// Rendering
function shorten(str, n = 12) { return str.length > n ? str.slice(0, n) + '…' : str; }
function fmtTime(ts) {
  try { return new Date(ts * 1000).toLocaleString(); } catch { return String(ts); }
}

function renderEvents(container, events) {
  container.textContent = '';
  for (const ev of events) {
    const meta = create('div', { className: 'meta mono' });
    const idShort = shorten(ev.id);
    const pkShort = shorten(ev.pubkey);
    meta.append(
      create('span', {}, `time: ${fmtTime(ev.created_at)}`),
      create('span', {}, `kind: ${ev.kind}`),
      create('span', {}, `id: ${idShort}`),
      create('span', {}, `pubkey: ${pkShort}`)
    );

    const content = create('div', { className: 'content' });
    content.textContent = ev.content ?? '';

    const tags = create('div', { className: 'tags mono' });
    try { tags.textContent = Array.isArray(ev.tags) ? ev.tags.map(t => JSON.stringify(t)).join('\n') : ''; }
    catch { tags.textContent = ''; }

    const jsonToggle = create('details', { className: 'toggle' },
      create('summary', {}, 'JSON を表示'),
      create('pre', { className: 'json' }, JSON.stringify(ev, null, 2))
    );

    const box = create('div', { className: 'event' }, meta, content, tags, jsonToggle);
    container.appendChild(box);
  }
}

function setStatus(text) { $('#status').textContent = text; }
function setErrors(err) { $('#errors').textContent = err || ''; }

// Wire up form
window.addEventListener('DOMContentLoaded', () => {
  const form = $('#search-form');
  const submitBtn = $('#submit');
  const results = $('#results');
  const summary = $('#summary');
  const authorEl = $('#author');
  const kindEl = $('#kind');
  const relaysEl = $('#relays');
  const tagNameEl = $('#tag-name');
  const tagValueEl = $('#tag-value');
  const loginStatus = $('#login-status');
  const nostrLoginEl = document.querySelector('nostr-login');
  const loadFollowingsBtn = $('#load-followings');
  const followingsList = $('#followings-list');
  const followingsStatus = $('#followings-status');
  let selectedFollowingHex = null;

  // Simple login state
  const LOGIN_KEY = 'nostr-event-search-viewer.login';
  function loadLogin() {
    try {
      const raw = localStorage.getItem(LOGIN_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (v && typeof v.pkHex === 'string' && /^[0-9a-f]{64}$/.test(v.pkHex)) return v;
    } catch {}
    return null;
  }
  function saveLogin(v) {
    try { localStorage.setItem(LOGIN_KEY, JSON.stringify(v)); } catch {}
  }
  function clearLogin() { try { localStorage.removeItem(LOGIN_KEY); } catch {} }

  let loginState = loadLogin();
  function updateLoginStatus() {
    if (!loginStatus) return;
    if (loginState && loginState.npub) {
      loginStatus.textContent = `ログイン中: ${loginState.npub.slice(0,12)}…`;
    } else {
      loginStatus.textContent = '未ログイン';
    }
  }
  updateLoginStatus();

  async function setLoginFromHex(pkHex, method) {
    if (!/^[0-9a-f]{64}$/.test(pkHex)) throw new Error('公開鍵が不正です');
    const npub = toNpubFromHex(pkHex);
    loginState = { pkHex, npub, method };
    saveLogin(loginState);
    updateLoginStatus();
    if (typeof updateAuthControls === 'function') updateAuthControls();
  }
  
  // nostr-login integration
  async function tryAdoptNostrLogin(detail) {
    try {
      let input = undefined;
      if (detail && typeof detail === 'object') {
        input = detail.pubkey || detail.publicKey; // 標準化された名前をチェック
      }
      if (!input && nostrLoginEl && typeof nostrLoginEl.pubkey === 'string') {
        input = nostrLoginEl.pubkey;
      }
      if (typeof input !== 'string' || input.length === 0) {
        return; // 何もすることがない
      }
      let pkHex = null;
      // normalize
      input = input.trim();
      if (input.startsWith('0x') || input.startsWith('0X')) {
        input = input.slice(2); // 0x を取り除く
      }
      // accept hex (case-insensitive)
      if (/^[0-9a-fA-F]{64}$/.test(input)) {
        pkHex = input.toLowerCase();
      } else if (input.startsWith('npub1')) {
        try {
          const { prefix, words } = bech32.decode(input);
          if (prefix !== 'npub') throw new Error('npub の接頭辞が不正です');
          const bytes = bech32.fromWords(words);
          if (bytes.length !== 32) throw new Error('npub の長さが不正です');
          pkHex = toHex(bytes);
        } catch (err) {
          throw new Error('npub のデコードに失敗しました: ' + err.message);
        }
      } else {
        throw new Error('公開鍵は npub もしくは 64 桁 hex で入力してください');
      }
      if (pkHex) {
        await setLoginFromHex(pkHex, 'nostr-login');
      }
    } catch (e) {
      // swallow and show as non-blocking error
      setErrors(e.message || String(e));
    }
  }
  if (nostrLoginEl) {
    nostrLoginEl.addEventListener('login', (e) => tryAdoptNostrLogin(e.detail));
    nostrLoginEl.addEventListener('logout', () => { loginState = null; clearLogin(); updateLoginStatus(); });
    // some implementations dispatch custom names
    nostrLoginEl.addEventListener('nostr-login', (e) => tryAdoptNostrLogin(e.detail));
    nostrLoginEl.addEventListener('nostr-login:success', (e) => tryAdoptNostrLogin(e.detail));
    // attempt to read initial state if already logged
    setTimeout(() => { tryAdoptNostrLogin(null); }, 0);

  }

  // Show explicit auth controls only if the nostr-login element is not available
  let updateAuthControls = null;
  (function setupAuthFallbackControls() {
    const hasElement = (typeof customElements !== 'undefined') && customElements.get && customElements.get('nostr-login');
    if (hasElement) return; // nostr-login (real or shim) handles UI
    const host = nostrLoginEl && nostrLoginEl.parentElement ? nostrLoginEl.parentElement : (loginStatus && loginStatus.parentElement ? loginStatus.parentElement : document.body);
    const wrap = create('div', { id: 'auth-fallback', style: 'display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; align-items:center;' });
    const loginBtnFB = create('button', { id: 'nip07-fallback-login', type: 'button' }, 'NIP-07 でログイン');
    const logoutBtn = create('button', { id: 'logout-btn', type: 'button' }, 'ログアウト');

    loginBtnFB.addEventListener('click', async () => {
      setErrors('');
      try {
        if (!window.nostr || typeof window.nostr.getPublicKey !== 'function') {
          setErrors('NIP-07 拡張が見つかりません（拡張を有効にしてください）');
          return;
        }
        const pkHex = await window.nostr.getPublicKey();
        await setLoginFromHex(pkHex, 'nip07-fallback');
      } catch (e) { setErrors(e.message || String(e)); }
    });
    logoutBtn.addEventListener('click', () => { loginState = null; clearLogin(); updateLoginStatus(); if (typeof updateAuthControls === 'function') updateAuthControls(); });

    wrap.appendChild(loginBtnFB);
    wrap.appendChild(logoutBtn);
    if (nostrLoginEl) nostrLoginEl.insertAdjacentElement('afterend', wrap);
    else if (host) host.appendChild(wrap);

    updateAuthControls = () => {
      const loggedIn = !!(loginState && loginState.npub);
      loginBtnFB.style.display = loggedIn ? 'none' : '';
      logoutBtn.style.display = loggedIn ? '' : 'none';
    };
    updateAuthControls();
  })();

  // Load previous values if available
  const saved = loadFormState();
  if (saved) {
    if (typeof saved.author === 'string') authorEl.value = saved.author;
    if (typeof saved.kind === 'string') kindEl.value = saved.kind;
    if (typeof saved.relays === 'string' && saved.relays.trim()) relaysEl.value = saved.relays;
    if (tagNameEl && typeof saved.tagName === 'string') tagNameEl.value = saved.tagName;
    if (tagValueEl && typeof saved.tagValue === 'string') tagValueEl.value = saved.tagValue;
    // followSource is no longer user-provided; fixed bot npub is used
  }

  const commitSave = () => saveFormState({
    author: authorEl.value || '',
    kind: kindEl.value || '',
    relays: relaysEl.value || '',
    tagName: tagNameEl ? (tagNameEl.value || '') : '',
    tagValue: tagValueEl ? (tagValueEl.value || '') : '',
  });

  // Save on input changes
  for (const el of [authorEl, kindEl, relaysEl, tagNameEl, tagValueEl]) {
    if (!el) continue;
    el.addEventListener('input', commitSave);
    el.addEventListener('change', commitSave);
  }

  // Followings loader (kind=3)
  function setFollowingsStatus(text) { if (followingsStatus) followingsStatus.textContent = text || ''; }
  function hexToNpub(hex) {
    try { return toNpubFromHex(hex); } catch { return null; }
  }
  function parseProfile(ev) {
    if (!ev || typeof ev.content !== 'string') return {};
    try {
      const j = JSON.parse(ev.content);
      return {
        display: typeof j.display_name === 'string' && j.display_name.trim() ? j.display_name.trim() : '',
        nick: typeof j.name === 'string' && j.name.trim() ? j.name.trim() : '',
        picture: typeof j.picture === 'string' ? j.picture : '',
      };
    } catch { return {}; }
  }
  async function fetchProfileFor(hex, relays) {
    try {
      const evs = await queryRelays(relays, hex, 0, null, 1, 6000, null);
      return parseProfile(evs[0]);
    } catch { return {}; }
  }
  // Caches
  const FOLLOW_TTL = 86400 * 1000;
  const PROFILE_TTL = 86400 * 1000;
  function loadFollowingsCache(srcHex, relays) {
    try {
      const key = `nostr-esv.followings.${srcHex}.${hashRelays(relays)}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.items) || typeof obj.fetchedAt !== 'number') return null;
      if (Date.now() - obj.fetchedAt > FOLLOW_TTL) return null;
      return obj.items;
    } catch { return null; }
  }
  function saveFollowingsCache(srcHex, relays, items) {
    try {
      const key = `nostr-esv.followings.${srcHex}.${hashRelays(relays)}`;
      localStorage.setItem(key, JSON.stringify({ items, fetchedAt: Date.now() }));
    } catch {}
  }
  function loadProfileCache(hex) {
    try {
      const key = `nostr-esv.profiles.${hex}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.fetchedAt !== 'number') return null;
      if (Date.now() - obj.fetchedAt > PROFILE_TTL) return null;
      return obj;
    } catch { return null; }
  }
  function saveProfileCache(hex, prof) {
    try {
      const key = `nostr-esv.profiles.${hex}`;
      localStorage.setItem(key, JSON.stringify({ ...prof, fetchedAt: Date.now() }));
    } catch {}
  }

  async function loadFollowings() {
    setErrors('');
    setFollowingsStatus('');
    if (!followingsList) return;
    let sourceHex, relays;
    try {
      if (!loginState || !loginState.pkHex) throw new Error('先にログインしてください');
      sourceHex = loginState.pkHex;
      relays = parseRelays(relaysEl.value);
    } catch (e) {
      setErrors(e.message || String(e));
      return;
    }
    setFollowingsStatus('取得中…');
    try {
      let keys = loadFollowingsCache(sourceHex, relays);
      if (!keys) {
        const events = await queryRelays(relays, sourceHex, 3, null, 1, 10000, null);
        const latest = events[0];
        const set = new Set();
        if (latest && Array.isArray(latest.tags)) {
          for (const t of latest.tags) if (Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string') set.add(t[1]);
        }
        keys = Array.from(set);
        saveFollowingsCache(sourceHex, relays, keys);
      }
      const limit = Math.min(50, keys.length);
      const list = [];
      for (let i = 0; i < limit; i++) {
        const hex = keys[i];
        let prof = loadProfileCache(hex);
        if (!prof) {
          prof = await fetchProfileFor(hex, relays);
          saveProfileCache(hex, prof);
        }
        list.push({ hex, ...prof });
      }
      followingsList.textContent = '';
      selectedFollowingHex = null;
      const makeItem = (ent) => {
        const img = create('img', { src: ent.picture || '', alt: '' });
        img.onerror = () => { img.style.display = 'none'; };
        const display = ent.display || ent.nick || '(no name)';
        const nick = ent.nick ? ent.nick : '';
        const names = create('span', { className: 'names' },
          create('span', { className: 'display' }, display),
          nick ? create('span', { className: 'nick' }, `(${nick})`) : ''
        );
        const btn = create('button', { type: 'button', className: 'follow-item' }, img, names);
        btn.addEventListener('click', () => {
          selectedFollowingHex = ent.hex;
          // toggle selected
          for (const child of followingsList.children) child.classList.remove('selected');
          btn.classList.add('selected');
        });
        return btn;
      };
      for (const ent of list) followingsList.appendChild(makeItem(ent));
      setFollowingsStatus(`取得 ${list.length} 件`);
    } catch (e) {
      setFollowingsStatus('取得失敗');
      setErrors(e.message || String(e));
    }
  }

  if (loadFollowingsBtn) loadFollowingsBtn.addEventListener('click', loadFollowings);
  const setFromFollowingsBtn = $('#set-author-from-followings');
  if (setFromFollowingsBtn) setFromFollowingsBtn.addEventListener('click', () => {
    setErrors('');
    if (!selectedFollowingHex) { setErrors('フォロー取得後、ユーザを選択してください'); return; }
    authorEl.value = selectedFollowingHex; // set hex (npub表示は不要のため)
    commitSave();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setErrors('');
    setStatus('');
    results.textContent = '';
    summary.textContent = '';

    let authorHex, kind, relays, tagFilter;
    try {
      // Save before parsing so user input persists even if invalid
      commitSave();
      authorHex = decodeAuthor(authorEl.value);
      kind = parseKind(kindEl.value);
      relays = parseRelays(relaysEl.value);
      tagFilter = parseTagFilter(tagNameEl ? tagNameEl.value : '', tagValueEl ? tagValueEl.value : '');
    } catch (err) {
      setErrors(err.message || String(err));
      return;
    }

    submitBtn.disabled = true;
    const start = Date.now();
    let lastCount = 0;
    setStatus('接続中…');

    try {
      const events = await queryRelays(
        relays,
        authorHex,
        kind,
        tagFilter,
        20,
        10000,
        (p) => {
          if (p.type === 'event' && typeof p.count === 'number') {
            lastCount = p.count;
            setStatus(`受信中… ${lastCount} 件`);
          } else if (p.type === 'open') {
            setStatus('接続しました。受信中…');
          } else if (p.type === 'eose') {
            setStatus('受信完了待ち…');
          } else if (p.type === 'error') {
            setStatus(`一部リレーでエラー: ${p.url}`);
          }
        }
      );

      const ms = Date.now() - start;
      const pubkeyPart = authorHex ? `pubkey=${authorHex.slice(0,12)}… ` : 'pubkey=未指定 ';
      const tagPart = tagFilter ? `tag=${tagFilter.name}:${tagFilter.value} ` : '';
      summary.textContent = `条件: ${pubkeyPart}${tagPart}kind=${kind} | 取得 ${events.length} 件 | ${ms}ms`;
      renderEvents(results, events);
      setStatus('完了');
    } catch (err) {
      setErrors(err.message || String(err));
    } finally {
      submitBtn.disabled = false;
  }
  }
  );
});
