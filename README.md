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

API Quick Links:
- [appstore-preview API section](appstore-preview/README.md#i18n-automation-api)

### appstore-preview API Usage (Detailed)

Purpose:
- i18n automation workflow over saved projects/canvases/text boxes

Base URL:
- Browser (recommended): `/api` (Vite proxy)
- `http://localhost:4318/api`

Run both Web + API with one command:

```bash
cd appstore-preview
npm run dev
```

API only (optional):

```bash
cd appstore-preview
npm run api:dev
```

Common flow:
1. List projects: `GET /api/projects`
2. Read one project: `GET /api/projects/:projectId`
3. Read full local dump (all projects): `GET /api/projects/full`
4. Clone project: `POST /api/projects/:projectId/clone`
5. Delete project: `DELETE /api/projects/:projectId`
6. Update translated text boxes:
   - single: `PATCH /api/projects/:projectId/canvases/:canvasId/text-boxes/:textBoxId`
   - bulk: `PATCH /api/projects/:projectId/canvases/:canvasId/text-boxes`
7. Verify wrapping/line metadata:
   - text box meta: `GET /api/projects/:projectId/canvases/:canvasId/text-boxes/:textBoxId/meta`
8. Verify full shape metadata:
   - canvas meta: `GET /api/projects/:projectId/canvases/:canvasId/meta`
   - project meta: `GET /api/projects/:projectId/meta`
9. Export as ZIP: `POST /api/projects/:projectId/export/zip`

Example requests:

```bash
# 1) project list
curl -s http://localhost:4318/api/projects

# 2) clone project
curl -s -X POST http://localhost:4318/api/projects/<projectId>/clone \
  -H "Content-Type: application/json" \
  -d '{"name":"Korean i18n Copy"}'

# 3) read one project
curl -s http://localhost:4318/api/projects/<projectId>

# 4) full read (all local projects)
curl -s "http://localhost:4318/api/projects/full?includeMeta=true&includeRawFile=true"

# 5) full read (one project)
curl -s "http://localhost:4318/api/projects/<projectId>/full?includeMeta=true&includeRawFile=false"

# 6) delete project
curl -s -X DELETE http://localhost:4318/api/projects/<projectId>

# 7) patch one text box
curl -s -X PATCH http://localhost:4318/api/projects/<projectId>/canvases/<canvasId>/text-boxes/<textBoxId> \
  -H "Content-Type: application/json" \
  -d '{"text":"새 번역 문구","width":540,"fontSize":64}'

# 8) patch multiple text boxes
curl -s -X PATCH http://localhost:4318/api/projects/<projectId>/canvases/<canvasId>/text-boxes \
  -H "Content-Type: application/json" \
  -d '{"updates":[{"id":"text-1","text":"문구 A","width":520},{"id":"text-2","text":"문구 B","fontSize":56}]}'

# 9) line-wrap/meta check
curl -s http://localhost:4318/api/projects/<projectId>/canvases/<canvasId>/text-boxes/<textBoxId>/meta

# 10) full project meta
curl -s http://localhost:4318/api/projects/<projectId>/meta

# 11) zip export
curl -L -X POST http://localhost:4318/api/projects/<projectId>/export/zip \
  -H "Content-Type: application/json" \
  -d '{"includePngPreview":true}' \
  -o appstore-preview-export.zip
```

Notes:
- Text box metadata includes `lineCount`, wrapped lines, and line classification.
- Shape metadata includes background, phone frame, and all text boxes.
- ZIP export contains project/canvas JSON + i18n text map + preview PNG (media binaries are referenced, not embedded).
- In integrated dev mode (`npm run dev`), GUI projects and API projects are auto-merged/synced.
- Unified storage path: `appstore-preview/.project-saves/*.appstore-preview-project.json`.
- GUI/API now share one SoT on API file storage; runtime project state no longer depends on browser `localStorage`.
- Legacy `localStorage` project data is imported once to API storage (migration) for backward compatibility.
- Full read endpoints support:
  - `includeMeta=true|false` (default: `true`)
  - `includeRawFile=true|false` (default: `true`)

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
