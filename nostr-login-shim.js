// Minimal fallback shim for <nostr-login> web component
// Registers only if no real implementation is present.
(function(){
  if (typeof window === 'undefined') return;
  if (!('customElements' in window)) return;
  if (customElements.get('nostr-login')) return; // already provided by external lib

  class NostrLogin extends HTMLElement {
    constructor(){
      super();
      this._pubkey = '';
      this.attachShadow({mode:'open'});
      this._onClick = this._onClick.bind(this);
    }
    connectedCallback(){ this._render(); }
    get pubkey(){ return this._pubkey; }
    set pubkey(v){ this._pubkey = typeof v === 'string' ? v : ''; this._render(); }
    async _onClick(){
      if (this._pubkey) { // logout
        this._pubkey = '';
        this.dispatchEvent(new CustomEvent('logout', { bubbles: true }));
        this._render();
        return;
      }
      if (!window.nostr || typeof window.nostr.getPublicKey !== 'function') {
        this._error('NIP-07 拡張が見つかりません');
        return;
      }
      try {
        const hex = await window.nostr.getPublicKey();
        if (typeof hex === 'string' && /^[0-9a-fA-F]{64}$/.test(hex)) {
          this._pubkey = hex.toLowerCase();
          this.dispatchEvent(new CustomEvent('login', { detail: { pubkey: this._pubkey }, bubbles: true }));
          this._render();
        } else {
          this._error('不正な公開鍵');
        }
      } catch (e) {
        this._error(e && e.message ? e.message : 'ログインに失敗しました');
      }
    }
    _error(msg){
      // non-blocking: show brief message inside shadow UI
      const el = this.shadowRoot && this.shadowRoot.getElementById('msg');
      if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 2500); }
    }
    _render(){
      const loggedIn = !!this._pubkey;
      const style = `:host{font:inherit} button{padding:6px 10px; border:1px solid #ced4da; background:#fff; border-radius:6px; cursor:pointer} button:hover{background:#f6f8fa} .hint{color:#9aa7b2; font-size:12px; margin-left:6px}`;
      const npubShort = loggedIn ? (this._pubkey.slice(0,12) + '…') : '';
      this.shadowRoot.innerHTML = `
        <style>${style}</style>
        <button id="btn" type="button">${loggedIn ? 'ログアウト' : 'Nostr でログイン'}</button>
        <span id="msg" class="hint">${loggedIn ? npubShort : ''}</span>
      `;
      this.shadowRoot.getElementById('btn').onclick = this._onClick;
    }
  }
  customElements.define('nostr-login', NostrLogin);
})();

