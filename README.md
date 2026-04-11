**简体中文** · [English](README.en.md)

# llmPylon

自托管的 LLM API 代理：多厂商路由、应用级密钥、模型规则、统计与对话日志。  
带 Web 管理界面，数据落在本地 SQLite。

---

## 概览

适合希望在 **同一套 Base URL** 下切换后端厂商/模型、又不想把各家的 API Key 写进客户端的场景。后台可配置 OpenAI 兼容与 Anthropic 兼容类线路（具体取决于你填的 Base URL 与类型）。

> **不要把它直接暴露到公网。** 默认管理员账号与客户端 Key 若可被扫描，风险极高。请仅在受信任网络或做好接入层防护后使用。详见 [SECURITY.md](SECURITY.md)。

---

## 特性摘要


|                |                             |
| -------------- | --------------------------- |
| 多厂商            | 配置多个提供商，切换当前激活厂商            |
| 密钥托管           | 厂商 Key 留在服务端；客户端只用应用 Key    |
| 模型规则           | 通配符映射（如 `gpt-4`* → 实际模型名）   |
| 应用维度           | 每个应用可绑定厂商与默认模型              |
| `llmpylon` 模型名 | 按优先级解析为应用/厂商/全局默认模型（**大小写不敏感**） |
| 统计与日志          | 请求统计、对话日志（含流式、耗时、Token 等字段） |
| 部署             | **推荐 Docker**，数据卷持久化 SQLite |


---

## 截图

> 可在本段下方加入管理后台截图，便于访客快速了解界面（可选）。

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
- **结构升级**：表结构与迁移在 `[server/db.js](server/db.js)` 中；**服务每次启动**都会执行 `setupDb()`，对已有 SQLite 自动 `ALTER` / 补表。你发布新镜像后 **重启容器** 即可完成迁移，**不依赖**单独的「更新服务器」。
- `docker/init.sql` 仅在 **空库文件** 时由入口脚本执行一次；完整 schema 以运行时 `db.js` 为准（详见该文件注释与代码）。

若你希望 **在页面或 API 中展示当前程序版本**：版本号来自根目录 `[package.json](package.json)` 的 `version` 字段，由 `[GET /healthz](server/index.js)` 返回（管理界面会显示 `v…`）。一般 **不必** 再单独写数据库字段；发版时递增 `package.json` 并打 Git tag 即可。

---

## 依赖更新（无需自建服务器）

本仓库启用 **[Dependabot](https://docs.github.com/en/code-security/dependabot)**（`[.github/dependabot.yml](.github/dependabot.yml)`）：由 **GitHub 云端** 定期扫描 `npm` 依赖并自动开 PR，你只需在网页上审阅、合并，**不需要**自备更新服务器。

---

## API 速查


| 路径                     | 说明                         |
| ---------------------- | -------------------------- |
| `POST /proxy/`*        | LLM 代理入口                   |
| `GET /healthz`         | 健康检查（含 `version` / `name`） |
| `POST /api/auth/login` | 管理员登录                      |
| `/api/providers/`*     | 厂商                         |
| `/api/keys/`*          | 应用（客户端 Key）                |
| `/api/models/*`        | 模型                         |
| `/api/model-rules/*`   | 模型规则                       |
| `/api/stats`           | 统计                         |
| `/api/logs`            | 对话日志                       |


完整说明可结合源码与后台「客户端帮助」页。

---

## 环境变量


| 变量         | 默认                        | 说明                                           |
| ---------- | ------------------------- | -------------------------------------------- |
| `PORT`     | `3000`                    | HTTP 端口                                      |
| `DB_PATH`  | `database.sqlite`（相对 cwd） | SQLite 路径；Docker 内常为 `/data/database.sqlite` |
| `NODE_ENV` | —                         | 生产可设为 `production`                           |


---

## 技术栈

Node.js · Express · SQLite · Socket.io · Vue 3 · Vite · Tailwind CSS · ECharts

---

## 文档与协作


| 文档                                 | 说明      |
| ---------------------------------- | ------- |
| [README.en.md](README.en.md)       | 英文说明    |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献    |
| [SECURITY.md](SECURITY.md)         | 安全与漏洞报告 |
| [CHANGELOG.md](CHANGELOG.md)       | 变更记录    |


---

## 许可证

本仓库以 **[GNU Affero General Public License v3.0 only](LICENSE)**（**AGPL-3.0-only**）授权。完整条文见根目录 `LICENSE`（GNU 官方正文，请勿改写正文）。

项目版权与署名说明见 [NOTICE](NOTICE)；你可把其中的版权行改成个人或组织名称。

AGPL 对「通过网络提供服务」「修改后的源码如何向用户提供」等有具体要求；若用于商业或对外服务，请先自行阅读许可证或咨询法律顾问。