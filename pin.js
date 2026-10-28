/* Browser-local screen lock. Does not encrypt budget records or backups. */
(() => {
  'use strict';
  const KEY = 'mijn-budget-web-pin-v1:' + new URL('./', location.href).pathname;
  const ITERATIONS = 210000;
  let root, record, locked = false, busy = false, generation = 0, timer, previousFocus;
  const valid = value => /^[0-9]{6}$/.test(value);
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  function read() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (r.version !== 1 || r.iterations !== ITERATIONS || typeof r.salt !== 'string' || typeof r.hash !== 'string' || bytes(r.salt).length !== 32 || bytes(r.hash).length !== 32 || !Number.isSafeInteger(r.failures) || r.failures < 0 || !Number.isSafeInteger(r.blockedUntil) || r.blockedUntil < 0) throw Error('De opgeslagen pincode-instelling is niet leesbaar.');
    return r;
  }
  function save(r) {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
    record = r;
    window.dispatchEvent(new Event('budgetpinchange'));
  }
  async function derive(pin, salt) {
    if (!window.isSecureContext || !window.crypto?.subtle) throw Error('Pincode instellen vereist HTTPS en een browser met Web Crypto. Open de app via GitHub Pages.');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256));
  }
  const same = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
  const unchanged = snapshot => { const current = read(); return current && current.hash === snapshot.hash && current.salt === snapshot.salt; };
  function message(value) { root.querySelector('[data-message]').textContent = value; }
  function render(title, body, canClose = false) {
    generation++; busy = false; clearInterval(timer);
    if (root.hidden) previousFocus = document.activeElement;
    document.documentElement.classList.add('mb-pin-cover');
    document.documentElement.classList.remove('mb-pin-loading');
    root.hidden = false;
    root.innerHTML = '<section class="mb-pin-card" role="dialog" aria-modal="true" aria-labelledby="mb-pin-title"><p class="mb-pin-brand">MIJN BUDGET</p><h1 id="mb-pin-title"></h1>' + body + '<p data-message role="status" aria-live="polite"></p>' + (canClose ? '<button type="button" data-close>Annuleren</button>' : '') + '</section>';
    root.querySelector('h1').textContent = title;
    root.querySelector('[data-close]')?.addEventListener('click', close);
    root.querySelector('input, button')?.focus({ preventScroll: true });
  }
  function close() {
    if (locked) return;
    generation++; busy = false; clearInterval(timer); root.hidden = true; root.replaceChildren();
    document.documentElement.classList.remove('mb-pin-cover', 'mb-pin-loading');
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function fatal(error) {
    locked = true;
    render('Pincode niet beschikbaar', '<p>De beveiligingsinstelling kan niet worden gelezen of opgeslagen. Probeer de app opnieuw te openen. Wis geen browsergegevens: daarmee kun je je lokale budget verliezen.</p>');
    message(error.message || 'Onbekende opslagfout.');
  }
  const field = (id, label, fresh = false) => '<label for="' + id + '">' + label + '</label><input id="' + id + '" name="' + id + '" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="' + (fresh ? 'new-password' : 'current-password') + '" required placeholder="6 cijfers">';
  function cooldown(button) {
    clearInterval(timer);
    function tick() {
      const wait = Math.max(0, Math.ceil((record.blockedUntil - Date.now()) / 1000));
      button.disabled = busy || wait > 0;
      if (wait) message('Te veel pogingen. Probeer over ' + wait + ' seconden opnieuw.');
      else { clearInterval(timer); if (!busy) message('Voer je pincode in.'); }
    }
    tick(); if (record.blockedUntil > Date.now()) timer = setInterval(tick, 1000);
  }
  function authenticate(title, success, canClose = false) {
    render(title, '<form>' + field('mb-pin-current', 'Pincode') + '<button class="mb-pin-primary" type="submit">Doorgaan</button></form><p class="mb-pin-note">Code vergeten? Er is geen herstelcode. Wis je browsergegevens niet: daarmee kun je ook je budget verliezen.</p>', canClose);
    const form = root.querySelector('form'), input = form.querySelector('input'), button = form.querySelector('button');
    const token = generation;
    cooldown(button);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || token !== generation) return;
      try {
        record = read(); if (!record) { locked = false; close(); return; }
        if (record.blockedUntil > Date.now()) { input.value = ''; cooldown(button); return; }
        const pin = input.value; input.value = '';
        if (!valid(pin)) { message('Voer precies 6 cijfers in.'); return; }
        const snapshot = record; busy = true; button.disabled = true; message('Controleren…');
        const hash = await derive(pin, bytes(snapshot.salt));
        if (token !== generation || document.hidden) return;
        if (!unchanged(snapshot)) { lock(); return; }
        if (same(hash, bytes(snapshot.hash))) {
          save({ ...snapshot, failures: 0, blockedUntil: 0 }); busy = false; success();
        } else {
          const failures = snapshot.failures + 1;
          const delay = failures >= 5 ? Math.min(300000, 30000 * (failures - 4)) : 0;
          save({ ...snapshot, failures, blockedUntil: delay ? Date.now() + delay : 0 });
          busy = false; button.disabled = false; message('Onjuiste pincode. Probeer opnieuw.');
          if (delay) cooldown(button); else input.focus();
        }
      } catch (error) {
        if (token === generation) { busy = false; button.disabled = false; message(error.message || 'Controleren mislukt. Probeer opnieuw.'); }
      }
    });
  }
  function lock() {
    try {
      record = read();
      if (!record) { locked = false; close(); return; }
      locked = true;
      authenticate('Budget vergrendeld', () => { locked = false; close(); });
    } catch (error) { fatal(error); }
  }
  function setup() {
    render(record ? 'Pincode wijzigen' : 'Pincode aanmaken', '<p>Kies 6 cijfers en onthoud je code. Er is geen herstelcode.</p><form>' + field('mb-pin-new', 'Nieuwe pincode', true) + field('mb-pin-repeat', 'Herhaal de pincode', true) + '<button class="mb-pin-primary" type="submit">Opslaan</button></form><p class="mb-pin-note">Dit vergrendelt het scherm op dit toestel. Budgetgegevens en back-upbestanden worden niet versleuteld. Maak regelmatig een JSON-back-up.</p>', true);
    const token = generation, form = root.querySelector('form'), button = form.querySelector('button');
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || token !== generation) return;
      const pin = form.querySelector('#mb-pin-new').value;
      if (!valid(pin)) { message('Kies precies 6 cijfers.'); return; }
      if (pin !== form.querySelector('#mb-pin-repeat').value) { message('De twee codes zijn niet gelijk.'); return; }
      form.reset(); busy = true; button.disabled = true; message('Opslaan…');
      try {
        const snapshot = read();
        const salt = crypto.getRandomValues(new Uint8Array(32)), hash = await derive(pin, salt);
        if (token !== generation || document.hidden) return;
        if ((snapshot && !unchanged(snapshot)) || (!snapshot && read())) { lock(); return; }
        save({ version: 1, salt: b64(salt), hash: b64(hash), iterations: ITERATIONS, failures: 0, blockedUntil: 0 });
        lock();
      } catch (error) { if (token === generation) { busy = false; button.disabled = false; message(error.message || 'Opslaan mislukt.'); } }
    });
  }
  function settings() {
    if (locked) return;
    try {
      record = read();
      if (!record) { setup(); return; }
      render('Pincode beheren', '<p>Je pincode is ingeschakeld op deze browser. De app vergrendelt bij openen en zodra je het tabblad of de app verlaat.</p><button class="mb-pin-primary" data-change>Code wijzigen</button><button data-disable>Pincode uitschakelen</button><button data-lock>Nu vergrendelen</button>', true);
      root.querySelector('[data-change]').onclick = () => authenticate('Huidige pincode', setup, true);
      root.querySelector('[data-disable]').onclick = () => authenticate('Pincode uitschakelen', () => { save(null); close(); }, true);
      root.querySelector('[data-lock]').onclick = lock;
    } catch (error) { fatal(error); }
  }
  window.BudgetPin = Object.freeze({ openSettings: settings, lock, enabled: () => { try { return !!read(); } catch (_) { return true; } } });
  document.addEventListener('DOMContentLoaded', () => {
    root = document.createElement('div'); root.id = 'mb-pin-root'; root.hidden = true; document.body.append(root);
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) close(); }
      if (event.key !== 'Tab') return;
      const controls = [...root.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    lock();
    document.addEventListener('visibilitychange', () => { if (document.hidden) { generation++; busy = false; lock(); } });
    window.addEventListener('pagehide', lock);
    window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
    window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) lock(); });
  });
})();
