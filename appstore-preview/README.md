# App Store Preview Composer

## UI Screenshots

![Design Settings and Live Preview](docs/screenshots/design-settings-live-preview.png)
![Canvas List Overview](docs/screenshots/canvas-list-overview.png)

`appstore-preview` is a browser-based composer for iPhone App Store preview assets.
It is built with React + TypeScript + Tailwind + shadcn-style UI components and runs fully on the client (no backend required).

## i18n Automation API

This project now includes an optional local API server for i18n and batch automation.

Base URLs:
- Browser (recommended): `/api` (proxied by Vite dev server)
- `http://localhost:4318/api`

Run both Web + API (single command):

```bash
npm run dev
```

Recommended for local use:

```bash
npm run dev
```

Standalone API only:

```bash
npm run api:dev
```

Main endpoints:
- `GET /api/projects`
  - List all projects visible to the API (`.project-saves/*.appstore-preview-project.json`)
- `GET /api/projects/:projectId`
  - Read one project (`project` summary + `state`)
- `GET /api/projects/full`
  - Full read dump for all local projects (`state` + `metas` + `rawFile`)
- `POST /api/projects/:projectId/clone`
  - Clone an existing project
- `GET /api/projects/:projectId/full`
  - Full read dump for one project (`state` + `metas` + `rawFile`)
- `PATCH /api/projects/:projectId/canvases/:canvasId/text-boxes/:textBoxId`
  - Update one text box (`text`, `width`, `fontSize`, `fontKey`, `color`, `x`, `y`)
- `PATCH /api/projects/:projectId/canvases/:canvasId/text-boxes`
  - Bulk update text boxes via `updates: [{ id, ...patch }]`
- `GET /api/projects/:projectId/canvases/:canvasId/text-boxes/:textBoxId/meta`
  - Text box meta including wrapped lines and `lineCount`
- `GET /api/projects/:projectId/canvases/:canvasId/meta`
  - Full canvas shape meta (background, iPhone frame, all text boxes)
- `GET /api/projects/:projectId/meta`
  - Full project shape meta for all canvases
- `POST /api/projects/:projectId/export/zip`
  - Export ZIP with project JSON, per-canvas meta/state, i18n text map, preview PNG

Notes:
- ZIP export includes media references but does not embed original media binaries.
- The API can import/operate on saved project payloads using `POST /api/projects/import`.
- When running `npm run dev`, the GUI auto-loads API projects on startup and auto-syncs the active GUI project back to API.
- For `full` read endpoints, query params are supported:
  - `includeMeta=true|false` (default: `true`)
  - `includeRawFile=true|false` (default: `true`)

Quick read examples:

```bash
# list summaries
curl -s http://localhost:4318/api/projects

# read one project state
curl -s http://localhost:4318/api/projects/<projectId>

# read full dump for all projects (with meta + raw file)
curl -s "http://localhost:4318/api/projects/full?includeMeta=true&includeRawFile=true"

# read full dump for one project (skip raw file if not needed)
curl -s "http://localhost:4318/api/projects/<projectId>/full?includeMeta=true&includeRawFile=false"
```

## What This Project Is

- A visual editor for App Store-style iPhone preview images/videos
- A multi-project, multi-canvas workflow tool for marketing asset production
- A frontend-only app with local persistence and export support

## Features

- Multi-project workflow
- Multi-canvas per project (add, duplicate, rename, delete, reorder by drag and drop)
- iPhone screen media upload (image/video) via file picker or drag and drop
- Background styling (solid color or gradient with angle control)
- Draggable iPhone frame and text boxes, including center snap guides
- Text box editing:
  - On-canvas inline editing (double-click or Enter)
  - Font family, color, font size, and width controls
  - Numeric input + slider for size/width controls
- Export:
  - Single-canvas export (image input -> PNG, video input -> browser-supported video format)
  - Full-project ZIP export for all canvases
- Auto-save:
  - Project state in local browser storage
  - Optional file-based auto-save to a selected folder (`.project-saves/`)
- Undo/Redo:
  - Supports content and structural changes (including canvas/project delete/recover)
  - History is in-memory and resets after page refresh

## Canvas Presets

Includes `886x1920` plus additional iPhone-focused presets:

- `1260x2736`
- `1320x2868`
- `1290x2796`
- `1242x2688`
- `1284x2778`
- `1206x2622`
- `1179x2556`
- `1125x2436`
- `1080x2340`
- `1170x2532`

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- shadcn-style component setup
- JSZip (project ZIP export)

## Getting Started

```bash
npm install
npm run dev
```

Open the local URL shown by Vite in your browser.

## Scripts

```bash
npm run dev      # start development server
npm run build    # production build
npm run lint     # eslint
npm run preview  # preview production build
```

## Notes

- Video export format depends on browser `MediaRecorder` support.
- Project media files are stored in IndexedDB for restore across reloads.
