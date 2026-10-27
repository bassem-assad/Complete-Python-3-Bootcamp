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

// ---- Folder browsing (single project) ----
const fmtSize = n => n == null ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const fmtDate = s => s ? new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
let trail = []; // [{id, name}] from the top folder down

async function showFolder() {
  const here = trail[trail.length - 1];
  setHeader(here ? here.name : 'Project files', trail.length ? () => { trail.pop(); showFolder(); } : null);
  view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const c = await api(here ? `/api/folders/${encodeURIComponent(here.id)}` : '/api/folders/top');
    const crumbs = trail.length ? `<p class="muted">${trail.map(t => esc(t.name)).join(' / ')}</p>` : '';
    view.innerHTML = crumbs + `<ul class="list">` +
      c.folders.map(f => `<li><button data-folder="${esc(f.id)}" data-name="${esc(f.name)}">&#128193; ${esc(f.name)}</button></li>`).join('') +
      c.files.map(f => `<li><button data-file="${esc(f.id)}">${esc(f.name)}<small>v${esc(f.version ?? '?')} · ${fmtSize(f.size)} · ${fmtDate(f.modified)}</small></button></li>`).join('') +
      `</ul>` + (c.folders.length + c.files.length ? '' : '<p class="muted">Empty folder.</p>');
    view.querySelector('ul').onclick = e => {
      const b = e.target.closest('button[data-folder]');
      if (b) { trail.push({ id: b.dataset.folder, name: b.dataset.name }); showFolder(); }
    };
  } catch (err) { showError(err); }
}

async function start() {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' });
    if (!me.ok) return renderLogin();
    logoutBtn.hidden = false;
    const info = await me.json();
    if (info.config && info.config.projectId) { trail = []; showFolder(); } else showHubs();
  } catch { renderLogin(); }
}

logoutBtn.onclick = async () => { await fetch('/auth/logout', { method: 'POST' }); renderLogin(); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
