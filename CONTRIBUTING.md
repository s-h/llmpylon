# 参与贡献

感谢你有兴趣改进 llmPylon。

## 开发环境

- Node.js 20+（与 Docker 镜像一致）
- 根目录与 `client/` 分别安装依赖：

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

- 生产前端构建：`cd client && npm run build`，再 `npm run server`

## 提交 PR 前

- 确认本地能完成前端 `npm run build`
- 说明变更动机与主要行为变化（必要时附截图）

## 行为准则

请保持讨论尊重、聚焦技术问题。严重安全漏洞请见 [SECURITY.md](SECURITY.md)。

---

[English](CONTRIBUTING.en.md)