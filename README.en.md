[简体中文](README.md) · **English**

<div align="center">

# llmPylon

**Self-hosted LLM API proxy — unify multiple vendor subscriptions and agents behind one Base URL**

[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white)

</div>

---

## What is this for?

If you **subscribe to several LLM vendors** and run **different AI agents / clients** on phone, laptop, and desktop, you often end up:

- pasting Base URLs, API keys, and model names into every tool;
- editing many configs when you switch from vendor A to B;
- spreading real secrets across devices.

**llmPylon** runs on **your** machine (homelab, NAS, small VPS): a **single proxy + admin UI**. **Vendor keys stay on the server**; each client only needs an **app key**. Switch the **active provider**, **model rules**, and **per-app bindings** in the browser—point every device at the **same proxy URL** and manage routing in one place.

> **Do not expose this directly to the public Internet.** Default admin credentials and app keys are extremely sensitive if reachable from the open web. Use only on trusted networks or behind proper access controls. See [SECURITY.en.md](SECURITY.en.md).

---

## Image placeholders

Replace the `src` attributes with your own screenshots (e.g. under `docs/images/`).

<p align="center">
  <img src="docs/images/hero.png" alt="llmPylon — replace with your hero screenshot" width="780" />
</p>

| File | Suggested content |
| ---- | ----------------- |
| `docs/images/hero.png` | Overview: admin UI + “one proxy, many vendors” |
| `docs/images/providers.png` | Provider / model configuration |
| `docs/images/apps.png` | Apps (client keys) and model binding |

<p align="center">
  <img src="docs/images/providers.png" alt="Providers — placeholder" width="720" />
</p>

<p align="center">
  <img src="docs/images/apps.png" alt="Apps — placeholder" width="720" />
</p>

---

## Features

| | |
| --- | --- |
| **Multi-provider** | Configure multiple providers; switch the active one |
| **Key custody** | Vendor keys stay on the server; clients use app keys only |
| **Model rules** | Wildcard mapping (e.g. `gpt-4`* → real model id) |
| **Per-app routing** | Bind provider and default model per app |
| **`llmpylon` model name** | Resolved via app / provider / global defaults (**case-insensitive**) |
| **Stats & logs** | Usage stats and detailed logs (streaming, latency, tokens, etc.) |
| **Deployment** | **Docker recommended** with a volume for SQLite |

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

Open `http://<host>:3000`, sign in with the default account and **change the password immediately**:

- Username: `llmpylon`
- Password: `llmpylon`

### Upgrading llmPylon (the application)

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
  -d '{"model":"llmpylon","messages":[{"role":"user","content":"Hi"}]}'
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

## Acknowledgements

README layout and badge style were inspired by projects such as [huasheng_editor](https://github.com/alchaincyf/huasheng_editor) and [wxmp](https://github.com/jaywcjlove/wxmp).

---

## License

This repository is licensed under the [**GNU Affero General Public License v3.0 only**](LICENSE) (**AGPL-3.0-only**). The `LICENSE` file is the official verbatim text from GNU—do not edit its wording.

Copyright and attribution guidance: see [NOTICE](NOTICE). You may replace the copyright line with your legal name or organization.

AGPL has specific requirements for offering modified versions over a network. If you use this commercially or as a public service, read the license or consult legal counsel.