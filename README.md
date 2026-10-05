# WUP Online Student Document Request & Tracking System

Express + SQLite (Node's built-in `node:sqlite`) backend, no external database server required.

## Run locally

```bash
npm install
npm start
```

Visit `http://localhost:3000`. A `data/wup_registrar.db` file is created and seeded
automatically on first run (4 demo students + 1 registrar staff account — see `db.js`
for the seeded credentials).

## Deploy — GitHub + Render (free)

Render runs this app as a normal, always-on Node process (unlike Vercel's serverless
functions), so the SQLite file works exactly like it does locally — **no code changes
needed.**

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit" 
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(If you're using GitHub Desktop or a different git workflow, just make sure the whole
`wup-registrar/` folder — minus `node_modules/`, which `.gitignore` already excludes —
ends up in the repo.)

### 2. Deploy on Render

**Option A — Blueprint (one click, recommended):** this repo includes `render.yaml`.
Go to [render.com](https://render.com) → **New** → **Blueprint** → connect your GitHub
repo → Render reads `render.yaml` and sets everything up automatically.

**Option B — Manual setup:** **New** → **Web Service** → connect your GitHub repo, then:
| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Plan | Free |

No environment variables are required — Render sets `PORT` automatically and the app
already reads it (`server.js`).

### Login sessions

Logging in creates a session (httpOnly cookie + `sessions` table in the SQLite file), valid for
12 hours and extended while in use. The page calls `/api/me` on load, so refreshing no longer
returns to the login screen. The registrar dashboard also re-checks for new requests every 15 seconds.

### 3. Important: free-tier data persistence

On Render's **free** plan, the service spins down after ~15 minutes of inactivity. When
it wakes back up, it's a fresh instance — so the local `data/` folder (and anything
written to it, like new document requests) resets to empty and reseeds with the demo
data. Fine for early testing where occasional resets aren't a problem; **not** fine if
you need data to reliably survive restarts.

To make it persistent, add a Render **persistent disk** (small paid add-on) mounted at,
e.g., `/var/data`, then set one environment variable in the Render dashboard:

```
DB_DIR=/var/data
```

`db.js` already reads this — no code changes needed, just the env var and the disk.

## Project structure

```
db.js            SQLite schema, seeding, and connection (node:sqlite)
hash.js          Password hashing (crypto.scrypt — no external deps)
server.js        Express API routes
public/
  index.html     Frontend markup (login, dashboards, modals)
  app.js         Frontend logic
  styles.css     Custom styles (Tailwind is loaded via CDN in index.html)
  assets/logo.png
```
