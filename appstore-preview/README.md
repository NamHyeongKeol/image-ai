# App Store Preview Composer

`appstore-preview` is a browser-based composer for iPhone App Store preview assets.
It is built with React + TypeScript + Tailwind + shadcn-style UI components and runs fully on the client (no backend required).

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
