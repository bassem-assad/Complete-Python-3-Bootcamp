# ACC Quick Access

Mobile-friendly installable web app (PWA) for fast access to Autodesk Construction Cloud (ACC).
Users sign in as themselves (3-legged OAuth), so they only see what their ACC permissions allow.

**Status:** step 1 of 7 (sign in, hubs, projects). See the build order in the project brief.

## 1. Create the APS app (once)
1. Go to https://aps.autodesk.com/myapps and sign in. Click **Create application**.
2. Type: **Traditional Web App**. APIs: tick **Data Management API** and **Autodesk Construction Cloud API** (later steps also use Webhooks).
3. **Callback URL**: `http://localhost:3000/auth/callback` (add your hosted URL later; the list can hold both).
4. Copy the **Client ID** and **Client Secret**.
5. Ask an **ACC Account Admin** to add the app in each account: *Account Admin > Settings > Custom Integrations > Add custom integration*, using the app's Client ID. Without this the hub list will be empty.

## 2. Run locally
```
cd acc-quick-access
npm install
cp .env.example .env      # then edit .env: paste Client ID, Secret, and a random SESSION_SECRET
npm start
```
Open http://localhost:3000, click **Sign in with Autodesk**.

Generate a SESSION_SECRET: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 3. Test on your phone
Phones cannot reach `localhost`, and Autodesk sign-in needs HTTPS for a real device. Easiest: deploy (below), or for a quick test use a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`), add the tunnel URL + `/auth/callback` as a second Callback URL in the APS app, and set `APS_CALLBACK_URL` to match.

## 4. Deploy (recommended: Render or Railway, small paid tier)
- Push this folder's repo to GitHub, create a **Web Service** pointing at `acc-quick-access`, build `npm install`, start `npm start`.
- Set the environment variables from `.env.example` in the host's dashboard, plus `NODE_ENV=production`. Set `APS_CALLBACK_URL=https://<your-host>/auth/callback` and add the same URL to the APS app.
- From step 4 the SQLite file needs a persistent disk (a few dollars a month). Free tiers sleep and wipe disk, so avoid them for the index.

## Security notes
- Secret and APS tokens stay on the server (in the session); the browser only holds a session cookie (HttpOnly, Secure in production).
- Sessions are in memory for now: restarting the server signs everyone out. Fine for one user.
- Service worker caches only the app shell, never `/api` or `/auth`.
