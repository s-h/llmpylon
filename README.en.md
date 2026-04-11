[简体中文](README.md) · **English**

# LLMProxy



Self-hosted LLM API proxy: multi-provider routing, per-app keys, model rules, stats, and conversation logs.  
Web admin UI with local SQLite storage.

---

## Overview

Useful when you want a **single Base URL** for clients while switching vendors/models on the server, without embedding third-party API keys in client code. You configure OpenAI-compatible and Anthropic-compatible style endpoints (depending on the Base URL and provider type you set).

> **Do not expose this directly to the public Internet.** Default admin credentials and app keys are extremely sensitive if reachable from the open web. Use only on trusted networks or behind proper access controls. See [SECURITY.en.md](SECURITY.en.md).

---

## Features


|                       |                                                                  |
| --------------------- | ---------------------------------------------------------------- |
| Multi-provider        | Configure multiple providers; switch the active one              |
| Key custody           | Vendor keys stay on the server; clients use app keys only        |
| Model rules           | Wildcard mapping (e.g. `gpt-4`* → real model id)                 |
| Per-app routing       | Bind provider and default model per app                          |
| `llmproxy` model name | Resolved via app / provider / global defaults                    |
| Stats & logs          | Usage stats and detailed logs (streaming, latency, tokens, etc.) |
| Deployment            | **Docker recommended** with a volume for SQLite                  |


---

## Screenshots

> Add a few admin UI screenshots here so visitors can see the product quickly (optional).

---

## Quick start (Docker)

```bash
docker build -t llmproxy .

docker run -d \
  --name llmproxy \
  -p 3000:3000 \
  -v llmproxy-data:/data \
  llmproxy
```

Open `http://<host>:3000`, sign in with the default account and **change the password immediately**:

- Username: `llmproxy`
- Password: `llmproxy`

### Upgrading LLMProxy (the application)

You **do not** need a dedicated “update server”. Typical flows:

1. **Docker**: pull a newer image, then recreate/restart the container with the **same volume** (your `/data` SQLite stays). With Compose: `docker compose pull && docker compose up -d`.
2. **From source**: `git pull`, run `npm install` if needed, `cd client && npm run build`, then restart `npm run server`.

Bump the root `package.json` `version` when you cut a release; the UI and `GET /healthz` read that value.

---

## Local development

Requires **Node.js 20+** (same major as the Docker image).

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
  -d '{"model":"llmproxy","messages":[{"role":"user","content":"Hi"}]}'
```

---

## Database & upgrades (Docker)

- **Persistence**: mount a data directory (e.g. `/data` in the container) or you will lose the database when the container is recreated.
- **Schema migrations**: defined in `[server/db.js](server/db.js)`. `setupDb()` runs **on every startup** and applies `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` as needed. After you publish a new image, **restart the container** to migrate—no separate “update server” is required.
- `docker/init.sql` runs **once** when the DB file is empty (see `server/docker-entrypoint.js`). The authoritative schema is still applied by `db.js` at runtime.

**Version display**: the app version comes from root `[package.json](package.json)` (`version` field), exposed in `[GET /healthz](server/index.js)` as `version` / `name`. The admin UI shows `v…`. You normally **do not** need a DB column for this; bump `package.json` and use Git tags for releases.

---

## Dependency updates (no self-hosted infra)

This repo enables **[Dependabot](https://docs.github.com/en/code-security/dependabot)** (`[.github/dependabot.yml](.github/dependabot.yml)`). GitHub opens npm update PRs on a schedule—you review and merge in the browser. **No** dedicated update server is required.

---

## API cheat sheet


| Path                   | Description                         |
| ---------------------- | ----------------------------------- |
| `POST /proxy/`*        | LLM proxy entry                     |
| `GET /healthz`         | Health (includes `version`, `name`) |
| `POST /api/auth/login` | Admin login                         |
| `/api/providers/*`     | Providers                           |
| `/api/keys/*`          | Apps (client keys)                  |
| `/api/models/*`        | Models                              |
| `/api/model-rules/*`   | Model rules                         |
| `/api/stats`           | Statistics                          |
| `/api/logs`            | Conversation logs                   |


Use the in-app “Client help” section together with the source for details.

---

## Environment variables


| Variable   | Default                             | Description                                          |
| ---------- | ----------------------------------- | ---------------------------------------------------- |
| `PORT`     | `3000`                              | HTTP port                                            |
| `DB_PATH`  | `database.sqlite` (relative to cwd) | SQLite path; often `/data/database.sqlite` in Docker |
| `NODE_ENV` | —                                   | Set to `production` in production if you like        |


---

## Stack

Node.js · Express · SQLite · Socket.io · Vue 3 · Vite · Tailwind CSS · ECharts

---

## Docs & contributing


| Doc                                      | Purpose              |
| ---------------------------------------- | -------------------- |
| [README.md](README.md)                   | Chinese readme       |
| [CONTRIBUTING.en.md](CONTRIBUTING.en.md) | Contributing guide   |
| [SECURITY.en.md](SECURITY.en.md)         | Security & reporting |
| [CHANGELOG.md](CHANGELOG.md)             | Changelog            |


---

## License

This repository is licensed under the [**GNU Affero General Public License v3.0 only**](LICENSE) (**AGPL-3.0-only**). The `LICENSE` file is the official verbatim text from GNU—do not edit its wording.

Copyright and attribution guidance: see [NOTICE](NOTICE). You may replace the copyright line with your legal name or organization.

AGPL has specific requirements for offering modified versions over a network. If you use this commercially or as a public service, read the license or consult legal counsel.