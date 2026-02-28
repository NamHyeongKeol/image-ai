import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  DragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ClipboardPaste,
  Copy,
  Download,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Palette,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type MediaKind = 'image' | 'video' | null;
type BackgroundMode = 'solid' | 'gradient';
type ArtifactKind = 'image' | 'video';
type FontKey = (typeof FONT_OPTIONS)[number]['key'];
type DragTarget = 'phone' | 'text-box';

interface Offset {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextBoxModel {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  fontKey: FontKey;
  fontSize: number;
  color: string;
}

interface TextBoxLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lineHeight: number;
  lines: string[];
  fontFamily: string;
  fontSize: number;
  color: string;
  bounds: Rect;
}

interface PhoneLayout {
  body: Rect;
  screen: Rect;
  radius: number;
  screenRadius: number;
  notch: Rect;
}

interface LayoutMetrics {
  phone: PhoneLayout;
  textBoxes: TextBoxLayout[];
}

interface Artifact {
  kind: ArtifactKind;
  mimeType: string;
  fileName: string;
  url: string;
}

interface CanvasDesignState {
  backgroundMode: BackgroundMode;
  backgroundPrimary: string;
  backgroundSecondary: string;
  gradientAngle: number;
  phoneOffset: Offset;
  phoneScale: number;
  textBoxes: TextBoxModel[];
  media: {
    kind: MediaKind;
    name: string;
  };
}

interface ProjectCanvasRecord {
  id: string;
  name: string;
  state: CanvasDesignState;
  thumbnailDataUrl?: string;
}

interface ProjectDesignState {
  canvases: ProjectCanvasRecord[];
  currentCanvasId: string;
}

interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  state: ProjectDesignState;
}

interface ProjectFilePayload {
  version: 2;
  project: {
    id: string;
    name: string;
    updatedAt: string;
  };
  canvas: {
    width: number;
    height: number;
  };
  state: ProjectDesignState;
}

interface DrawOptions {
  width: number;
  height: number;
  backgroundMode: BackgroundMode;
  backgroundPrimary: string;
  backgroundSecondary: string;
  gradientAngle: number;
  phoneOffset: Offset;
  phoneScale: number;
  textBoxes: TextBoxModel[];
  selectedTextBoxId: string | null;
  showGuides: boolean;
  snapGuide?: {
    vertical: boolean;
    horizontal: boolean;
  };
  emptyStateFileLabel?: string;
  media: HTMLImageElement | HTMLVideoElement | null;
}

interface DragSession {
  target: DragTarget;
  pointerId: number;
  startPoint: Offset;
  startPhoneOffset: Offset;
  textBoxId?: string;
  startTextBoxPosition?: Offset;
  startTextBoxSize?: { width: number; height: number };
  moved: boolean;
}

const CANVAS_PRESET = { label: '886 x 1920 (기본)', width: 886, height: 1920 } as const;

const BASE_PHONE_WIDTH = CANVAS_PRESET.width - 220;
const BASE_PHONE_HEIGHT = 1400;
const CENTER_SNAP_THRESHOLD_PX = 5;

const FONT_OPTIONS = [
  { key: 'pretendard', label: 'Pretendard', family: 'Pretendard, "Noto Sans KR", sans-serif' },
  { key: 'noto', label: 'Noto Sans KR', family: '"Noto Sans KR", sans-serif' },
  { key: 'nanum', label: 'Nanum Myeongjo', family: '"Nanum Myeongjo", serif' },
  { key: 'black-han', label: 'Black Han Sans', family: '"Black Han Sans", sans-serif' },
] as const;

const DEFAULTS = {
  backgroundMode: 'solid' as BackgroundMode,
  backgroundPrimary: '#f2f4f7',
  backgroundSecondary: '#dbeafe',
  gradientAngle: 26,
  phoneScale: 1,
};

const LOCAL_PROJECTS_STORAGE_KEY = 'appstore-preview.projects.v1';
const LOCAL_CURRENT_PROJECT_STORAGE_KEY = 'appstore-preview.current-project.v1';
const PROJECT_AUTOSAVE_DELAY_MS = 700;
const CANVAS_THUMBNAIL_AUTOSAVE_DELAY_MS = 280;
const CANVAS_THUMBNAIL_WIDTH = 154;
const CANVAS_THUMBNAIL_HEIGHT = Math.round((CANVAS_THUMBNAIL_WIDTH * CANVAS_PRESET.height) / CANVAS_PRESET.width);
const PROJECT_MEDIA_DB_NAME = 'appstore-preview-media-db';
const PROJECT_MEDIA_DB_VERSION = 1;
const PROJECT_MEDIA_STORE_NAME = 'project_media';

interface FileHandleLike {
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface DirectoryHandleLike {
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryHandleLike>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandleLike>;
}

interface ProjectMediaRecord {
  projectId: string;
  kind: Exclude<MediaKind, null>;
  name: string;
  type: string;
  blob: Blob;
  updatedAt: string;
}

function createEmptyCanvasState(): CanvasDesignState {
  return {
    backgroundMode: DEFAULTS.backgroundMode,
    backgroundPrimary: DEFAULTS.backgroundPrimary,
    backgroundSecondary: DEFAULTS.backgroundSecondary,
    gradientAngle: DEFAULTS.gradientAngle,
    phoneOffset: { x: 0, y: 0 },
    phoneScale: DEFAULTS.phoneScale,
    textBoxes: [],
    media: {
      kind: null,
      name: '',
    },
  };
}

function cloneCanvasState(state: CanvasDesignState): CanvasDesignState {
  return {
    ...state,
    phoneOffset: { ...state.phoneOffset },
    textBoxes: state.textBoxes.map((box) => ({ ...box })),
    media: { ...state.media },
  };
}

function createProjectId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `project-${crypto.randomUUID()}`;
  }

  return `project-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function createCanvasId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `canvas-${crypto.randomUUID()}`;
  }

  return `canvas-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function createCanvasRecord(name: string, state: CanvasDesignState = createEmptyCanvasState()): ProjectCanvasRecord {
  return {
    id: createCanvasId(),
    name,
    state: cloneCanvasState(state),
    thumbnailDataUrl: undefined,
  };
}

function createProjectDesignState(initialCanvas?: ProjectCanvasRecord): ProjectDesignState {
  const firstCanvas = initialCanvas ?? createCanvasRecord('캔버스 1');
  return {
    canvases: [
      {
        id: firstCanvas.id,
        name: firstCanvas.name,
        state: cloneCanvasState(firstCanvas.state),
        thumbnailDataUrl: firstCanvas.thumbnailDataUrl,
      },
    ],
    currentCanvasId: firstCanvas.id,
  };
}

function createProjectRecord(name: string, state: ProjectDesignState = createProjectDesignState()): ProjectRecord {
  return {
    id: createProjectId(),
    name,
    updatedAt: new Date().toISOString(),
    state: {
      currentCanvasId: state.currentCanvasId,
      canvases: state.canvases.map((canvas) => ({
        id: canvas.id,
        name: canvas.name,
        state: cloneCanvasState(canvas.state),
        thumbnailDataUrl: canvas.thumbnailDataUrl,
      })),
    },
  };
}

function getNextTextBoxSerial(textBoxes: TextBoxModel[]) {
  return (
    textBoxes.reduce((maximum, box) => {
      const numeric = Number(box.id.replace(/^text-/, ''));
      if (Number.isNaN(numeric)) {
        return maximum;
      }

      return Math.max(maximum, numeric);
    }, 0) + 1
  );
}

function createNextProjectName(projects: ProjectRecord[]) {
  const existing = new Set(projects.map((project) => project.name));
  let index = projects.length + 1;

  while (existing.has(`프로젝트 ${index}`)) {
    index += 1;
  }

  return `프로젝트 ${index}`;
}

function createNextCanvasName(canvases: ProjectCanvasRecord[]) {
  const existing = new Set(canvases.map((canvas) => canvas.name));
  let index = canvases.length + 1;

  while (existing.has(`캔버스 ${index}`)) {
    index += 1;
  }

  return `캔버스 ${index}`;
}

function sanitizeFileNameSegment(name: string) {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 60) || 'project';
}

function buildProjectCanvasMediaKey(projectId: string, canvasId: string) {
  return `${projectId}::${canvasId}`;
}

function sanitizeCanvasState(state: unknown): CanvasDesignState {
  if (!state || typeof state !== 'object') {
    return createEmptyCanvasState();
  }

  const fallback = createEmptyCanvasState();
  const raw = state as Partial<CanvasDesignState>;
  const rawMedia = raw.media;

  return {
    backgroundMode: raw.backgroundMode === 'gradient' ? 'gradient' : 'solid',
    backgroundPrimary: typeof raw.backgroundPrimary === 'string' ? raw.backgroundPrimary : fallback.backgroundPrimary,
    backgroundSecondary: typeof raw.backgroundSecondary === 'string' ? raw.backgroundSecondary : fallback.backgroundSecondary,
    gradientAngle: typeof raw.gradientAngle === 'number' ? raw.gradientAngle : fallback.gradientAngle,
    phoneOffset:
      raw.phoneOffset && typeof raw.phoneOffset === 'object'
        ? {
            x: typeof raw.phoneOffset.x === 'number' ? raw.phoneOffset.x : 0,
            y: typeof raw.phoneOffset.y === 'number' ? raw.phoneOffset.y : 0,
          }
        : { ...fallback.phoneOffset },
    phoneScale: typeof raw.phoneScale === 'number' ? raw.phoneScale : fallback.phoneScale,
    textBoxes: Array.isArray(raw.textBoxes)
      ? raw.textBoxes
          .filter((box): box is TextBoxModel => Boolean(box && typeof box === 'object'))
          .map((box, index) => ({
            id: typeof box.id === 'string' && box.id ? box.id : `text-legacy-${index}`,
            text: typeof box.text === 'string' ? box.text : '',
            x: typeof box.x === 'number' ? box.x : 0,
            y: typeof box.y === 'number' ? box.y : 0,
            width: typeof box.width === 'number' ? box.width : 320,
            fontKey:
              typeof box.fontKey === 'string' && FONT_OPTIONS.some((option) => option.key === box.fontKey)
                ? box.fontKey
                : FONT_OPTIONS[0].key,
            fontSize: typeof box.fontSize === 'number' ? box.fontSize : 48,
            color: typeof box.color === 'string' ? box.color : '#1f3b7c',
          }))
      : [],
    media: {
      kind: rawMedia?.kind === 'image' || rawMedia?.kind === 'video' ? rawMedia.kind : null,
      name: typeof rawMedia?.name === 'string' ? rawMedia.name : '',
    },
  };
}

function sanitizeProjectState(state: unknown): ProjectDesignState {
  if (!state || typeof state !== 'object') {
    return createProjectDesignState();
  }

  const raw = state as { canvases?: unknown; currentCanvasId?: unknown };
  if (Array.isArray(raw.canvases)) {
    const canvases = raw.canvases
      .filter((canvas): canvas is { id?: unknown; name?: unknown; state?: unknown } =>
        Boolean(canvas && typeof canvas === 'object'),
      )
      .map((canvas, index) => ({
        id: typeof canvas.id === 'string' && canvas.id ? canvas.id : createCanvasId(),
        name: typeof canvas.name === 'string' && canvas.name.trim() ? canvas.name.trim() : `캔버스 ${index + 1}`,
        state: sanitizeCanvasState(canvas.state ?? canvas),
        thumbnailDataUrl:
          typeof (canvas as { thumbnailDataUrl?: unknown }).thumbnailDataUrl === 'string'
            ? (canvas as { thumbnailDataUrl: string }).thumbnailDataUrl
            : undefined,
      }));

    const safeCanvases = canvases.length > 0 ? canvases : [createCanvasRecord('캔버스 1')];
    const requestedCurrentId = typeof raw.currentCanvasId === 'string' ? raw.currentCanvasId : safeCanvases[0].id;
    const currentCanvasId = safeCanvases.some((canvas) => canvas.id === requestedCurrentId)
      ? requestedCurrentId
      : safeCanvases[0].id;

    return {
      canvases: safeCanvases.map((canvas) => ({
        id: canvas.id,
        name: canvas.name,
        state: cloneCanvasState(canvas.state),
        thumbnailDataUrl: canvas.thumbnailDataUrl,
      })),
      currentCanvasId,
    };
  }

  const legacyCanvas = createCanvasRecord('캔버스 1', sanitizeCanvasState(state));
  return createProjectDesignState(legacyCanvas);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function parseStoredProjects(raw: string | null) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is { id?: unknown; name?: unknown; updatedAt?: unknown; state?: unknown } =>
          Boolean(item && typeof item === 'object'),
      )
      .map((item) => {
        if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.updatedAt !== 'string') {
          return null;
        }

        return {
          id: item.id,
          name: item.name,
          updatedAt: item.updatedAt,
          state: sanitizeProjectState(item.state),
        } satisfies ProjectRecord;
      })
      .filter((item): item is ProjectRecord => Boolean(item));
  } catch {
    return [];
  }
}

function getInitialProjectStore() {
  const fallback = createProjectRecord('프로젝트 1');

  if (typeof window === 'undefined') {
    return {
      projects: [fallback],
      currentProjectId: fallback.id,
    };
  }

  const storedProjects = parseStoredProjects(window.localStorage.getItem(LOCAL_PROJECTS_STORAGE_KEY));
  if (storedProjects.length === 0) {
    return {
      projects: [fallback],
      currentProjectId: fallback.id,
    };
  }

  const storedCurrentProjectId = window.localStorage.getItem(LOCAL_CURRENT_PROJECT_STORAGE_KEY);
  const currentProjectId = storedProjects.some((project) => project.id === storedCurrentProjectId)
    ? (storedCurrentProjectId as string)
    : storedProjects[0].id;

  return {
    projects: storedProjects,
    currentProjectId,
  };
}

async function openProjectMediaDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PROJECT_MEDIA_DB_NAME, PROJECT_MEDIA_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_MEDIA_STORE_NAME)) {
        db.createObjectStore(PROJECT_MEDIA_STORE_NAME, { keyPath: 'projectId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열지 못했습니다.'));
  });
}

async function saveProjectMediaRecord(record: ProjectMediaRecord) {
  const db = await openProjectMediaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PROJECT_MEDIA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROJECT_MEDIA_STORE_NAME);
    store.put(record);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('미디어 저장에 실패했습니다.'));
    tx.onabort = () => reject(tx.error ?? new Error('미디어 저장이 중단되었습니다.'));
  });
  db.close();
}

async function readProjectMediaRecord(projectId: string) {
  const db = await openProjectMediaDb();
  const result = await new Promise<ProjectMediaRecord | null>((resolve, reject) => {
    const tx = db.transaction(PROJECT_MEDIA_STORE_NAME, 'readonly');
    const store = tx.objectStore(PROJECT_MEDIA_STORE_NAME);
    const request = store.get(projectId);

    request.onsuccess = () => {
      const value = request.result as ProjectMediaRecord | undefined;
      resolve(value ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error('미디어 조회에 실패했습니다.'));
  });
  db.close();
  return result;
}

async function removeProjectMediaRecord(projectId: string) {
  const db = await openProjectMediaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PROJECT_MEDIA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROJECT_MEDIA_STORE_NAME);
    store.delete(projectId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('미디어 삭제에 실패했습니다.'));
    tx.onabort = () => reject(tx.error ?? new Error('미디어 삭제가 중단되었습니다.'));
  });
  db.close();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function applyCenterSnap(
  position: Offset,
  size: { width: number; height: number },
  canvas: { width: number; height: number },
  threshold: { x: number; y: number },
) {
  let nextX = position.x;
  let nextY = position.y;

  const centerX = position.x + size.width / 2;
  const centerY = position.y + size.height / 2;
  const canvasCenterX = canvas.width / 2;
  const canvasCenterY = canvas.height / 2;

  const snapX = Math.abs(centerX - canvasCenterX) <= threshold.x;
  const snapY = Math.abs(centerY - canvasCenterY) <= threshold.y;

  if (snapX) {
    nextX = canvasCenterX - size.width / 2;
  }

  if (snapY) {
    nextY = canvasCenterY - size.height / 2;
  }

  return {
    position: { x: nextX, y: nextY },
    snapX,
    snapY,
  };
}

function pointInRect(point: Offset, rect: Rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function getFirstMediaFile(files: FileList | null) {
  if (!files) {
    return null;
  }

  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      return file;
    }
  }

  return null;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: BackgroundMode,
  primary: string,
  secondary: string,
  angle: number,
) {
  if (mode === 'solid') {
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const rad = (angle * Math.PI) / 180;
  const halfDiagonal = Math.sqrt(width ** 2 + height ** 2) / 2;
  const cx = width / 2;
  const cy = height / 2;

  const x0 = cx - Math.cos(rad) * halfDiagonal;
  const y0 = cy - Math.sin(rad) * halfDiagonal;
  const x1 = cx + Math.cos(rad) * halfDiagonal;
  const y1 = cy + Math.sin(rad) * halfDiagonal;

  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, primary);
  gradient.addColorStop(1, secondary);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawMediaCover(
  ctx: CanvasRenderingContext2D,
  media: HTMLImageElement | HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = dw / dh;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.drawImage(media, sx, sy, sw, sh, dx, dy, dw, dh);
}

function wrapTextToLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) {
      lines.push('');
      continue;
    }

    const words = paragraph.split(' ');
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
      }

      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
        continue;
      }

      let fragment = '';
      for (const char of word) {
        const charCandidate = `${fragment}${char}`;
        if (ctx.measureText(charCandidate).width <= maxWidth) {
          fragment = charCandidate;
        } else {
          if (fragment.length > 0) {
            lines.push(fragment);
          }
          fragment = char;
        }
      }
      current = fragment;
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [''];
}

function getFontFamily(fontKey: FontKey) {
  return FONT_OPTIONS.find((option) => option.key === fontKey)?.family ?? FONT_OPTIONS[0].family;
}

function computeLayoutMetrics(ctx: CanvasRenderingContext2D, options: DrawOptions): LayoutMetrics {
  const { width, phoneOffset, phoneScale, textBoxes } = options;

  const scaledPhoneWidth = BASE_PHONE_WIDTH * phoneScale;
  const scaledPhoneHeight = BASE_PHONE_HEIGHT * phoneScale;
  const phoneX = (width - scaledPhoneWidth) / 2 + phoneOffset.x;
  const phoneY = 260 + phoneOffset.y;

  const screenInset = 22 * phoneScale;
  const screenX = phoneX + screenInset;
  const screenY = phoneY + screenInset;
  const screenWidth = scaledPhoneWidth - screenInset * 2;
  const screenHeight = scaledPhoneHeight - screenInset * 2;

  const textBoxLayouts: TextBoxLayout[] = textBoxes.map((box) => {
    const fontFamily = getFontFamily(box.fontKey);
    const fontSize = clamp(box.fontSize, 18, 160);
    const widthValue = Math.max(120, box.width);
    const lineHeight = fontSize * 1.2;

    ctx.save();
    ctx.font = `800 ${fontSize}px ${fontFamily}`;
    const lines = wrapTextToLines(ctx, box.text, widthValue);
    ctx.restore();

    const heightValue = Math.max(lineHeight, lines.length * lineHeight);

    return {
      id: box.id,
      x: box.x,
      y: box.y,
      width: widthValue,
      height: heightValue,
      lineHeight,
      lines,
      fontFamily,
      fontSize,
      color: box.color,
      bounds: {
        x: box.x,
        y: box.y,
        width: widthValue,
        height: heightValue,
      },
    };
  });

  return {
    phone: {
      body: { x: phoneX, y: phoneY, width: scaledPhoneWidth, height: scaledPhoneHeight },
      screen: { x: screenX, y: screenY, width: screenWidth, height: screenHeight },
      radius: 104 * phoneScale,
      screenRadius: 76 * phoneScale,
      notch: {
        x: screenX + (screenWidth - 194 * phoneScale) / 2,
        y: screenY + 14 * phoneScale,
        width: 194 * phoneScale,
        height: 46 * phoneScale,
      },
    },
    textBoxes: textBoxLayouts,
  };
}

function drawComposition(ctx: CanvasRenderingContext2D, options: DrawOptions): LayoutMetrics {
  const {
    width,
    height,
    backgroundMode,
    backgroundPrimary,
    backgroundSecondary,
    gradientAngle,
    selectedTextBoxId,
    showGuides,
    snapGuide,
    emptyStateFileLabel,
    media,
  } = options;

  const layout = computeLayoutMetrics(ctx, options);

  fillBackground(ctx, width, height, backgroundMode, backgroundPrimary, backgroundSecondary, gradientAngle);

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (const textLayout of layout.textBoxes) {
    const sourceBox = options.textBoxes.find((box) => box.id === textLayout.id);
    const text = sourceBox?.text ?? '';

    ctx.fillStyle = textLayout.color;
    ctx.font = `800 ${textLayout.fontSize}px ${textLayout.fontFamily}`;

    if (text.trim().length > 0) {
      textLayout.lines.forEach((line, lineIndex) => {
        ctx.fillText(line, textLayout.x, textLayout.y + lineIndex * textLayout.lineHeight);
      });
    }

    if (showGuides) {
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = textLayout.id === selectedTextBoxId ? 3 : 2;
      ctx.strokeStyle = textLayout.id === selectedTextBoxId ? 'rgba(37, 99, 235, 0.9)' : 'rgba(100, 116, 139, 0.5)';
      ctx.strokeRect(textLayout.bounds.x, textLayout.bounds.y, textLayout.bounds.width, textLayout.bounds.height);
      ctx.restore();
    }
  }

  ctx.restore();

  const { body, screen, radius, screenRadius, notch } = layout.phone;

  ctx.save();
  const bodyGradient = ctx.createLinearGradient(body.x, body.y, body.x + body.width, body.y + body.height);
  bodyGradient.addColorStop(0, '#0f172a');
  bodyGradient.addColorStop(0.5, '#111827');
  bodyGradient.addColorStop(1, '#374151');

  roundedRectPath(ctx, body.x, body.y, body.width, body.height, radius);
  ctx.fillStyle = bodyGradient;
  ctx.fill();

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 5 * options.phoneScale;
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  roundedRectPath(ctx, body.x - 5 * options.phoneScale, body.y + 292 * options.phoneScale, 6 * options.phoneScale, 110 * options.phoneScale, 4 * options.phoneScale);
  ctx.fill();
  roundedRectPath(ctx, body.x - 5 * options.phoneScale, body.y + 436 * options.phoneScale, 6 * options.phoneScale, 68 * options.phoneScale, 4 * options.phoneScale);
  ctx.fill();
  roundedRectPath(ctx, body.x + body.width - 1 * options.phoneScale, body.y + 350 * options.phoneScale, 6 * options.phoneScale, 140 * options.phoneScale, 4 * options.phoneScale);
  ctx.fill();

  roundedRectPath(ctx, screen.x, screen.y, screen.width, screen.height, screenRadius);
  ctx.clip();
  ctx.fillStyle = '#dfe5ee';
  ctx.fillRect(screen.x, screen.y, screen.width, screen.height);

  const mediaReady =
    media instanceof HTMLVideoElement
      ? media.readyState >= 2 && media.videoWidth > 0 && media.videoHeight > 0
      : media instanceof HTMLImageElement
        ? media.naturalWidth > 0 && media.naturalHeight > 0
        : false;

  if (media && mediaReady) {
    drawMediaCover(ctx, media, screen.x, screen.y, screen.width, screen.height);
  } else {
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(screen.x, screen.y, screen.width, screen.height);

    const hintPadding = 48 * options.phoneScale;
    const hintWidth = screen.width - hintPadding * 2;
    const hintHeight = 280 * options.phoneScale;
    const hintX = screen.x + hintPadding;
    const hintY = screen.y + screen.height / 2 - hintHeight / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    roundedRectPath(ctx, hintX, hintY, hintWidth, hintHeight, 28 * options.phoneScale);
    ctx.fill();

    ctx.setLineDash([14 * options.phoneScale, 10 * options.phoneScale]);
    ctx.lineWidth = 3 * options.phoneScale;
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.55)';
    ctx.stroke();
    ctx.setLineDash([]);

    const iconCenterX = hintX + hintWidth / 2;
    const iconTopY = hintY + 58 * options.phoneScale;
    const iconSize = 30 * options.phoneScale;

    ctx.beginPath();
    ctx.moveTo(iconCenterX, iconTopY);
    ctx.lineTo(iconCenterX, iconTopY + iconSize);
    ctx.moveTo(iconCenterX - 12 * options.phoneScale, iconTopY + 12 * options.phoneScale);
    ctx.lineTo(iconCenterX, iconTopY);
    ctx.lineTo(iconCenterX + 12 * options.phoneScale, iconTopY + 12 * options.phoneScale);
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.85)';
    ctx.lineWidth = 4 * options.phoneScale;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.font = `800 ${34 * options.phoneScale}px "Noto Sans KR", sans-serif`;
    ctx.fillText('이미지/영상을 업로드해주세요', iconCenterX, hintY + 108 * options.phoneScale);

    ctx.font = `600 ${24 * options.phoneScale}px "Noto Sans KR", sans-serif`;
    ctx.fillStyle = 'rgba(51, 65, 85, 0.88)';
    ctx.fillText(emptyStateFileLabel ?? '선택된 파일 없음', iconCenterX, hintY + 162 * options.phoneScale);

    ctx.font = `600 ${22 * options.phoneScale}px "Noto Sans KR", sans-serif`;
    ctx.fillStyle = 'rgba(30, 64, 175, 0.85)';
    ctx.fillText('드래그 앤 드롭 가능', iconCenterX, hintY + 206 * options.phoneScale);
  }

  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, notch.x, notch.y, notch.width, notch.height, (23 * options.phoneScale));
  ctx.fillStyle = '#020617';
  ctx.fill();
  ctx.restore();

  if (showGuides) {
    ctx.save();
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.strokeRect(body.x, body.y, body.width, body.height);
    ctx.restore();

    if (snapGuide?.vertical || snapGuide?.horizontal) {
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';

      if (snapGuide.vertical) {
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();
      }

      if (snapGuide.horizontal) {
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  return layout;
}

function createCanvasThumbnailDataUrl(
  state: CanvasDesignState,
  media: HTMLImageElement | HTMLVideoElement | null,
) {
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = CANVAS_PRESET.width;
  fullCanvas.height = CANVAS_PRESET.height;

  const fullCtx = fullCanvas.getContext('2d');
  if (!fullCtx) {
    return '';
  }

  drawComposition(fullCtx, {
    width: CANVAS_PRESET.width,
    height: CANVAS_PRESET.height,
    backgroundMode: state.backgroundMode,
    backgroundPrimary: state.backgroundPrimary,
    backgroundSecondary: state.backgroundSecondary,
    gradientAngle: state.gradientAngle,
    phoneOffset: state.phoneOffset,
    phoneScale: state.phoneScale,
    textBoxes: state.textBoxes,
    selectedTextBoxId: null,
    showGuides: false,
    snapGuide: undefined,
    emptyStateFileLabel: state.media.name || '선택된 파일 없음',
    media,
  });

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = CANVAS_THUMBNAIL_WIDTH;
  thumbCanvas.height = CANVAS_THUMBNAIL_HEIGHT;

  const thumbCtx = thumbCanvas.getContext('2d');
  if (!thumbCtx) {
    return '';
  }

  thumbCtx.drawImage(fullCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  return thumbCanvas.toDataURL('image/jpeg', 0.82);
}

function pickRecorderMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function buildOutputFileName(sourceName: string, extension: string) {
  const stem = sourceName.replace(/\.[^/.]+$/, '') || 'appstore-preview';
  const timestamp = Date.now();
  return `${stem}-preview-${timestamp}.${extension}`;
}

async function blobFromCanvas(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('이미지 생성에 실패했습니다.'));
      }
    }, 'image/png');
  });
}

function App() {
  const initialProjectStoreRef = useRef<ReturnType<typeof getInitialProjectStore> | null>(null);
  if (!initialProjectStoreRef.current) {
    initialProjectStoreRef.current = getInitialProjectStore();
  }

  const initialProjectStore = initialProjectStoreRef.current;
  const initialProject =
    initialProjectStore.projects.find((project) => project.id === initialProjectStore.currentProjectId) ??
    initialProjectStore.projects[0];

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const assetUrlRef = useRef<string | null>(null);
  const artifactUrlRef = useRef<string | null>(null);
  const layoutRef = useRef<LayoutMetrics | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressCanvasClickRef = useRef(false);
  const uploadDropDepthRef = useRef(0);
  const canvasDropDepthRef = useRef(0);
  const initialCanvas =
    initialProject.state.canvases.find((canvas) => canvas.id === initialProject.state.currentCanvasId) ??
    initialProject.state.canvases[0];
  const nextTextBoxIdRef = useRef(getNextTextBoxSerial(initialCanvas.state.textBoxes));
  const autoSaveErrorNotifiedRef = useRef(false);
  const mediaRestoreTokenRef = useRef(0);
  const loadedProjectIdRef = useRef<string | null>(null);
  const copiedTextBoxRef = useRef<TextBoxModel | null>(null);

  const [projects, setProjects] = useState<ProjectRecord[]>(initialProjectStore.projects);
  const [currentProjectId, setCurrentProjectId] = useState(initialProject.id);
  const [currentCanvasId, setCurrentCanvasId] = useState(initialCanvas.id);
  const [connectedSaveDirectory, setConnectedSaveDirectory] = useState<DirectoryHandleLike | null>(null);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState('');

  const [assetKind, setAssetKind] = useState<MediaKind>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [assetName, setAssetName] = useState('');

  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(initialCanvas.state.backgroundMode);
  const [backgroundPrimary, setBackgroundPrimary] = useState(initialCanvas.state.backgroundPrimary);
  const [backgroundSecondary, setBackgroundSecondary] = useState(initialCanvas.state.backgroundSecondary);
  const [gradientAngle, setGradientAngle] = useState(initialCanvas.state.gradientAngle);

  const [phoneOffset, setPhoneOffset] = useState<Offset>({ ...initialCanvas.state.phoneOffset });
  const [phoneScale, setPhoneScale] = useState(initialCanvas.state.phoneScale);

  const [textBoxes, setTextBoxes] = useState<TextBoxModel[]>(initialCanvas.state.textBoxes.map((box) => ({ ...box })));
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [isPlacingTextBox, setIsPlacingTextBox] = useState(false);
  const [hasCopiedTextBox, setHasCopiedTextBox] = useState(false);

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isUploadDropActive, setIsUploadDropActive] = useState(false);
  const [isCanvasDropActive, setIsCanvasDropActive] = useState(false);
  const [snapGuide, setSnapGuide] = useState({ vertical: false, horizontal: false });
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState(
    'iPhone 프레임/텍스트박스를 드래그해 배치하고, 이미지/영상을 DnD 또는 클릭 업로드해 주세요.',
  );

  const selectedTextBox = useMemo(
    () => textBoxes.find((box) => box.id === selectedTextBoxId) ?? null,
    [textBoxes, selectedTextBoxId],
  );

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId) ?? null,
    [projects, currentProjectId],
  );

  const currentCanvasState = useMemo<CanvasDesignState>(
    () => ({
      backgroundMode,
      backgroundPrimary,
      backgroundSecondary,
      gradientAngle,
      phoneOffset,
      phoneScale,
      textBoxes: textBoxes.map((box) => ({ ...box })),
      media: {
        kind: assetKind,
        name: assetName,
      },
    }),
    [
      assetKind,
      assetName,
      backgroundMode,
      backgroundPrimary,
      backgroundSecondary,
      gradientAngle,
      phoneOffset,
      phoneScale,
      textBoxes,
    ],
  );

  const currentProjectState = useMemo<ProjectDesignState | null>(() => {
    if (!currentProject) {
      return null;
    }

    const exists = currentProject.state.canvases.some((canvas) => canvas.id === currentCanvasId);
    const targetCanvasId = exists ? currentCanvasId : currentProject.state.currentCanvasId;
    const canvases = currentProject.state.canvases.map((canvas) =>
      canvas.id === targetCanvasId
        ? {
            ...canvas,
            state: cloneCanvasState(currentCanvasState),
          }
        : canvas,
    );

    return {
      canvases,
      currentCanvasId: targetCanvasId,
    };
  }, [currentCanvasId, currentCanvasState, currentProject]);

  const currentProjectCanvases = useMemo(() => currentProjectState?.canvases ?? [], [currentProjectState]);

  const currentCanvas = useMemo(
    () => currentProjectCanvases.find((canvas) => canvas.id === currentCanvasId) ?? null,
    [currentCanvasId, currentProjectCanvases],
  );

  const currentMediaStorageKey = useMemo(() => {
    if (!currentProjectId || !currentCanvasId) {
      return '';
    }

    return buildProjectCanvasMediaKey(currentProjectId, currentCanvasId);
  }, [currentCanvasId, currentProjectId]);

  const toCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const findTopmostTextBoxAtPoint = useCallback((point: Offset, layout: LayoutMetrics) => {
    for (let i = layout.textBoxes.length - 1; i >= 0; i -= 1) {
      const box = layout.textBoxes[i];
      if (pointInRect(point, expandRect(box.bounds, 10))) {
        return box;
      }
    }

    return null;
  }, []);

  const isPointInsidePhoneScreen = useCallback((point: Offset | null) => {
    if (!point || !layoutRef.current) {
      return false;
    }

    return pointInRect(point, layoutRef.current.phone.screen);
  }, []);

  const bringTextBoxToFront = useCallback((targetId: string) => {
    setTextBoxes((previous) => {
      const index = previous.findIndex((item) => item.id === targetId);
      if (index < 0 || index === previous.length - 1) {
        return previous;
      }

      const next = [...previous];
      const [picked] = next.splice(index, 1);
      next.push(picked);
      return next;
    });
  }, []);

  const setAssetObjectUrl = useCallback((nextUrl: string | null) => {
    if (assetUrlRef.current) {
      URL.revokeObjectURL(assetUrlRef.current);
      assetUrlRef.current = null;
    }

    assetUrlRef.current = nextUrl;
    setAssetUrl(nextUrl);
  }, []);

  const clearLoadedMedia = useCallback(() => {
    videoRef.current?.pause();
    videoRef.current = null;
    imageRef.current = null;
    setAssetKind(null);
    setAssetName('');
    setAssetObjectUrl(null);
  }, [setAssetObjectUrl]);

  const getCanvasSnapThreshold = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return { x: CENTER_SNAP_THRESHOLD_PX, y: CENTER_SNAP_THRESHOLD_PX };
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { x: CENTER_SNAP_THRESHOLD_PX, y: CENTER_SNAP_THRESHOLD_PX };
    }

    return {
      x: CENTER_SNAP_THRESHOLD_PX * (canvas.width / rect.width),
      y: CENTER_SNAP_THRESHOLD_PX * (canvas.height / rect.height),
    };
  }, []);

  const updateSnapGuide = useCallback((next: { vertical: boolean; horizontal: boolean }) => {
    setSnapGuide((previous) =>
      previous.vertical === next.vertical && previous.horizontal === next.horizontal
        ? previous
        : next,
    );
  }, []);

  const setArtifactBlob = useCallback((blob: Blob, kind: ArtifactKind, mimeType: string, fileName: string) => {
    if (artifactUrlRef.current) {
      URL.revokeObjectURL(artifactUrlRef.current);
      artifactUrlRef.current = null;
    }

    const url = URL.createObjectURL(blob);
    artifactUrlRef.current = url;
    setArtifact({ kind, mimeType, fileName, url });

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  }, []);

  const applyProjectState = useCallback(
    (project: ProjectRecord, preferredCanvasId?: string) => {
      const targetCanvas =
        project.state.canvases.find((canvas) => canvas.id === (preferredCanvasId ?? project.state.currentCanvasId)) ??
        project.state.canvases[0];

      if (!targetCanvas) {
        return;
      }

      const targetState = targetCanvas.state;
      setCurrentCanvasId(targetCanvas.id);
      setBackgroundMode(targetState.backgroundMode);
      setBackgroundPrimary(targetState.backgroundPrimary);
      setBackgroundSecondary(targetState.backgroundSecondary);
      setGradientAngle(targetState.gradientAngle);
      setPhoneOffset({ ...targetState.phoneOffset });
      setPhoneScale(targetState.phoneScale);
      setTextBoxes(targetState.textBoxes.map((box) => ({ ...box })));
      setSelectedTextBoxId(null);
      setIsPlacingTextBox(false);
      nextTextBoxIdRef.current = getNextTextBoxSerial(targetState.textBoxes);
    },
    [],
  );

  const restoreProjectMedia = useCallback(
    async (project: ProjectRecord, preferredCanvasId?: string) => {
      const targetCanvas =
        project.state.canvases.find((canvas) => canvas.id === (preferredCanvasId ?? project.state.currentCanvasId)) ??
        project.state.canvases[0];
      if (!targetCanvas) {
        return;
      }

      const mediaKey = buildProjectCanvasMediaKey(project.id, targetCanvas.id);
      const token = mediaRestoreTokenRef.current + 1;
      mediaRestoreTokenRef.current = token;
      clearLoadedMedia();
      setErrorMessage('');

      if (typeof indexedDB === 'undefined') {
        setStatusMessage(`${project.name} / ${targetCanvas.name} 캔버스를 불러왔습니다.`);
        return;
      }

      try {
        let record = await readProjectMediaRecord(mediaKey);
        const firstCanvasId = project.state.canvases[0]?.id ?? '';
        if (!record && targetCanvas.id === firstCanvasId) {
          record = await readProjectMediaRecord(project.id);
          if (record) {
            void saveProjectMediaRecord({
              ...record,
              projectId: mediaKey,
              updatedAt: new Date().toISOString(),
            }).catch(() => undefined);
          }
        }

        if (token !== mediaRestoreTokenRef.current) {
          return;
        }

        if (!record) {
          setStatusMessage(`${project.name} / ${targetCanvas.name} 캔버스를 불러왔습니다.`);
          return;
        }

        const objectUrl = URL.createObjectURL(record.blob);
        setAssetObjectUrl(objectUrl);
        setAssetName(record.name);

        if (record.kind === 'image') {
          const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const instance = new Image();
            instance.onload = () => resolve(instance);
            instance.onerror = () => reject(new Error('저장된 이미지를 복원하지 못했습니다.'));
            instance.src = objectUrl;
          });

          if (token !== mediaRestoreTokenRef.current) {
            return;
          }

          videoRef.current?.pause();
          videoRef.current = null;
          imageRef.current = image;
          setAssetKind('image');
          setStatusMessage(`${project.name} / ${targetCanvas.name}: 저장된 이미지를 복원했습니다.`);
          return;
        }

        const video = await new Promise<HTMLVideoElement>((resolve, reject) => {
          const instance = document.createElement('video');
          instance.preload = 'auto';
          instance.playsInline = true;
          instance.muted = true;
          instance.loop = true;
          instance.src = objectUrl;

          const onLoadedData = () => resolve(instance);
          const onError = () => reject(new Error('저장된 영상을 복원하지 못했습니다.'));

          instance.addEventListener('loadeddata', onLoadedData, { once: true });
          instance.addEventListener('error', onError, { once: true });
        });

        if (token !== mediaRestoreTokenRef.current) {
          return;
        }

        await video.play().catch(() => undefined);
        imageRef.current = null;
        videoRef.current = video;
        setAssetKind('video');
        setStatusMessage(`${project.name} / ${targetCanvas.name}: 저장된 영상을 복원했습니다.`);
      } catch (error) {
        if (token !== mediaRestoreTokenRef.current) {
          return;
        }

        clearLoadedMedia();
        setErrorMessage(error instanceof Error ? error.message : '미디어 복원에 실패했습니다.');
        setStatusMessage(`${project.name} / ${targetCanvas.name} 캔버스를 불러왔습니다. 미디어는 다시 업로드해 주세요.`);
      }
    },
    [clearLoadedMedia, setAssetObjectUrl],
  );

  const handleSelectProject = useCallback(
    (nextProjectId: string) => {
      const nextProject = projects.find((project) => project.id === nextProjectId);
      if (!nextProject || !currentProjectState) {
        return;
      }

      const now = new Date().toISOString();
      setProjects((previous) =>
        previous.map((project) =>
          project.id === currentProjectId
            ? {
                ...project,
                updatedAt: now,
                state: currentProjectState,
              }
            : project,
        ),
      );
      setCurrentProjectId(nextProject.id);
      setCurrentCanvasId(nextProject.state.currentCanvasId);
    },
    [currentProjectId, currentProjectState, projects],
  );

  const handleCreateProject = useCallback(() => {
    if (!currentProjectState) {
      return;
    }

    const now = new Date().toISOString();
    const newProject = createProjectRecord(createNextProjectName(projects));
    setProjects((previous) => [
      ...previous.map((project) =>
        project.id === currentProjectId
          ? {
              ...project,
              updatedAt: now,
              state: currentProjectState,
            }
          : project,
      ),
      newProject,
    ]);
    setCurrentProjectId(newProject.id);
    setCurrentCanvasId(newProject.state.currentCanvasId);
  }, [currentProjectId, currentProjectState, projects]);

  const handleSelectCanvas = useCallback(
    (nextCanvasId: string) => {
      if (!currentProject || !currentProjectState || nextCanvasId === currentCanvasId) {
        return;
      }

      if (!currentProjectState.canvases.some((canvas) => canvas.id === nextCanvasId)) {
        return;
      }

      const now = new Date().toISOString();
      const nextState: ProjectDesignState = {
        ...currentProjectState,
        currentCanvasId: nextCanvasId,
      };
      const nextProject: ProjectRecord = {
        ...currentProject,
        updatedAt: now,
        state: nextState,
      };

      setProjects((previous) =>
        previous.map((project) => (project.id === currentProject.id ? nextProject : project)),
      );
      applyProjectState(nextProject, nextCanvasId);
      void restoreProjectMedia(nextProject, nextCanvasId);
    },
    [applyProjectState, currentCanvasId, currentProject, currentProjectState, restoreProjectMedia],
  );

  const handleCreateCanvas = useCallback(() => {
    if (!currentProject || !currentProjectState) {
      return;
    }

    const newCanvas = createCanvasRecord(createNextCanvasName(currentProjectState.canvases));
    const now = new Date().toISOString();
    const nextState: ProjectDesignState = {
      canvases: [...currentProjectState.canvases, newCanvas],
      currentCanvasId: newCanvas.id,
    };
    const nextProject: ProjectRecord = {
      ...currentProject,
      updatedAt: now,
      state: nextState,
    };

    setProjects((previous) => previous.map((project) => (project.id === currentProject.id ? nextProject : project)));
    applyProjectState(nextProject, newCanvas.id);
    void restoreProjectMedia(nextProject, newCanvas.id);
    setStatusMessage('새 캔버스를 추가했습니다.');
  }, [applyProjectState, currentProject, currentProjectState, restoreProjectMedia]);

  const persistProjectFileToDirectory = useCallback(
    async (project: ProjectRecord) => {
      if (!connectedSaveDirectory) {
        return;
      }

      const payload: ProjectFilePayload = {
        version: 2,
        project: {
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
        },
        canvas: {
          width: CANVAS_PRESET.width,
          height: CANVAS_PRESET.height,
        },
        state: project.state,
      };

      const savesDir = await connectedSaveDirectory.getDirectoryHandle('.project-saves', { create: true });
      const safeName = sanitizeFileNameSegment(project.name);
      const fileHandle = await savesDir.getFileHandle(`${safeName}-${project.id}.appstore-preview-project.json`, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
    },
    [connectedSaveDirectory],
  );

  const handleConnectSaveDirectory = useCallback(async () => {
    const pickerWindow = window as Window & {
      showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
    };

    if (typeof pickerWindow.showDirectoryPicker !== 'function') {
      setErrorMessage('현재 브라우저는 폴더 자동 저장을 지원하지 않습니다. Chromium 계열 브라우저를 사용해 주세요.');
      return;
    }

    try {
      const directoryHandle = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
      setConnectedSaveDirectory(directoryHandle);
      autoSaveErrorNotifiedRef.current = false;
      setStatusMessage('저장 폴더가 연결되었습니다. 변경사항을 .project-saves에 자동 저장합니다.');
      setErrorMessage('');
    } catch (error) {
      const domError = error as DOMException;
      if (domError?.name === 'AbortError') {
        return;
      }

      setErrorMessage(error instanceof Error ? error.message : '저장 폴더 연결에 실패했습니다.');
    }
  }, []);

  const addTextBoxAt = useCallback((point: Offset) => {
    const id = `text-${nextTextBoxIdRef.current}`;
    nextTextBoxIdRef.current += 1;

    const width = 460;
    const newBox: TextBoxModel = {
      id,
      text: '텍스트를 입력하세요',
      x: point.x - width / 2,
      y: point.y - 36,
      width,
      fontKey: FONT_OPTIONS[0].key,
      fontSize: 64,
      color: '#1f3b7c',
    };

    setTextBoxes((previous) => [...previous, newBox]);
    setSelectedTextBoxId(id);
    setIsPlacingTextBox(false);
    setStatusMessage('새 텍스트박스를 추가했습니다. 드래그로 위치를 조정하세요.');
    setErrorMessage('');
  }, []);

  const updateSelectedTextBox = useCallback((updater: (box: TextBoxModel) => TextBoxModel) => {
    setTextBoxes((previous) =>
      previous.map((box) => (box.id === selectedTextBoxId ? updater(box) : box)),
    );
  }, [selectedTextBoxId]);

  const copySelectedTextBox = useCallback(() => {
    if (!selectedTextBox) {
      return false;
    }

    copiedTextBoxRef.current = { ...selectedTextBox };
    setHasCopiedTextBox(true);
    setStatusMessage('선택한 텍스트박스를 복사했습니다.');
    setErrorMessage('');
    return true;
  }, [selectedTextBox]);

  const pasteCopiedTextBox = useCallback(() => {
    const source = copiedTextBoxRef.current;
    if (!source) {
      return false;
    }

    const id = `text-${nextTextBoxIdRef.current}`;
    nextTextBoxIdRef.current += 1;
    const duplicated: TextBoxModel = {
      ...source,
      id,
      x: source.x + 24,
      y: source.y + 24,
    };

    setTextBoxes((previous) => [...previous, duplicated]);
    setSelectedTextBoxId(id);
    setIsPlacingTextBox(false);
    setStatusMessage('텍스트박스를 붙여넣었습니다.');
    setErrorMessage('');
    return true;
  }, []);

  const drawCurrentFrame = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = CANVAS_PRESET.width;
    canvas.height = CANVAS_PRESET.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const media = assetKind === 'video' ? videoRef.current : imageRef.current;

    const layout = drawComposition(ctx, {
      width: CANVAS_PRESET.width,
      height: CANVAS_PRESET.height,
      backgroundMode,
      backgroundPrimary,
      backgroundSecondary,
      gradientAngle,
      phoneOffset,
      phoneScale,
      textBoxes,
      selectedTextBoxId,
      showGuides: true,
      snapGuide,
      emptyStateFileLabel: assetName || '선택된 파일 없음',
      media,
    });

    layoutRef.current = layout;
  }, [
    assetName,
    assetKind,
    backgroundMode,
    backgroundPrimary,
    backgroundSecondary,
    gradientAngle,
    phoneOffset,
    phoneScale,
    snapGuide,
    selectedTextBoxId,
    textBoxes,
  ]);

  useEffect(() => {
    drawCurrentFrame();
  }, [drawCurrentFrame]);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (assetKind !== 'video' || !videoRef.current) {
      return;
    }

    const frame = () => {
      drawCurrentFrame();
      rafRef.current = requestAnimationFrame(frame);
    };

    frame();

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [assetKind, drawCurrentFrame]);

  useEffect(() => {
    if (selectedTextBoxId && !textBoxes.some((box) => box.id === selectedTextBoxId)) {
      setSelectedTextBoxId(null);
    }
  }, [selectedTextBoxId, textBoxes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const isDeleteKey = event.key === 'Backspace' || event.key === 'Delete';
      if (isDeleteKey && !event.metaKey && !event.ctrlKey && !event.altKey && selectedTextBoxId) {
        setTextBoxes((previous) => previous.filter((box) => box.id !== selectedTextBoxId));
        setSelectedTextBoxId(null);
        setStatusMessage('선택한 텍스트박스를 삭제했습니다.');
        event.preventDefault();
        return;
      }

      if ((!event.metaKey && !event.ctrlKey) || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'c') {
        if (selectedTextBox && copySelectedTextBox()) {
          event.preventDefault();
        }
        return;
      }

      if (key === 'v') {
        if (hasCopiedTextBox && pasteCopiedTextBox()) {
          event.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [copySelectedTextBox, hasCopiedTextBox, pasteCopiedTextBox, selectedTextBox, selectedTextBoxId]);

  useEffect(() => {
    if (loadedProjectIdRef.current === currentProjectId) {
      return;
    }

    const targetProject = projects.find((project) => project.id === currentProjectId);
    if (!targetProject) {
      return;
    }

    loadedProjectIdRef.current = currentProjectId;
    applyProjectState(targetProject);
    void restoreProjectMedia(targetProject);
  }, [applyProjectState, currentProjectId, projects, restoreProjectMedia]);

  useEffect(() => {
    if (!currentProjectState) {
      return;
    }

    const timer = window.setTimeout(() => {
      const now = new Date().toISOString();
      setProjects((previous) =>
        previous.map((project) =>
          project.id === currentProjectId
            ? {
                ...project,
                updatedAt: now,
                state: currentProjectState,
              }
            : project,
        ),
      );
    }, PROJECT_AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentProjectId, currentProjectState]);

  useEffect(() => {
    if (!currentCanvasId) {
      return;
    }

    const timer = window.setTimeout(() => {
      const media =
        assetKind === 'video' ? videoRef.current : assetKind === 'image' ? imageRef.current : null;
      const thumbnailDataUrl = createCanvasThumbnailDataUrl(currentCanvasState, media);
      if (!thumbnailDataUrl) {
        return;
      }

      setProjects((previous) => {
        let changed = false;
        const next = previous.map((project) => {
          if (project.id !== currentProjectId) {
            return project;
          }

          const canvases = project.state.canvases.map((canvas) => {
            if (canvas.id !== currentCanvasId || canvas.thumbnailDataUrl === thumbnailDataUrl) {
              return canvas;
            }
            changed = true;
            return {
              ...canvas,
              thumbnailDataUrl,
            };
          });

          if (!changed) {
            return project;
          }

          return {
            ...project,
            state: {
              ...project.state,
              canvases,
            },
          };
        });

        return changed ? next : previous;
      });
    }, CANVAS_THUMBNAIL_AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [assetKind, assetUrl, currentCanvasId, currentCanvasState, currentProjectId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LOCAL_PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LOCAL_CURRENT_PROJECT_STORAGE_KEY, currentProjectId);
  }, [currentProjectId]);

  useEffect(() => {
    if (!connectedSaveDirectory || !currentProject) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await persistProjectFileToDirectory(currentProject);
          autoSaveErrorNotifiedRef.current = false;
          setLastAutoSavedAt(new Date().toLocaleTimeString('ko-KR', { hour12: false }));
        } catch (error) {
          if (!autoSaveErrorNotifiedRef.current) {
            setErrorMessage(
              error instanceof Error ? error.message : '자동 파일 저장에 실패했습니다. 저장 폴더를 다시 연결해 주세요.',
            );
            autoSaveErrorNotifiedRef.current = true;
          }
        }
      })();
    }, PROJECT_AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [connectedSaveDirectory, currentProject, persistProjectFileToDirectory]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      if (assetUrlRef.current) {
        URL.revokeObjectURL(assetUrlRef.current);
      }

      if (artifactUrlRef.current) {
        URL.revokeObjectURL(artifactUrlRef.current);
      }

      videoRef.current?.pause();
    };
  }, []);

  const processMediaFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        setErrorMessage('이미지 또는 영상 파일만 업로드할 수 있습니다.');
        setStatusMessage('지원 포맷을 확인해 주세요.');
        return;
      }

      if (!currentMediaStorageKey) {
        setErrorMessage('캔버스가 선택되지 않았습니다. 캔버스를 다시 선택해 주세요.');
        return;
      }

      setErrorMessage('');
      setStatusMessage('미디어를 불러오는 중입니다...');
      setArtifact(null);

      if (artifactUrlRef.current) {
        URL.revokeObjectURL(artifactUrlRef.current);
        artifactUrlRef.current = null;
      }

      const nextUrl = URL.createObjectURL(file);
      setAssetObjectUrl(nextUrl);
      setAssetName(file.name);

      try {
        if (file.type.startsWith('image/')) {
          const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const instance = new Image();
            instance.onload = () => resolve(instance);
            instance.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
            instance.src = nextUrl;
          });

          videoRef.current?.pause();
          videoRef.current = null;
          imageRef.current = image;
          setAssetKind('image');
          setStatusMessage('이미지 업로드 완료. PNG로 출력됩니다.');
          void saveProjectMediaRecord({
            projectId: currentMediaStorageKey,
            kind: 'image',
            name: file.name,
            type: file.type,
            blob: file,
            updatedAt: new Date().toISOString(),
          }).catch(() => {
            setErrorMessage('이미지 캐시 저장에 실패했습니다. 새로고침 시 복원이 안 될 수 있습니다.');
          });
          return;
        }

        const video = await new Promise<HTMLVideoElement>((resolve, reject) => {
          const instance = document.createElement('video');
          instance.preload = 'auto';
          instance.playsInline = true;
          instance.muted = true;
          instance.loop = true;
          instance.src = nextUrl;

          const onLoadedData = () => resolve(instance);
          const onError = () => reject(new Error('영상을 불러오지 못했습니다.'));

          instance.addEventListener('loadeddata', onLoadedData, { once: true });
          instance.addEventListener('error', onError, { once: true });
        });

        await video.play().catch(() => undefined);

        imageRef.current = null;
        videoRef.current = video;
        setAssetKind('video');
        setStatusMessage('영상 업로드 완료. 영상으로 출력됩니다.');
        void saveProjectMediaRecord({
          projectId: currentMediaStorageKey,
          kind: 'video',
          name: file.name,
          type: file.type,
          blob: file,
          updatedAt: new Date().toISOString(),
        }).catch(() => {
          setErrorMessage('영상 캐시 저장에 실패했습니다. 새로고침 시 복원이 안 될 수 있습니다.');
        });
      } catch (error) {
        imageRef.current = null;
        videoRef.current?.pause();
        videoRef.current = null;
        setAssetKind(null);
        setAssetName('');
        setAssetObjectUrl(null);
        setErrorMessage(error instanceof Error ? error.message : '업로드 처리에 실패했습니다.');
        setStatusMessage('파일을 다시 선택해 주세요.');
        if (currentMediaStorageKey) {
          void removeProjectMediaRecord(currentMediaStorageKey).catch(() => undefined);
        }
      }
    },
    [currentMediaStorageKey, setAssetObjectUrl],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';

      if (!file) {
        return;
      }

      void processMediaFile(file);
    },
    [processMediaFile],
  );

  const handleUploadDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    uploadDropDepthRef.current += 1;
    setIsUploadDropActive(true);
  }, []);

  const handleUploadDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleUploadDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    uploadDropDepthRef.current = Math.max(uploadDropDepthRef.current - 1, 0);

    if (uploadDropDepthRef.current === 0) {
      setIsUploadDropActive(false);
    }
  }, []);

  const handleUploadDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      uploadDropDepthRef.current = 0;
      setIsUploadDropActive(false);

      const file = getFirstMediaFile(event.dataTransfer.files);
      if (!file) {
        setErrorMessage('이미지 또는 영상 파일만 업로드할 수 있습니다.');
        return;
      }

      void processMediaFile(file);
    },
    [processMediaFile],
  );

  const handleCanvasDragEnter = useCallback((event: DragEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    canvasDropDepthRef.current += 1;

    const point = toCanvasPoint(event.clientX, event.clientY);
    setIsCanvasDropActive(isPointInsidePhoneScreen(point));
  }, [isPointInsidePhoneScreen, toCanvasPoint]);

  const handleCanvasDragOver = useCallback((event: DragEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';

    const point = toCanvasPoint(event.clientX, event.clientY);
    setIsCanvasDropActive(isPointInsidePhoneScreen(point));
  }, [isPointInsidePhoneScreen, toCanvasPoint]);

  const handleCanvasDragLeave = useCallback((event: DragEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    canvasDropDepthRef.current = Math.max(canvasDropDepthRef.current - 1, 0);

    if (canvasDropDepthRef.current === 0) {
      setIsCanvasDropActive(false);
    }
  }, []);

  const handleCanvasDrop = useCallback(
    (event: DragEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      event.stopPropagation();
      canvasDropDepthRef.current = 0;
      setIsCanvasDropActive(false);

      const point = toCanvasPoint(event.clientX, event.clientY);
      if (!isPointInsidePhoneScreen(point)) {
        setStatusMessage('아이폰 화면 영역 안에 드롭해 주세요.');
        return;
      }

      const file = getFirstMediaFile(event.dataTransfer.files);
      if (!file) {
        setErrorMessage('이미지 또는 영상 파일만 업로드할 수 있습니다.');
        return;
      }

      void processMediaFile(file);
    },
    [isPointInsidePhoneScreen, processMediaFile, toCanvasPoint],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = toCanvasPoint(event.clientX, event.clientY);
      const layout = layoutRef.current;

      if (!point || !layout) {
        return;
      }

      const hitTextBox = findTopmostTextBoxAtPoint(point, layout);

      if (hitTextBox) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.style.cursor = 'grabbing';

        bringTextBoxToFront(hitTextBox.id);
        setSelectedTextBoxId(hitTextBox.id);
        updateSnapGuide({ vertical: false, horizontal: false });
        dragSessionRef.current = {
          target: 'text-box',
          pointerId: event.pointerId,
          startPoint: point,
          startPhoneOffset: phoneOffset,
          textBoxId: hitTextBox.id,
          startTextBoxPosition: { x: hitTextBox.x, y: hitTextBox.y },
          startTextBoxSize: { width: hitTextBox.width, height: hitTextBox.height },
          moved: false,
        };

        return;
      }

      if (pointInRect(point, layout.phone.body)) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.style.cursor = 'grabbing';

        setSelectedTextBoxId(null);
        updateSnapGuide({ vertical: false, horizontal: false });
        dragSessionRef.current = {
          target: 'phone',
          pointerId: event.pointerId,
          startPoint: point,
          startPhoneOffset: phoneOffset,
          moved: false,
        };
        return;
      }

      setSelectedTextBoxId(null);
    },
    [bringTextBoxToFront, findTopmostTextBoxAtPoint, phoneOffset, toCanvasPoint, updateSnapGuide],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = toCanvasPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      const session = dragSessionRef.current;
      const layout = layoutRef.current;
      if (!layout) {
        return;
      }

      if (session && session.pointerId === event.pointerId) {
        const dx = point.x - session.startPoint.x;
        const dy = point.y - session.startPoint.y;
        const snapThreshold = getCanvasSnapThreshold();

        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          session.moved = true;
        }

        if (session.target === 'phone') {
          const phoneWidth = BASE_PHONE_WIDTH * phoneScale;
          const phoneHeight = BASE_PHONE_HEIGHT * phoneScale;
          const basePhoneX = (CANVAS_PRESET.width - phoneWidth) / 2;
          const basePhoneY = 260;

          const snappedPhoneTopLeft = applyCenterSnap(
            {
              x: basePhoneX + session.startPhoneOffset.x + dx,
              y: basePhoneY + session.startPhoneOffset.y + dy,
            },
            { width: phoneWidth, height: phoneHeight },
            { width: CANVAS_PRESET.width, height: CANVAS_PRESET.height },
            snapThreshold,
          );

          updateSnapGuide({
            vertical: snappedPhoneTopLeft.snapX,
            horizontal: snappedPhoneTopLeft.snapY,
          });
          setPhoneOffset({
            x: snappedPhoneTopLeft.position.x - basePhoneX,
            y: snappedPhoneTopLeft.position.y - basePhoneY,
          });
          return;
        }

        if (session.target === 'text-box' && session.textBoxId && session.startTextBoxPosition) {
          const snappedTextTopLeft = applyCenterSnap(
            {
              x: session.startTextBoxPosition.x + dx,
              y: session.startTextBoxPosition.y + dy,
            },
            session.startTextBoxSize ?? { width: 120, height: 60 },
            { width: CANVAS_PRESET.width, height: CANVAS_PRESET.height },
            snapThreshold,
          );

          updateSnapGuide({
            vertical: snappedTextTopLeft.snapX,
            horizontal: snappedTextTopLeft.snapY,
          });
          setTextBoxes((previous) =>
            previous.map((box) =>
              box.id === session.textBoxId
                ? {
                  ...box,
                    x: snappedTextTopLeft.position.x,
                    y: snappedTextTopLeft.position.y,
                }
                : box,
            ),
          );
          return;
        }
      }

      updateSnapGuide({ vertical: false, horizontal: false });

      if (isPlacingTextBox) {
        event.currentTarget.style.cursor = 'crosshair';
        return;
      }

      const hitTextBox = findTopmostTextBoxAtPoint(point, layout);
      if (hitTextBox) {
        event.currentTarget.style.cursor = 'grab';
        return;
      }

      if (pointInRect(point, layout.phone.body)) {
        event.currentTarget.style.cursor = 'grab';
        return;
      }

      if (pointInRect(point, layout.phone.screen)) {
        event.currentTarget.style.cursor = 'pointer';
        return;
      }

      event.currentTarget.style.cursor = 'default';
    },
    [findTopmostTextBoxAtPoint, getCanvasSnapThreshold, isPlacingTextBox, phoneScale, toCanvasPoint, updateSnapGuide],
  );

  const finishCanvasDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (session.moved) {
      suppressCanvasClickRef.current = true;
      setStatusMessage(
        session.target === 'phone'
          ? '아이폰 프레임 위치를 이동했습니다.'
          : '텍스트박스 위치를 이동했습니다.',
      );
    }

    dragSessionRef.current = null;
    updateSnapGuide({ vertical: false, horizontal: false });
    event.currentTarget.style.cursor = isPlacingTextBox ? 'crosshair' : 'default';
  }, [isPlacingTextBox, updateSnapGuide]);

  const handleCanvasClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (suppressCanvasClickRef.current) {
        suppressCanvasClickRef.current = false;
        return;
      }

      const point = toCanvasPoint(event.clientX, event.clientY);
      const layout = layoutRef.current;
      if (!point || !layout) {
        return;
      }

      if (isPlacingTextBox) {
        addTextBoxAt(point);
        return;
      }

      const hitTextBox = findTopmostTextBoxAtPoint(point, layout);
      if (hitTextBox) {
        bringTextBoxToFront(hitTextBox.id);
        setSelectedTextBoxId(hitTextBox.id);
        return;
      }

      if (pointInRect(point, layout.phone.screen)) {
        fileInputRef.current?.click();
        setStatusMessage('파일 선택 창을 열었습니다.');
        return;
      }

      setSelectedTextBoxId(null);
    },
    [addTextBoxAt, bringTextBoxToFront, findTopmostTextBoxAtPoint, isPlacingTextBox, toCanvasPoint],
  );

  const handleToggleTextPlacement = useCallback(() => {
    setIsPlacingTextBox((previous) => {
      const next = !previous;
      setStatusMessage(
        next
          ? '텍스트박스를 배치할 캔버스 위치를 클릭해 주세요.'
          : '텍스트박스 배치를 취소했습니다.',
      );
      return next;
    });
  }, []);

  const handleDeleteSelectedTextBox = useCallback(() => {
    if (!selectedTextBoxId) {
      return;
    }

    setTextBoxes((previous) => previous.filter((box) => box.id !== selectedTextBoxId));
    setSelectedTextBoxId(null);
    setStatusMessage('선택한 텍스트박스를 삭제했습니다.');
  }, [selectedTextBoxId]);

  const resetStyle = useCallback(() => {
    setBackgroundMode(DEFAULTS.backgroundMode);
    setBackgroundPrimary(DEFAULTS.backgroundPrimary);
    setBackgroundSecondary(DEFAULTS.backgroundSecondary);
    setGradientAngle(DEFAULTS.gradientAngle);
    setPhoneOffset({ x: 0, y: 0 });
    setPhoneScale(DEFAULTS.phoneScale);
    setIsPlacingTextBox(false);
    setStatusMessage('배경/프레임 설정을 기본값으로 초기화했습니다.');
    setErrorMessage('');
  }, []);

  const exportImage = useCallback(async () => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_PRESET.width;
    offscreen.height = CANVAS_PRESET.height;

    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      throw new Error('캔버스 초기화에 실패했습니다.');
    }

    drawComposition(ctx, {
      width: CANVAS_PRESET.width,
      height: CANVAS_PRESET.height,
      backgroundMode,
      backgroundPrimary,
      backgroundSecondary,
      gradientAngle,
      phoneOffset,
      phoneScale,
      textBoxes,
      selectedTextBoxId: null,
      showGuides: false,
      snapGuide: undefined,
      emptyStateFileLabel: undefined,
      media: imageRef.current,
    });

    const blob = await blobFromCanvas(offscreen);
    setArtifactBlob(blob, 'image', 'image/png', buildOutputFileName(assetName || 'preview', 'png'));
  }, [
    assetName,
    backgroundMode,
    backgroundPrimary,
    backgroundSecondary,
    gradientAngle,
    phoneOffset,
    phoneScale,
    setArtifactBlob,
    textBoxes,
  ]);

  const exportVideo = useCallback(async () => {
    if (!assetUrl) {
      throw new Error('영상 소스가 없습니다.');
    }

    if (typeof MediaRecorder === 'undefined') {
      throw new Error('현재 브라우저는 영상 내보내기를 지원하지 않습니다.');
    }

    const source = await new Promise<HTMLVideoElement>((resolve, reject) => {
      const instance = document.createElement('video');
      instance.preload = 'auto';
      instance.playsInline = true;
      instance.muted = true;
      instance.loop = false;
      instance.src = assetUrl;

      const onLoaded = () => resolve(instance);
      const onError = () => reject(new Error('영상 메타데이터를 읽지 못했습니다.'));

      instance.addEventListener('loadedmetadata', onLoaded, { once: true });
      instance.addEventListener('error', onError, { once: true });
    });

    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_PRESET.width;
    offscreen.height = CANVAS_PRESET.height;

    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      throw new Error('캔버스 초기화에 실패했습니다.');
    }

    const stream = offscreen.captureStream(30);
    const mimeType = pickRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('영상 변환 중 오류가 발생했습니다.'));
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }));
      };
    });

    recorder.start(1000 / 30);

    try {
      await source.play();

      await new Promise<void>((resolve, reject) => {
        let rafId = 0;

        const onError = () => {
          cancelAnimationFrame(rafId);
          reject(new Error('영상 프레임을 읽는 중 오류가 발생했습니다.'));
        };

        source.addEventListener('error', onError, { once: true });

        const frame = () => {
          drawComposition(ctx, {
            width: CANVAS_PRESET.width,
            height: CANVAS_PRESET.height,
            backgroundMode,
            backgroundPrimary,
            backgroundSecondary,
            gradientAngle,
            phoneOffset,
            phoneScale,
            textBoxes,
            selectedTextBoxId: null,
            showGuides: false,
            snapGuide: undefined,
            emptyStateFileLabel: undefined,
            media: source,
          });

          if (source.ended) {
            resolve();
            return;
          }

          rafId = requestAnimationFrame(frame);
        };

        frame();
      });

      await new Promise((resolve) => window.setTimeout(resolve, 150));
    } finally {
      source.pause();
      stream.getTracks().forEach((track) => track.stop());

      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    }

    const blob = await done;
    const outputMime = blob.type || recorder.mimeType || mimeType || 'video/webm';
    const extension = outputMime.includes('mp4') ? 'mp4' : 'webm';
    setArtifactBlob(blob, 'video', outputMime, buildOutputFileName(assetName || 'preview', extension));
    return outputMime;
  }, [
    assetName,
    assetUrl,
    backgroundMode,
    backgroundPrimary,
    backgroundSecondary,
    gradientAngle,
    phoneOffset,
    phoneScale,
    setArtifactBlob,
    textBoxes,
  ]);

  const handleExport = useCallback(async () => {
    if (!assetKind) {
      setErrorMessage('먼저 이미지 또는 영상을 업로드해 주세요.');
      return;
    }

    setIsExporting(true);
    setErrorMessage('');

    try {
      if (assetKind === 'image') {
        await exportImage();
        setStatusMessage('이미지 출력 완료: PNG 파일이 저장되었습니다.');
      } else {
        const outputMime = await exportVideo();
        const isMp4Output = outputMime.includes('mp4');
        const sourceIsMp4 = /\.mp4$/i.test(assetName);
        if (sourceIsMp4 && !isMp4Output) {
          setStatusMessage('영상 출력 완료: 현재 브라우저 인코더 제한으로 WebM으로 저장되었습니다.');
        } else {
          setStatusMessage(`영상 출력 완료: ${isMp4Output ? 'MP4' : 'WebM'} 파일이 저장되었습니다.`);
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '내보내기에 실패했습니다.');
      setStatusMessage('오류를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setIsExporting(false);
    }
  }, [assetKind, assetName, exportImage, exportVideo]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_20%,#d9f4ff_0,#f2f4f7_42%,#eef2ff_100%)] px-4 py-8 text-zinc-900">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border border-white/70 bg-white/80 px-6 py-5 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">App Store Preview Composer</h1>
              <p className="mt-2 text-sm text-zinc-600">
                iPhone 규격(886x1920) 기준으로 업로드/드래그 배치 후 결과물을 생성합니다.
              </p>
            </div>

            <div className="w-full max-w-md space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <Label className="text-xs text-zinc-500">프로젝트</Label>
              <div className="flex flex-wrap gap-2">
                <select
                  value={currentProjectId}
                  onChange={(event) => handleSelectProject(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="secondary" onClick={handleCreateProject}>
                  <Plus className="h-4 w-4" />
                  새 프로젝트
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={handleConnectSaveDirectory}>
                  <FolderOpen className="h-4 w-4" />
                  자동저장 폴더 연결
                </Button>
                <span className="text-xs text-zinc-500">
                  {connectedSaveDirectory ? '.project-saves 자동저장 연결됨' : '폴더 미연결'}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                {currentProject ? `${currentProject.name} 선택됨` : '프로젝트 없음'}
                {lastAutoSavedAt ? ` · 마지막 자동저장 ${lastAutoSavedAt}` : ''}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-4 rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-800">캔버스 목록</p>
            <p className="text-xs text-zinc-500">{currentCanvas ? `${currentCanvas.name} 편집 중` : '캔버스 없음'}</p>
          </div>
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
            {currentProjectCanvases.map((canvas) => {
              const isActive = canvas.id === currentCanvasId;
              const kindLabel =
                canvas.state.media.kind === 'video' ? '영상' : canvas.state.media.kind === 'image' ? '이미지' : '미디어 없음';
              return (
                <button
                  key={canvas.id}
                  type="button"
                  onClick={() => handleSelectCanvas(canvas.id)}
                  className={`min-w-[220px] rounded-lg border px-3 py-2 text-left transition ${
                    isActive ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-zinc-200 bg-white text-zinc-700'
                  }`}
                >
                  <p className="truncate text-sm font-semibold">{canvas.name}</p>
                  <p className="mt-1 truncate text-xs opacity-80">{canvas.state.media.name || '빈 캔버스'}</p>
                  <p className="mt-1 text-[11px] opacity-70">{kindLabel}</p>
                  <div className="mt-2 rounded-md border border-zinc-200/80 bg-zinc-100/70 p-1">
                    <div
                      className="mx-auto overflow-hidden rounded-[8px] border border-zinc-300 bg-zinc-200"
                      style={{ width: CANVAS_THUMBNAIL_WIDTH / 2, height: CANVAS_THUMBNAIL_HEIGHT / 2 }}
                    >
                      {canvas.thumbnailDataUrl ? (
                        <img
                          src={canvas.thumbnailDataUrl}
                          alt={`${canvas.name} 미리보기`}
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-[10px] text-zinc-500">
                          미리보기 없음
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              onClick={handleCreateCanvas}
              className="min-w-[150px] shrink-0 self-stretch"
            >
              <Plus className="h-4 w-4" /> 캔버스 추가
            </Button>
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
          <Card className="border-zinc-200/80 bg-white/90">
            <CardHeader>
              <CardTitle>디자인 설정</CardTitle>
              <CardDescription>입력 파일 타입에 따라 출력 타입이 자동으로 맞춰집니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>캔버스 규격</Label>
                <select
                  value={CANVAS_PRESET.label}
                  disabled
                  className="h-10 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-700"
                >
                  <option>{CANVAS_PRESET.label}</option>
                </select>
                <p className="text-xs text-zinc-500">추후 여러 규격으로 확장할 수 있도록 구조를 분리해 두었습니다.</p>
              </div>

              <div className="space-y-3">
                <Label>1. iPhone 화면 미디어</Label>
                {currentCanvas && <p className="text-xs text-zinc-500">{currentCanvas.name} 전용 미디어</p>}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleFileChange}
                />

                <div
                  className={`rounded-xl border border-dashed p-4 transition-colors ${
                    isUploadDropActive
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-zinc-300 bg-zinc-50'
                  }`}
                  onDragEnter={handleUploadDragEnter}
                  onDragOver={handleUploadDragOver}
                  onDragLeave={handleUploadDragLeave}
                  onDrop={handleUploadDrop}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                      이미지/영상 업로드
                    </Button>
                    <span className="text-sm text-zinc-600">드래그 앤 드롭 지원</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-sm text-zinc-700">
                    {assetKind === 'video' ? <Film className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                    <span className="truncate">{assetName || '선택된 파일 없음'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Label>2. 배경 설정</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    value={backgroundMode}
                    onChange={(event) => setBackgroundMode(event.target.value as BackgroundMode)}
                    className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                  >
                    <option value="solid">단색</option>
                    <option value="gradient">그라데이션</option>
                  </select>

                  <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3">
                    <Palette className="h-4 w-4 text-zinc-500" />
                    <Label className="text-xs text-zinc-500">기본</Label>
                    <Input
                      type="color"
                      value={backgroundPrimary}
                      onChange={(event) => setBackgroundPrimary(event.target.value)}
                      className="h-8 w-full border-0 bg-transparent px-0"
                    />
                  </div>
                </div>

                {backgroundMode === 'gradient' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3">
                      <Label className="text-xs text-zinc-500">보조</Label>
                      <Input
                        type="color"
                        value={backgroundSecondary}
                        onChange={(event) => setBackgroundSecondary(event.target.value)}
                        className="h-8 w-full border-0 bg-transparent px-0"
                      />
                    </div>
                    <div className="rounded-md border border-zinc-300 bg-white px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span>각도</span>
                        <span>{gradientAngle}°</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        value={gradientAngle}
                        onChange={(event) => setGradientAngle(Number(event.target.value))}
                        className="mt-1 w-full"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <Label>3. 텍스트박스</Label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant={isPlacingTextBox ? 'default' : 'secondary'} onClick={handleToggleTextPlacement}>
                    <Plus className="h-4 w-4" />
                    {isPlacingTextBox ? '배치 취소' : '텍스트박스 추가(클릭 배치)'}
                  </Button>
                  <Button type="button" variant="outline" onClick={copySelectedTextBox} disabled={!selectedTextBox}>
                    <Copy className="h-4 w-4" />
                    복사
                  </Button>
                  <Button type="button" variant="outline" onClick={pasteCopiedTextBox} disabled={!hasCopiedTextBox}>
                    <ClipboardPaste className="h-4 w-4" />
                    붙여넣기
                  </Button>
                  <Button type="button" variant="outline" onClick={handleDeleteSelectedTextBox} disabled={!selectedTextBox}>
                    <Trash2 className="h-4 w-4" />
                    선택 박스 삭제
                  </Button>
                </div>

                <div className="max-h-36 space-y-2 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2">
                  {textBoxes.length === 0 ? (
                    <p className="text-xs text-zinc-500">텍스트박스가 없습니다.</p>
                  ) : (
                    textBoxes.map((box) => (
                      <button
                        key={box.id}
                        type="button"
                        className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                          box.id === selectedTextBoxId
                            ? 'border-blue-400 bg-blue-50 text-blue-800'
                            : 'border-zinc-200 bg-white text-zinc-700'
                        }`}
                        onClick={() => {
                          bringTextBoxToFront(box.id);
                          setSelectedTextBoxId(box.id);
                        }}
                      >
                        {box.text.trim() || '(빈 텍스트)'}
                      </button>
                    ))
                  )}
                </div>

                {selectedTextBox ? (
                  <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <Textarea
                      value={selectedTextBox.text}
                      onChange={(event) =>
                        updateSelectedTextBox((box) => ({
                          ...box,
                          text: event.target.value,
                        }))
                      }
                      placeholder="텍스트를 입력하세요"
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-zinc-500">서체</Label>
                        <select
                          value={selectedTextBox.fontKey}
                          onChange={(event) =>
                            updateSelectedTextBox((box) => ({
                              ...box,
                              fontKey: event.target.value as FontKey,
                            }))
                          }
                          className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
                        >
                          {FONT_OPTIONS.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs text-zinc-500">텍스트 색상</Label>
                        <Input
                          type="color"
                          value={selectedTextBox.color}
                          onChange={(event) =>
                            updateSelectedTextBox((box) => ({
                              ...box,
                              color: event.target.value,
                            }))
                          }
                          className="h-10"
                        />
                      </div>
                    </div>

                    <div className="rounded-md border border-zinc-300 bg-white px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span>폰트 크기</span>
                        <span>{selectedTextBox.fontSize}px</span>
                      </div>
                      <input
                        type="range"
                        min={18}
                        max={160}
                        value={selectedTextBox.fontSize}
                        onChange={(event) =>
                          updateSelectedTextBox((box) => ({
                            ...box,
                            fontSize: Number(event.target.value),
                          }))
                        }
                        className="mt-1 w-full"
                      />
                    </div>

                    <div className="rounded-md border border-zinc-300 bg-white px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span>텍스트박스 너비</span>
                        <span>{Math.round(selectedTextBox.width)}px</span>
                      </div>
                      <input
                        type="range"
                        min={120}
                        max={860}
                        value={selectedTextBox.width}
                        onChange={(event) =>
                          updateSelectedTextBox((box) => ({
                            ...box,
                            width: Number(event.target.value),
                          }))
                        }
                        className="mt-1 w-full"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">편집할 텍스트박스를 선택해 주세요.</p>
                )}
              </div>

              <div className="space-y-3">
                <Label>4. iPhone 프레임</Label>
                <div className="rounded-md border border-zinc-300 bg-white px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>크기</span>
                    <span>{Math.round(phoneScale * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={180}
                    value={Math.round(phoneScale * 100)}
                    onChange={(event) => setPhoneScale(Number(event.target.value) / 100)}
                    className="mt-1 w-full"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={resetStyle}>
                  <RotateCcw className="h-4 w-4" />
                  배경/프레임 초기화
                </Button>
                <Button type="button" onClick={handleExport} disabled={isExporting || !assetKind}>
                  <Download className="h-4 w-4" />
                  {isExporting ? '내보내는 중...' : '소스 타입에 맞춰 내보내기'}
                </Button>
              </div>

              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                <p>{statusMessage}</p>
                {errorMessage && <p className="mt-2 font-medium text-rose-600">{errorMessage}</p>}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-zinc-200/80 bg-white/90">
              <CardHeader>
                <CardTitle>라이브 미리보기</CardTitle>
                <CardDescription>
                  프레임/텍스트박스는 캔버스 밖으로도 이동 가능하며, 바깥 부분은 잘려 보이지 않습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div
                  className={`w-full max-w-[360px] rounded-[28px] border bg-zinc-100 p-3 shadow-inner transition-all ${
                    isCanvasDropActive ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-zinc-200'
                  }`}
                >
                  <canvas
                    ref={previewCanvasRef}
                    className="h-auto w-full rounded-[22px]"
                    style={{
                      aspectRatio: `${CANVAS_PRESET.width}/${CANVAS_PRESET.height}`,
                      cursor: isPlacingTextBox ? 'crosshair' : 'default',
                    }}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={finishCanvasDrag}
                    onPointerCancel={finishCanvasDrag}
                    onClick={handleCanvasClick}
                    onDragEnter={handleCanvasDragEnter}
                    onDragOver={handleCanvasDragOver}
                    onDragLeave={handleCanvasDragLeave}
                    onDrop={handleCanvasDrop}
                  />
                </div>
                <p className="text-center text-xs text-zinc-500">
                  드래그 이동: iPhone 프레임/텍스트박스 · 업로드: 좌측 영역 DnD 또는 iPhone 화면 클릭/DnD
                </p>
              </CardContent>
            </Card>

            <Card className="border-zinc-200/80 bg-white/90">
              <CardHeader>
                <CardTitle>출력 결과</CardTitle>
                <CardDescription>
                  입력이 이미지면 PNG, 입력이 영상이면 VIDEO(WebM/브라우저 지원 포맷)로 저장됩니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {artifact ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                      <p>파일명: {artifact.fileName}</p>
                      <p className="mt-1">MIME: {artifact.mimeType}</p>
                    </div>
                    {artifact.kind === 'image' ? (
                      <img src={artifact.url} alt="output preview" className="max-h-[420px] rounded-lg border border-zinc-200 object-contain" />
                    ) : (
                      <video src={artifact.url} controls loop className="max-h-[420px] rounded-lg border border-zinc-200" />
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center text-sm text-zinc-500">
                    아직 생성된 결과물이 없습니다.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
