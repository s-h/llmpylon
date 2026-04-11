# Contributing

Thanks for your interest in improving llmPylon.

## Development

- Node.js 20+ (aligned with the Docker image)
- Install dependencies at the repo root and under `client/`:

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

- Production UI: `cd client && npm run build`, then `npm run server`

## Before opening a PR

- Ensure the client build succeeds locally
- Describe motivation and behavior changes (screenshots when helpful)

## Conduct

Keep discussions respectful and technical. For sensitive security issues, see [SECURITY.md](SECURITY.md).

---

[简体中文](CONTRIBUTING.md)