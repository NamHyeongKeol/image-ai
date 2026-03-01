![App Store Preview - Design Settings and Live Preview](appstore-preview/docs/screenshots/design-settings-live-preview.png)
![App Store Preview - Canvas List Overview](appstore-preview/docs/screenshots/canvas-list-overview.png)

# image-ai Workspace

`image-ai` is a multi-project workspace for visual content tooling.
It currently includes two independent products:

- `mosaic-ai`: image privacy/editing app (mosaic brush workflow)
- `appstore-preview`: App Store screenshot/video composer for iPhone layouts

## Project Overview

### 1. `appstore-preview/` (React + TypeScript)

Purpose:
- Build App Store-ready marketing assets from uploaded image/video media
- Organize work by project and multi-canvas timeline/list

What it provides:
- iPhone frame preview with draggable/resizable placement
- Drag-and-drop + file-picker upload (image/video)
- Text box system (create, inline edit, duplicate, delete, resize, move)
- Background style controls (solid/gradient, angle)
- Multiple iPhone canvas presets (including 886x1920 and additional preset sizes)
- Snap guides (center magnet behavior)
- Undo/Redo for editing and structural actions
- Canvas-level export and full project ZIP export
- Auto-save for project state and media mapping
- Optional local API for i18n automation:
  - project clone
  - text box patch (single/bulk)
  - text box line-wrap metadata
  - full shape metadata
  - ZIP export API

Tech stack:
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- shadcn-style component setup
- Node.js API module (`appstore-preview/api`)

Docs:
- [appstore-preview README](appstore-preview/README.md)

### 2. `mosaic-ai/` (Next.js)

Purpose:
- Quickly apply privacy mosaic (pixelation) to sensitive areas in images

What it provides:
- Browser-based image upload (`png/jpg/webp`, size validation included)
- Brush-based mosaic painting on canvas
- Adjustable brush size
- Smooth stroke interpolation while dragging
- Undo/Redo support with keyboard shortcuts (`Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, `Ctrl+Y`)
- PNG download export

Tech stack:
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4

Docs:
- [mosaic-ai README](mosaic-ai/README.md)

## Repository Layout

```text
image-ai/
├─ mosaic-ai/          # Next.js-based mosaic editor
├─ appstore-preview/   # React/Vite App Store preview composer
├─ package.json        # Root convenience scripts (mosaic-ai proxy)
└─ .gitignore
```

## Root Scripts

The root scripts proxy to `mosaic-ai`:

```bash
npm run install:mosaic-ai
npm run dev
npm run build
npm run start
npm run lint
```

## Running Each Project

### Run `mosaic-ai` from root

```bash
npm run install:mosaic-ai
npm run dev
```

### Run `appstore-preview` directly

```bash
cd appstore-preview
npm install
npm run dev
```

Or from root:

```bash
npm --prefix ./appstore-preview install
npm --prefix ./appstore-preview run dev
```

## Notes

- Both projects are frontend-first and can run independently.
- Each subproject has isolated dependencies and its own build pipeline.
- Root scripts are intentionally minimal and currently focused on `mosaic-ai`.
