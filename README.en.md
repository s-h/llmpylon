[简体中文](README.md) · **English**

<div align="center">

# llmPylon

**Self-hosted LLM API proxy — multiple vendor subscriptions and agents on many devices, one entry point to manage models and apps**

[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white)

</div>

---

<p align="center">
  <img src="docs/images/1.png" alt="llmPylon" width="780" />
</p>

## What does this software do?

If you **subscribe to more than one LLM vendor** and run **different AI agents / clients** on your phone, laptop, and desktop, you often run into:

- Every tool needs its own Base URL, API key, and model name;
- You want to **switch the default provider and model in one place**;
- You want **per-app keys** and to **inspect each app’s traffic and logs**.

**llmPylon** is a **unified proxy + admin UI** you run on **your own** server (or a home NAS / small box): **vendor keys live only on the server**; clients use **app-level keys** only. In the dashboard you switch the **active provider**, set **model rules**, and **bind models per app**—point all devices at the **same proxy URL** and change models or routes mostly from the browser.

> **Do not expose this directly to the public Internet.** Default admin credentials and client keys are extremely risky if they can be scanned. Use only on trusted networks or behind proper edge protection.

---

<p align="center">
  <img src="docs/images/2.png" alt="Provider configuration" width="720" />
</p>

<p align="center">
  <img src="docs/images/3.png" alt="App management" width="720" />
</p>

<p align="center">
  <img src="docs/images/4.png" alt="Conversation logs" width="720" />
</p>

<p align="center">
  <img src="docs/images/5.png" alt="Conversation log detail" width="720" />
</p>

---

**Note:** You must comply with each API vendor’s terms of use. Many “coding” plans restrict usage to programming tools and certain agents and **forbid** other programs from calling the API. This application **only forwards** HTTP API calls; whatever you connect **upstream must meet the vendor’s requirements**.

## Features

| | |
| --- | --- |
| **Multi-provider** | Configure multiple providers; switch the active one in one step |
| **Protocols** | OpenAI-compatible and Anthropic-compatible flows |
| **Key custody** | Vendor keys stay on the server; clients use app keys only |
| **Model rules** | Wildcard mapping (e.g. `gpt-4`* → real model id) |
| **Per-app scope** | Bind provider and default model per app |
| **`llmpylon` model name** | Resolved via app / provider / global defaults (**case-insensitive**) |
| **Stats & logs** | Request stats and conversation logs (streaming, latency, tokens, etc.) |
| **Deployment** | **Docker recommended**; persist SQLite on a volume |

---

## Quick start (Docker)

```bash
docker build -t llmpylon .

docker run -d \
  --name llmpylon \
  -p 3000:3000 \
  -v llmpylon-data:/data \
  llmpylon
```

Open `http://<host>:3000`, sign in with the default account, then **change the password immediately**:

- Username: `llmpylon`
- Password: `llmpylon`

### Upgrading llmPylon (the app itself)

You **do not** need a separate “update server”. Typical approaches:

1. **Docker**: after pulling a newer image, recreate/restart the container with the **same volume** (`/data` unchanged keeps data and config).
2. **From source**: in the repo run `git pull`, then `npm install` if needed, `cd client && npm run build`, and restart `npm run server`.

Bump the root `package.json` `version` when you release; the UI and `GET /healthz` show that version.

---

## Local development

Requires **Node.js 20+** (same as the Docker image).

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

- API: `http://localhost:3000`
- Vite dev UI: `http://localhost:5173`

Production UI build:

```bash
cd client && npm run build && cd ..
npm run server
```

See [.env.example](.env.example) for environment variables.

---

## Example client request

Point the client Base URL at the proxy prefix, e.g.:

```bash
curl -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_APP_KEY" \
  -d '{"model":"llmpylon","messages":[{"role":"user","content":"Hi"}]}'
```

---

## Database & upgrades (Docker)

- **Persistence**: mount a data directory (e.g. `/data` in the container) or the database is lost when the container is recreated.
- **Schema**: migrations live in [`server/db.js`](server/db.js). **`setupDb()` runs on every startup** and applies `ALTER` / new tables to existing SQLite. After publishing a new image, **restart the container** to migrate.
- `docker/init.sql` runs **once** when the database file is empty; the live schema is defined by `db.js` at runtime.

The version string comes from root [`package.json`](package.json) (`version`) and is returned by [`GET /healthz`](server/index.js) (the admin UI shows `v…`).

---

## API cheat sheet

| Path | Description |
| --- | --- |
| `POST /proxy/`* | LLM proxy entry |
| `GET /healthz` | Health check (includes `version` / `name`) |
| `POST /api/auth/login` | Admin login |
| `/api/providers/`* | Providers |
| `/api/keys/`* | Apps (client keys) |
| `/api/models/*` | Models |
| `/api/model-rules/*` | Model rules |
| `/api/stats` | Statistics |
| `/api/logs` | Conversation logs |

For details, read the source and the in-app **Client help** page.

---

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `database.sqlite` (relative to cwd) | SQLite path; often `/data/database.sqlite` in Docker |
| `NODE_ENV` | — | Set to `production` in production if you like |

---

## Stack

Node.js · Express · SQLite · Socket.io · Vue 3 · Vite · Tailwind CSS · ECharts

---

## License

This repository is licensed under the [**GNU Affero General Public License v3.0 only**](LICENSE) (**AGPL-3.0-only**). The full text is in the `LICENSE` file at the repository root.
