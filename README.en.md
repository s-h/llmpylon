[简体中文](README.md) · **English**

<div align="center">

# 🔥 llmPylon

**One proxy. All your AI tools. No vendor lock-in.**

*Self-hosted LLM API proxy — manage all your AI tools through one endpoint*

[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/apache3/llmpylon)](https://hub.docker.com/r/apache3/llmpylon)
![Node.js 20+](https://img.shields.io/badge/node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

</div>

---

<p align="center">
  <img src="docs/images/1.png" alt="llmPylon" width="780" />
</p>

## Why llmPylon?

If you **subscribe to multiple LLM vendors** and use **different AI tools** (OpenCode, Claude Code, Cursor, etc.) across **multiple devices**, you've probably hit these walls:

| Pain Point | llmPylon's Fix |
|------------|----------------|
| Every tool needs its own API key config | Vendor keys stay **on the server only**; clients use short app keys |
| Switching models means updating every client | **One-click** provider switch in the admin UI — all clients follow instantly |
| Different vendors speak different protocols | **OpenAI ↔ Anthropic bidirectional auto-conversion** |
| No visibility into which app uses which model | Real-time conversation logs + analytics with per-request tracing |

**llmPylon** is a **unified proxy + admin dashboard** you run on your own server. One Docker command to get started.

> ⚠️ **Do not expose this directly to the public Internet.** Use only on trusted networks or behind proper edge protection.

---

## 🚀 Quick Start

```bash
docker run -d \
  --name llmpylon \
  -p 3000:3000 \
  -v llmpylon-data:/data \
  apache3/llmpylon
```

Open `http://<your-ip>:3000`, sign in, then **change the password immediately**:

- Username: `llmpylon`
- Password: `llmpylon`

### Client Setup

Point any AI tool at these settings:

| Setting | Value |
|---------|-------|
| Base URL | `http://your-ip:3000/proxy` |
| API Key | Create an app in "App Management" and copy its key |
| Model | `llmpylon` (case-insensitive) |

OpenAI-protocol clients use `/proxy/v1/chat/completions`, Anthropic-protocol clients use `/proxy/v1/messages`.

```bash
# Example cURL call
curl -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_APP_KEY" \
  -d '{"model":"llmpylon","messages":[{"role":"user","content":"Hello"}]}'
```

---

<p align="center">
  <img src="docs/images/2.png" alt="Provider config" width="720" />
  <br><em>Provider management — one-click active provider switching</em>
</p>

<p align="center">
  <img src="docs/images/3.png" alt="App management" width="720" />
  <br><em>App management — unique key and color per app</em>
</p>

<p align="center">
  <img src="docs/images/4.png" alt="Conversation logs" width="720" />
  <br><em>Real-time conversation logs — trace every request</em>
</p>

<p align="center">
  <img src="docs/images/5.png" alt="Log detail" width="720" />
  <br><em>Log detail — compare raw vs converted request/response</em>
</p>

---

## ✨ Features

| | |
|---|---|
| ✅ **Multi-provider** | Configure multiple API providers; switch the active one with one click |
| ✅ **Bidirectional conversion** | OpenAI ↔ Anthropic auto-conversion, with SSE streaming and tool calling |
| ✅ **Key custody** | Vendor API keys stay server-side; clients use app-level keys only |
| ✅ **Model rules** | Wildcard mapping (e.g., `gpt-4*` → actual model), with priority ordering |
| ✅ **Per-app binding** | Each app can bind its own provider and model, unaffected by global switches |
| ✅ **`llmpylon` magic model** | Auto-resolves via app binding → provider default → global default (case-insensitive) |
| ✅ **Webhook notifications** | HTTP push on conversation completion; custom URL, headers, JSON body, cooldown |
| ✅ **Real-time logs** | WebSocket live push; detail view comparing raw/converted request/response; pagination |
| ✅ **Analytics dashboard** | Request trends, model distribution, activity heatmap, P50/P90/P99 percentiles, top slow/error requests |
| ✅ **Recycle bin** | Soft-delete → restore → permanent delete for both providers and apps |
| ✅ **Import/export** | Per-provider or global JSON config export/import, including recycle bin and conversion flags |
| ✅ **Multi-admin** | Multiple admin accounts; create, edit, delete, and force password change |
| ✅ **Runtime config** | Log retention, upstream timeout, header blocklist, stream retry — all in the UI |
| ✅ **One-command Docker** | Volume-persisted SQLite, auto-migration on startup |

---

## 🔧 Upgrading

**Docker (recommended):**

```bash
docker pull apache3/llmpylon
docker stop llmpylon && docker rm llmpylon
docker run -d --name llmpylon -p 3000:3000 -v llmpylon-data:/data apache3/llmpylon
```

**From source:**
```bash
git pull && npm install && cd client && npm run build && cd .. && npm run server
```

Database migration runs automatically on every startup — no data loss. The version is in root `package.json` and displayed in the admin UI and `/healthz`.

---

## 📡 API Reference

| Path | Description |
|---|---|
| `POST /proxy/*` | LLM proxy entry (OpenAI / Anthropic) |
| `GET /healthz` | Health check (includes version) |
| `POST /api/auth/login` | Admin login |
| `/api/providers/*` | Providers (conversion toggle, recycle bin, import/export) |
| `/api/keys/*` | App keys (recycle bin, enable/disable, color) |
| `/api/models/*` | Model management (drag reorder, per-provider filter) |
| `/api/model-rules/*` | Model rules (wildcard mapping) |
| `/api/notification-configs/*` | Webhook notification config |
| `/api/notification-logs` | Notification push logs |
| `/api/config/export` / `import` | Global config import/export |
| `/api/stats` | Analytics (heatmap, percentiles, CSV export) |
| `/api/logs` | Conversation logs (raw vs converted comparison) |
| `/api/users/*` | Admin account management |

---

## 🛠 Local Development

Requires Node.js 20+.

```bash
npm install
cd client && npm install && cd ..
npm run dev        # API :3000 + Vite :5173
npm run server     # Production mode
```

See [.env.example](.env.example).

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `database.sqlite` | SQLite path; `/data/database.sqlite` in Docker |
| `NODE_ENV` | — | Set to `production` in production |

---

## 🧱 Stack

Node.js · Express · SQLite · Socket.io · Vue 3 · Vite · Tailwind CSS · ECharts

---

## 📄 License

**[GNU Affero General Public License v3.0 only](LICENSE)** (AGPL-3.0-only)
