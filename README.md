**简体中文** · [English](README.en.md)

<div align="center">

# llmPylon

**自托管 LLM API 代理 —— 多厂商订阅、多设备 Agent，一套入口统一管理模型与应用**

[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white)

</div>

---

## 这款软件是干什么的？

如果你**同时订了多家大模型厂商**，又在**手机、笔记本、台式机**上装了不同的 AI Agent / 客户端，经常会遇到：

- 每个工具都要单独填 Base URL、换 API Key、改模型名；
- 想从 A 厂商切到 B 厂商，要到处改配置；
- 真密钥散落在各台设备上，心里不踏实。

**llmPylon** 就是放在你自己服务器（或家里 NAS / 小主机）上的一个 **统一代理 + 管理后台**：各家 **厂商 Key 只保存在服务端**，各端客户端只拿 **应用级 Key**；在后台切换**当前生效厂商**、配置**模型规则**和**按应用绑定模型**，多设备指向 **同一套代理地址** 即可，换模型、换线路主要在网页里完成。

> **不要把它直接暴露到公网。** 默认管理员与客户端 Key 若可被扫描，风险极高。请仅在受信任网络或做好接入层防护后使用。详见 [SECURITY.md](SECURITY.md)。

---

## 配图位（请替换为你的截图 / 示意图）

主视觉建议放在仓库中（例如 `docs/images/`），然后把下面 `src` 改成你的文件路径或图床 URL。

<p align="center">
  <!-- 将下方 src 改为你的配图，例如 docs/images/hero.png -->
  <img src="docs/images/hero.png" alt="llmPylon 配图占位 — 请替换此图片" width="780" />
</p>

**可选配图建议（可自行增删行）：**

| 占位 | 建议内容 |
| ---- | -------- |
| `docs/images/hero.png` | 总览：管理后台 + 「一代理多厂商」示意 |
| `docs/images/providers.png` | 厂商配置 / 模型列表 |
| `docs/images/apps.png` | 应用（客户端 Key）与绑定模型 |

<p align="center">
  <img src="docs/images/providers.png" alt="厂商配置配图占位" width="720" />
</p>

<p align="center">
  <img src="docs/images/apps.png" alt="应用管理配图占位" width="720" />
</p>

> 若暂时无图，可删除上述 `<img>` 或保留路径待你提交图片后再启用。

---

## ✨ 特性摘要

| | |
| --- | --- |
| **多厂商** | 配置多个提供商，一键切换当前生效厂商 |
| **密钥托管** | 厂商 Key 留在服务端；客户端只用应用 Key |
| **模型规则** | 通配符映射（如 `gpt-4`* → 实际模型名） |
| **应用维度** | 每个应用可绑定厂商与默认模型 |
| **`llmpylon` 模型名** | 按优先级解析为应用 / 厂商 / 全局默认模型（**大小写不敏感**） |
| **统计与日志** | 请求统计、对话日志（流式、耗时、Token 等） |
| **部署** | **推荐 Docker**，数据卷持久化 SQLite |

---

## 快速开始（Docker）

```bash
docker build -t llmpylon .

docker run -d \
  --name llmpylon \
  -p 3000:3000 \
  -v llmpylon-data:/data \
  llmpylon
```

浏览器访问 `http://<主机>:3000`，使用默认账号登录后 **立即修改密码**：

- 用户名：`llmpylon`
- 密码：`llmpylon`

### 升级 llmPylon（软件本体）

**不需要**单独的「版本更新服务器」。常见做法：

1. **Docker**：拉取新镜像后，用**相同的数据卷**重建/重启容器（`/data` 不变则数据与配置仍在）。若用 Compose：`docker compose pull && docker compose up -d`。
2. **源码**：在仓库目录 `git pull`，按需 `npm install`、`cd client && npm run build`，再重启 `npm run server`。

发版时递增根目录 `package.json` 的 `version`；界面与 `GET /healthz` 会显示该版本。

---

## 本地开发

需要 **Node.js 20+**（与 Docker 镜像一致）。

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

- 后端：`http://localhost:3000`
- 前端开发：`http://localhost:5173`（Vite）

生产构建：

```bash
cd client && npm run build && cd ..
npm run server
```

环境变量示例见 [.env.example](.env.example)。

---

## 客户端调用示例

将 Base URL 指向代理前缀，例如：

```bash
curl -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_APP_KEY" \
  -d '{"model":"llmpylon","messages":[{"role":"user","content":"你好"}]}'
```

---

## 数据库与升级（Docker 场景）

- **持久化**：务必挂载数据目录（示例中的 `/data`），否则容器重建会丢库。
- **结构升级**：表结构与迁移在 [`server/db.js`](server/db.js) 中；**服务每次启动**都会执行 `setupDb()`，对已有 SQLite 自动 `ALTER` / 补表。发布新镜像后 **重启容器** 即可完成迁移。
- `docker/init.sql` 仅在 **空库文件** 时由入口脚本执行一次；完整 schema 以运行时 `db.js` 为准。

版本号来自根目录 [`package.json`](package.json) 的 `version`，由 [`GET /healthz`](server/index.js) 返回（管理界面显示 `v…`）。

---

## 依赖更新（无需自建服务器）

本仓库启用 **[Dependabot](https://docs.github.com/en/code-security/dependabot)**（[`.github/dependabot.yml`](.github/dependabot.yml)）：由 GitHub 定期扫描 `npm` 依赖并自动开 PR。

---

## API 速查

| 路径 | 说明 |
| --- | --- |
| `POST /proxy/`* | LLM 代理入口 |
| `GET /healthz` | 健康检查（含 `version` / `name`） |
| `POST /api/auth/login` | 管理员登录 |
| `/api/providers/`* | 厂商 |
| `/api/keys/`* | 应用（客户端 Key） |
| `/api/models/*` | 模型 |
| `/api/model-rules/*` | 模型规则 |
| `/api/stats` | 统计 |
| `/api/logs` | 对话日志 |

完整说明可结合源码与后台「客户端帮助」页。

---

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 端口 |
| `DB_PATH` | `database.sqlite`（相对 cwd） | SQLite 路径；Docker 内常为 `/data/database.sqlite` |
| `NODE_ENV` | — | 生产可设为 `production` |

---

## 技术栈

Node.js · Express · SQLite · Socket.io · Vue 3 · Vite · Tailwind CSS · ECharts

---

## 文档与协作

| 文档 | 说明 |
| --- | --- |
| [README.en.md](README.en.md) | 英文说明 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献 |
| [SECURITY.md](SECURITY.md) | 安全与漏洞报告 |
| [CHANGELOG.md](CHANGELOG.md) | 变更记录 |

---

## 致谢与相关项目

排版与 README 结构参考了社区里优秀的公众号 / 文档类开源项目，例如 [花生公众号排版器 huasheng_editor](https://github.com/alchaincyf/huasheng_editor)、[微信公众号 Markdown 编辑器 wxmp](https://github.com/jaywcjlove/wxmp) 等项目的展示方式（徽章、分段、配图思路）。

---

## 许可证

本仓库以 **[GNU Affero General Public License v3.0 only](LICENSE)**（**AGPL-3.0-only**）授权。完整条文见根目录 `LICENSE`。

项目版权与署名说明见 [NOTICE](NOTICE)；你可把其中的版权行改成个人或组织名称。

AGPL 对「通过网络提供服务」「修改后的源码如何向用户提供」等有具体要求；若用于商业或对外服务，请先自行阅读许可证或咨询法律顾问。
