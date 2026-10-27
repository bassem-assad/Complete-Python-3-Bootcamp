// ACC Quick Access - backend (step 1: APS login, token handling, hubs and projects)
// The APS client secret lives only here. The browser never sees it or the APS tokens.

try { process.loadEnvFile(); } catch { /* no .env file; rely on real environment variables */ }

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');

const {
  APS_CLIENT_ID, APS_CLIENT_SECRET, APS_CALLBACK_URL, SESSION_SECRET,
  PORT = 3000, NODE_ENV, APS_HUB_ID, APS_PROJECT_ID,
} = process.env;
// Least privilege for now. Step 6 (reviews) will need data:write, so users will re-consent then.
const APS_SCOPES = process.env.APS_SCOPES || 'data:read account:read user-profile:read';

for (const [k, v] of Object.entries({ APS_CLIENT_ID, APS_CLIENT_SECRET, APS_CALLBACK_URL, SESSION_SECRET })) {
  if (!v) { console.error(`Missing ${k}. Copy .env.example to .env and fill it in.`); process.exit(1); }
}

const APS = 'https://developer.api.autodesk.com';
const isProd = NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1); // behind the host's HTTPS proxy when deployed
app.use(session({
  name: 'accqa.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // In-memory store: fine for one user / one process; sessions reset on restart (just log in again).
  // Replaced by a SQLite store at step 4.
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 14 },
}));

// ---------- Auth ----------

function basicAuth() {
  return 'Basic ' + Buffer.from(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`).toString('base64');
}

async function tokenRequest(params) {
  const res = await fetch(`${APS}/authentication/v2/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`APS token error ${res.status}: ${body.developerMessage || body.error_description || body.error || 'unknown'}`);
  return body;
}

function storeTokens(req, t) {
  req.session.tokens = {
    access: t.access_token,
    refresh: t.refresh_token,
    expiresAt: Date.now() + (t.expires_in - 60) * 1000, // refresh 60 s early
  };
}

// Returns a valid access token, refreshing if needed. Throws 401-style error if the session is dead.
async function getAccessToken(req) {
  const t = req.session.tokens;
  if (!t) { const e = new Error('Not signed in'); e.status = 401; throw e; }
  if (Date.now() < t.expiresAt) return t.access;
  try {
    storeTokens(req, await tokenRequest({
      grant_type: 'refresh_token', refresh_token: t.refresh, scope: APS_SCOPES,
    }));
    return req.session.tokens.access;
  } catch (err) {
    delete req.session.tokens;
    const e = new Error('Session expired, please sign in again'); e.status = 401; throw e;
  }
}

app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = new URL(`${APS}/authentication/v2/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: APS_CLIENT_ID, redirect_uri: APS_CALLBACK_URL,
    scope: APS_SCOPES, state,
  });
  res.redirect(url.toString());
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`Autodesk sign-in failed: ${error} ${error_description || ''}`);
  if (!state || state !== req.session.oauthState) return res.status(400).send('Invalid sign-in state. Please try again.');
  delete req.session.oauthState;
  try {
    storeTokens(req, await tokenRequest({
      grant_type: 'authorization_code', code, redirect_uri: APS_CALLBACK_URL,
    }));
    const me = await fetch('https://api.userprofile.autodesk.com/userinfo', {
      headers: { Authorization: `Bearer ${req.session.tokens.access}` },
    }).then(r => r.json());
    req.session.user = { name: me.name || me.preferred_username, email: me.email };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Sign-in failed. Check the server log.');
  }
});

app.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

// ---------- APS proxy helpers ----------

async function apsGet(req, urlOrPath) {
  const token = await getAccessToken(req);
  const url = urlOrPath.startsWith('http') ? urlOrPath : APS + urlOrPath;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const e = new Error(`APS ${res.status} for ${new URL(url).pathname}: ${(await res.text()).slice(0, 300)}`);
    e.status = res.status === 401 ? 401 : 502;
    e.apsStatus = res.status;
    throw e;
  }
  return res.json();
}

// Follows JSON:API links.next so large lists are complete.
async function apsGetAll(req, path) {
  let url = path, out = [];
  for (let i = 0; url && i < 50; i++) {
    const page = await apsGet(req, url);
    out = out.concat(page.data || []);
    url = page.links && page.links.next && page.links.next.href;
  }
  return out;
}

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message });
});

// ---------- API (the browser only ever calls these) ----------

app.get('/api/me', (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not signed in' });
  // hubId/projectId are set once the app is locked to a single project (see .env.example)
  res.json({ ...(req.session.user || {}), config: { hubId: APS_HUB_ID || null, projectId: APS_PROJECT_ID || null } });
});

app.get('/api/hubs', wrap(async (req, res) => {
  const hubs = await apsGetAll(req, '/project/v1/hubs');
  res.json(hubs.map(h => ({
    id: h.id,
    name: h.attributes.name,
    type: h.attributes.extension && h.attributes.extension.type, // e.g. hubs:autodesk.bim360:Account (ACC)
  })));
}));

app.get('/api/hubs/:hubId/projects', wrap(async (req, res) => {
  const projects = await apsGetAll(req, `/project/v1/hubs/${encodeURIComponent(req.params.hubId)}/projects`);
  res.json(projects.map(p => ({
    id: p.id,
    name: p.attributes.name,
    type: p.attributes.extension && p.attributes.extension.type,
  })).sort((a, b) => a.name.localeCompare(b.name)));
}));

// Browsing is locked to the configured project, so users cannot wander into other projects through this app.
// ACC still enforces each user's own folder permissions.
function requireProject(req, res, next) {
  if (!APS_HUB_ID || !APS_PROJECT_ID) return res.status(400).json({ error: 'APS_HUB_ID and APS_PROJECT_ID are not set on the server' });
  next();
}

app.get('/api/folders/top', requireProject, wrap(async (req, res) => {
  const folders = await apsGetAll(req, `/project/v1/hubs/${encodeURIComponent(APS_HUB_ID)}/projects/${encodeURIComponent(APS_PROJECT_ID)}/topFolders`);
  res.json({ folders: folders.filter(f => !f.attributes.hidden).map(f => ({ id: f.id, name: f.attributes.displayName })), files: [] });
}));

app.get('/api/folders/:folderId', requireProject, wrap(async (req, res) => {
  let url = `/data/v1/projects/${encodeURIComponent(APS_PROJECT_ID)}/folders/${encodeURIComponent(req.params.folderId)}/contents?page[limit]=200`;
  const data = [], versions = {};
  for (let i = 0; url && i < 50; i++) {
    const page = await apsGet(req, url);
    data.push(...(page.data || []));
    for (const v of page.included || []) versions[v.id] = v;
    url = page.links && page.links.next && page.links.next.href;
  }
  const folders = data.filter(d => d.type === 'folders' && !d.attributes.hidden)
    .map(d => ({ id: d.id, name: d.attributes.displayName }));
  const files = data.filter(d => d.type === 'items').map(d => {
    const tip = versions[d.relationships?.tip?.data?.id];
    return {
      id: d.id, name: d.attributes.displayName,
      version: tip && tip.attributes.versionNumber,
      size: tip && tip.attributes.storageSize,
      modified: tip && tip.attributes.lastModifiedTime,
    };
  });
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  res.json({ folders: folders.sort(byName), files: files.sort(byName) });
}));

// ---------- Front end ----------

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`ACC Quick Access running on http://localhost:${PORT}`));
