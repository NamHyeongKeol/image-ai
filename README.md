# image-ai Workspace

This repository is a workspace that groups multiple subprojects related to image/design tooling.

## Projects

- `mosaic-ai/`
  - Main Next.js project (existing app)
- `appstore-preview/`
  - Standalone React tool for composing iPhone App Store preview assets

## Repository Layout

```text
image-ai/
├─ mosaic-ai/
├─ appstore-preview/
├─ package.json
└─ .gitignore
```

## Root Scripts

The root `package.json` currently proxies commands to `mosaic-ai`:

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Working With Subprojects

### mosaic-ai

From the repository root:

```bash
npm run install:mosaic-ai
npm run dev
```

### appstore-preview

Run commands directly in its folder:

```bash
cd appstore-preview
npm install
npm run dev
```

Or from root without changing directories:

```bash
npm --prefix ./appstore-preview install
npm --prefix ./appstore-preview run dev
```

## Notes

- Each subproject manages its own dependencies and build pipeline.
- `appstore-preview` is frontend-only (no backend service required).
