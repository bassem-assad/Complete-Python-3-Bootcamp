// ACC Quick Access front end (step 1: login, hubs, projects). Plain JS, no build step.
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');
const logoutBtn = document.getElementById('logout');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

async function api(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) { renderLogin(); throw new Error('signed-out'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
  return res.json();
}

function setHeader(title, back) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  backBtn.onclick = back || null;
}

function showError(err) {
  if (err.message === 'signed-out') return;
  view.innerHTML = `<p class="error">${esc(err.message)}</p>`;
}

function renderLogin() {
  setHeader('ACC Quick Access');
  logoutBtn.hidden = true;
  view.innerHTML = `<div class="center"><p>Sign in with your Autodesk account to see the projects you have access to.</p>
    <a class="btn" href="/auth/login">Sign in with Autodesk</a></div>`;
}

function renderList(items, { placeholder, onPick, sub }) {
  view.innerHTML = `<input type="search" id="filter" placeholder="${esc(placeholder)}" autocomplete="off">
    <ul class="list" id="items"></ul><p class="muted" id="count"></p>`;
  const ul = document.getElementById('items');
  const draw = q => {
    const f = items.filter(i => i.name.toLowerCase().includes(q.toLowerCase()));
    ul.innerHTML = f.map(i => `<li><button data-id="${esc(i.id)}">${esc(i.name)}${sub ? `<small>${esc(sub(i))}</small>` : ''}</button></li>`).join('');
    document.getElementById('count').textContent = `${f.length} of ${items.length}`;
  };
  draw('');
  document.getElementById('filter').oninput = e => draw(e.target.value);
  ul.onclick = e => {
    const b = e.target.closest('button');
    if (b) onPick(items.find(i => i.id === b.dataset.id));
  };
}

async function showHubs() {
  setHeader('Hubs');
  view.innerHTML = '<p class="muted">Loading hubs…</p>';
  try {
    const hubs = await api('/api/hubs');
    if (!hubs.length) { view.innerHTML = '<p class="error">No hubs found. Ask your ACC Account Admin to add this app (custom integration) to the account.</p>'; return; }
    if (hubs.length === 1) return showProjects(hubs[0], false);
    renderList(hubs, { placeholder: 'Filter hubs', onPick: h => showProjects(h, true), sub: h => h.type?.includes('bim360') ? 'ACC / BIM 360' : h.type });
  } catch (err) { showError(err); }
}

async function showProjects(hub, canGoBack) {
  setHeader(hub.name, canGoBack ? showHubs : null);
  view.innerHTML = '<p class="muted">Loading projects…</p>';
  try {
    const projects = await api(`/api/hubs/${encodeURIComponent(hub.id)}/projects`);
    renderList(projects, {
      placeholder: 'Filter projects',
      onPick: p => { view.insertAdjacentHTML('afterbegin', `<p class="muted">Folder browsing arrives in step 2 (${esc(p.name)}).</p>`); },
    });
  } catch (err) { showError(err); }
}

async function start() {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' });
    if (!me.ok) return renderLogin();
    logoutBtn.hidden = false;
    showHubs();
  } catch { renderLogin(); }
}

logoutBtn.onclick = async () => { await fetch('/auth/logout', { method: 'POST' }); renderLogin(); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
