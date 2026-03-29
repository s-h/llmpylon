# LLMProxy

LLMProxy 是一个 LLM API 代理服务，用于统一管理和路由大语言模型请求。

## 功能特性

### 1. 快速切换大模型提供商和模型
支持同时配置多个 LLM 提供商（如 OpenAI、Anthropic、阿里云、字节跳动等），可以一键切换默认提供商。

### 2. 托管密钥
安全托管各个提供商的 API 密钥，避免在客户端代码中暴露敏感凭证。

### 3. 模型转换规则
支持通配符模式的模型映射规则，例如将 `gpt-4*` 自动转换为指定的模型。

### 4. 应用级别的提供商和模型配置
每个应用（API Key）可以单独绑定不同的提供商和模型，实现精细化的流量控制。

### 5. 强制模型转换
支持将模型名指定为特殊的 `llmproxy` 关键字，强制使用应用或提供商配置的默认模型。

### 6. 统计功能
提供完善的使用统计，包括：
- 请求量、错误率、Token 消耗
- 按时间维度（30天/7天/90天/全部）的趋势分析
- 按模型、提供商、应用分布统计
- 热点请求和错误追踪

---

## 安装方式

### 方式一：直接运行

**前置要求**：Node.js 18+

```bash
# 安装依赖
npm install
cd client && npm install && cd ..

# 启动开发服务器（前后端并行）
npm run dev

# 或分别启动
npm run server   # 后端: http://localhost:3000
npm run client   # 前端: http://localhost:5173
```

**生产构建**：
```bash
cd client && npm run build
npm run server
```

### 方式二：Docker 运行

```bash
# 构建镜像
docker build -t llmproxy .

# 运行容器（使用本地目录持久化数据）
docker run -d \
  -v /your/local/path:/data \
  -p 3000:3000 \
  llmproxy
```

---

## 配置指南

### 1. 登录管理后台

首次登录：
- 用户名：`llmproxy`
- 密码：`llmproxy`
- **首次登录必须修改密码**

### 2. 配置提供商

进入「厂商管理」页面，添加 LLM 提供商：

| 字段 | 说明 |
|------|------|
| 名称 | 显示名称，如「阿里云百炼」 |
| 类型 | `openai` 或 `anthropic` |
| Base URL | 提供商的 API 端点地址 |
| API Key | 提供商的 API 密钥 |
| 默认模型 | 该提供商的默认模型 |

### 3. 配置模型

在厂商详情中，可以为每个提供商添加支持的模型。模型会在「模型目录」中统一展示。

### 4. 配置应用（API Key）

进入「应用管理」，创建应用：

| 字段 | 说明 |
|------|------|
| 名称 | 应用名称，如「Web 应用」 |
| 厂商 | 可选，指定该应用使用的提供商 |
| 模型 | 可选，指定该应用使用的默认模型 |

### 5. 使用代理

**推荐用法**：将模型名设置为 `llmproxy`

客户端请求示例：

```bash
curl -X POST http://localhost:3000/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_APP_KEY" \
  -d '{
    "model": "llmproxy",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

当模型名为 `llmproxy` 时，代理会按以下优先级确定实际使用的模型：
1. 应用配置的专属模型
2. 提供商的默认模型
3. 全局默认模型

### 6. 配置模型转换规则

进入「模型规则」页面，添加转换规则：

| 字段 | 说明 |
|------|------|
| 匹配模式 | 支持通配符，如 `gpt-4*`、`claude-3*` |
| 目标模型 | 转换后的实际模型名 |
| 优先级 | 数字越大优先级越高 |
| 启用 | 是否启用此规则 |

例如：
- 匹配模式：`gpt-4*` → 目标模型：`glm-4`
- 匹配模式：`claude-3*` → 目标模型：`qwen3.5-plus`

---

## API 端点

| 端点 | 说明 |
|------|------|
| `POST /proxy/*` | LLM 代理入口 |
| `GET /healthz` | 健康检查 |
| `POST /api/auth/login` | 管理员登录 |
| `/api/providers/*` | 提供商管理 |
| `/api/keys/*` | 应用管理 |
| `/api/models/*` | 模型管理 |
| `/api/model-rules/*` | 规则管理 |
| `/api/stats` | 统计数据 |
| `/api/logs` | 请求日志 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `DB_PATH` | `database.sqlite` | 数据库文件路径 |
| `NODE_ENV` | `development` | 运行环境 |

---

## 技术栈

- **后端**：Node.js + Express + SQLite + Socket.io
- **前端**：Vue 3 + Vite + Tailwind CSS + ECharts
- **部署**：Docker

---

## 注意事项

1. **安全**：生产环境请修改默认管理员密码，并使用强 API Key
2. **数据持久化**：Docker 部署时务必挂载卷 `/data` 以持久化数据库
3. **模型选择**：建议客户端统一使用 `llmproxy` 作为模型名，由服务端统一管理实际模型