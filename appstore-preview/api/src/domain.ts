import { createCanvas } from '@napi-rs/canvas';
import { randomUUID } from 'node:crypto';

export type MediaKind = 'image' | 'video' | null;
export type BackgroundMode = 'solid' | 'gradient';

export const FONT_OPTIONS = [
  { key: 'pretendard', label: 'Pretendard', family: 'Pretendard, "Noto Sans KR", sans-serif' },
  { key: 'noto', label: 'Noto Sans KR', family: '"Noto Sans KR", sans-serif' },
  { key: 'nanum', label: 'Nanum Myeongjo', family: '"Nanum Myeongjo", serif' },
  { key: 'black-han', label: 'Black Han Sans', family: '"Black Han Sans", sans-serif' },
] as const;

export type FontKey = (typeof FONT_OPTIONS)[number]['key'];

export interface Offset {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBoxModel {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  fontKey: FontKey;
  fontSize: number;
  color: string;
}

export interface CanvasDesignState {
  canvasPresetId: string;
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

export interface ProjectCanvasRecord {
  id: string;
  name: string;
  state: CanvasDesignState;
  thumbnailDataUrl?: string;
}

export interface ProjectDesignState {
  canvases: ProjectCanvasRecord[];
  currentCanvasId: string;
}

export interface StoredProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  state: ProjectDesignState;
  source: 'api' | 'app-save';
  sourcePath: string;
}

export interface ProjectFilePayload {
  version: number;
  project: {
    id: string;
    name: string;
    updatedAt: string;
  };
  state: ProjectDesignState;
}

export interface TextBoxMeta {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lineHeight: number;
  lines: string[];
  lineCount: number;
  lineClassification: 'single-line' | 'two-lines' | 'three-or-more-lines';
  hasManualLineBreak: boolean;
  wrappedByWidth: boolean;
  maxLineWidth: number;
  font: {
    key: FontKey;
    family: string;
    size: number;
    color: string;
    weight: number;
  };
  bounds: Rect;
}

export interface PhoneMeta {
  body: Rect;
  screen: Rect;
  notch: Rect;
  radius: number;
  screenRadius: number;
  center: Offset;
}

export interface CanvasMeta {
  canvasId: string;
  canvasName: string;
  canvasPreset: {
    id: string;
    label: string;
    width: number;
    height: number;
  };
  background: {
    mode: BackgroundMode;
    primary: string;
    secondary: string;
    angle: number;
  };
  media: {
    kind: MediaKind;
    name: string;
  };
  phone: PhoneMeta;
  textBoxes: TextBoxMeta[];
  shapes: Array<
    | {
        id: 'background';
        type: 'background';
        zIndex: number;
        bounds: Rect;
        background: {
          mode: BackgroundMode;
          primary: string;
          secondary: string;
          angle: number;
        };
      }
    | {
        id: 'phone-frame';
        type: 'phone-frame';
        zIndex: number;
        bounds: Rect;
        phone: PhoneMeta;
      }
    | {
        id: string;
        type: 'text-box';
        zIndex: number;
        bounds: Rect;
        textBox: TextBoxMeta;
      }
  >;
}

export const CANVAS_PRESETS = [
  { id: '886x1920', label: '886 x 1920 (default)', width: 886, height: 1920 },
  { id: '1260x2736', label: '1260 x 2736', width: 1260, height: 2736 },
  { id: '1320x2868', label: '1320 x 2868', width: 1320, height: 2868 },
  { id: '1290x2796', label: '1290 x 2796', width: 1290, height: 2796 },
  { id: '1242x2688', label: '1242 x 2688', width: 1242, height: 2688 },
  { id: '1284x2778', label: '1284 x 2778', width: 1284, height: 2778 },
  { id: '1206x2622', label: '1206 x 2622', width: 1206, height: 2622 },
  { id: '1179x2556', label: '1179 x 2556', width: 1179, height: 2556 },
  { id: '1125x2436', label: '1125 x 2436', width: 1125, height: 2436 },
  { id: '1080x2340', label: '1080 x 2340', width: 1080, height: 2340 },
  { id: '1170x2532', label: '1170 x 2532', width: 1170, height: 2532 },
] as const;

export const DEFAULT_CANVAS_PRESET = CANVAS_PRESETS[0];
export const TEXT_BOX_MIN_WIDTH = 120;
export const TEXT_BOX_MAX_WIDTH = 1200;
export const TEXT_BOX_FONT_SIZE_MIN = 18;
export const TEXT_BOX_FONT_SIZE_MAX = 160;
export const PHONE_WIDTH_RATIO = (DEFAULT_CANVAS_PRESET.width - 220) / DEFAULT_CANVAS_PRESET.width;
export const PHONE_HEIGHT_RATIO = 1400 / DEFAULT_CANVAS_PRESET.height;
export const PHONE_TOP_RATIO = 260 / DEFAULT_CANVAS_PRESET.height;
export const PHONE_FRAME_RADIUS = 104;
export const PHONE_SCREEN_RADIUS = 76;

interface MeasureContext {
  font: string;
  measureText: (text: string) => { width: number };
}

const measureCanvas = createCanvas(16, 16);
const measureContext = measureCanvas.getContext('2d') as unknown as MeasureContext | null;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getCanvasPresetById(id: string) {
  return CANVAS_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_CANVAS_PRESET;
}

export function getCanvasDimensionsFromState(state: CanvasDesignState) {
  const preset = getCanvasPresetById(state.canvasPresetId);
  return { width: preset.width, height: preset.height };
}

export function getPhoneBaseMetrics(canvasWidth: number, canvasHeight: number, phoneScale: number) {
  const width = canvasWidth * PHONE_WIDTH_RATIO * phoneScale;
  const height = canvasHeight * PHONE_HEIGHT_RATIO * phoneScale;
  return {
    width,
    height,
    x: (canvasWidth - width) / 2,
    y: canvasHeight * PHONE_TOP_RATIO,
  };
}

export function sanitizeFileNameSegment(name: string) {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 60) || 'project';
}

export function getFontFamily(fontKey: FontKey) {
  return FONT_OPTIONS.find((option) => option.key === fontKey)?.family ?? FONT_OPTIONS[0].family;
}

export function createProjectId() {
  return `project-${randomUUID()}`;
}

export function createCanvasId() {
  return `canvas-${randomUUID()}`;
}

export function createEmptyCanvasState(): CanvasDesignState {
  return {
    canvasPresetId: DEFAULT_CANVAS_PRESET.id,
    backgroundMode: 'solid',
    backgroundPrimary: '#f2f4f7',
    backgroundSecondary: '#dbeafe',
    gradientAngle: 26,
    phoneOffset: { x: 0, y: 0 },
    phoneScale: 1,
    textBoxes: [],
    media: {
      kind: null,
      name: '',
    },
  };
}

export function cloneCanvasState(state: CanvasDesignState): CanvasDesignState {
  return {
    ...state,
    phoneOffset: { ...state.phoneOffset },
    textBoxes: state.textBoxes.map((box) => ({ ...box })),
    media: { ...state.media },
  };
}

export function cloneProjectDesignState(state: ProjectDesignState): ProjectDesignState {
  return {
    currentCanvasId: state.currentCanvasId,
    canvases: state.canvases.map((canvas) => ({
      id: canvas.id,
      name: canvas.name,
      state: cloneCanvasState(canvas.state),
      thumbnailDataUrl: canvas.thumbnailDataUrl,
    })),
  };
}

export function createCanvasRecord(name: string, state: CanvasDesignState = createEmptyCanvasState()): ProjectCanvasRecord {
  return {
    id: createCanvasId(),
    name,
    state: cloneCanvasState(state),
  };
}

export function createProjectDesignState(initialCanvas?: ProjectCanvasRecord): ProjectDesignState {
  const firstCanvas = initialCanvas ?? createCanvasRecord('Canvas 1');
  return {
    canvases: [{ ...firstCanvas, state: cloneCanvasState(firstCanvas.state) }],
    currentCanvasId: firstCanvas.id,
  };
}

export function createProjectRecord(name: string, state: ProjectDesignState = createProjectDesignState()): StoredProjectRecord {
  return {
    id: createProjectId(),
    name,
    updatedAt: new Date().toISOString(),
    state: cloneProjectDesignState(state),
    source: 'api',
    sourcePath: '',
  };
}

function safeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isFontKey(value: unknown): value is FontKey {
  return typeof value === 'string' && FONT_OPTIONS.some((option) => option.key === value);
}

export function sanitizeCanvasState(state: unknown): CanvasDesignState {
  if (!state || typeof state !== 'object') {
    return createEmptyCanvasState();
  }

  const raw = state as Partial<CanvasDesignState>;
  const preset = getCanvasPresetById(safeString(raw.canvasPresetId, DEFAULT_CANVAS_PRESET.id));
  const media = raw.media as CanvasDesignState['media'] | undefined;

  return {
    canvasPresetId: preset.id,
    backgroundMode: raw.backgroundMode === 'gradient' ? 'gradient' : 'solid',
    backgroundPrimary: safeString(raw.backgroundPrimary, '#f2f4f7'),
    backgroundSecondary: safeString(raw.backgroundSecondary, '#dbeafe'),
    gradientAngle: safeNumber(raw.gradientAngle, 26),
    phoneOffset: {
      x: safeNumber(raw.phoneOffset?.x, 0),
      y: safeNumber(raw.phoneOffset?.y, 0),
    },
    phoneScale: safeNumber(raw.phoneScale, 1),
    textBoxes: Array.isArray(raw.textBoxes)
      ? raw.textBoxes
          .filter((box): box is TextBoxModel => Boolean(box && typeof box === 'object'))
          .map((box, index) => ({
            id: safeString(box.id, `text-${index + 1}`),
            text: safeString(box.text),
            x: safeNumber(box.x),
            y: safeNumber(box.y),
            width: clamp(safeNumber(box.width, 320), TEXT_BOX_MIN_WIDTH, TEXT_BOX_MAX_WIDTH),
            fontKey: isFontKey(box.fontKey) ? box.fontKey : FONT_OPTIONS[0].key,
            fontSize: clamp(safeNumber(box.fontSize, 48), TEXT_BOX_FONT_SIZE_MIN, TEXT_BOX_FONT_SIZE_MAX),
            color: safeString(box.color, '#1f3b7c'),
          }))
      : [],
    media: {
      kind: media?.kind === 'image' || media?.kind === 'video' ? media.kind : null,
      name: safeString(media?.name),
    },
  };
}

export function sanitizeProjectState(state: unknown): ProjectDesignState {
  if (!state || typeof state !== 'object') {
    return createProjectDesignState();
  }

  const raw = state as { canvases?: unknown; currentCanvasId?: unknown };
  if (!Array.isArray(raw.canvases)) {
    return createProjectDesignState();
  }

  const canvases = raw.canvases
    .filter((item): item is { id?: unknown; name?: unknown; state?: unknown; thumbnailDataUrl?: unknown } =>
      Boolean(item && typeof item === 'object'),
    )
    .map((canvas, index) => ({
      id: safeString(canvas.id, createCanvasId()),
      name: safeString(canvas.name, `Canvas ${index + 1}`) || `Canvas ${index + 1}`,
      state: sanitizeCanvasState(canvas.state ?? canvas),
      thumbnailDataUrl: typeof canvas.thumbnailDataUrl === 'string' ? canvas.thumbnailDataUrl : undefined,
    }));

  const safeCanvases = canvases.length > 0 ? canvases : [createCanvasRecord('Canvas 1')];
  const firstCanvas = safeCanvases[0] ?? createCanvasRecord('Canvas 1');
  const currentCanvasIdRaw = safeString(raw.currentCanvasId, firstCanvas.id);
  const currentCanvasId = safeCanvases.some((canvas) => canvas.id === currentCanvasIdRaw)
    ? currentCanvasIdRaw
    : firstCanvas.id;

  return {
    canvases: safeCanvases.map((canvas) => ({
      ...canvas,
      state: cloneCanvasState(canvas.state),
    })),
    currentCanvasId,
  };
}

export function normalizeProjectRecord(value: unknown, source: 'api' | 'app-save', sourcePath: string): StoredProjectRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<StoredProjectRecord> & Partial<ProjectFilePayload> & {
    project?: { id?: unknown; name?: unknown; updatedAt?: unknown };
  };

  if (raw.project && typeof raw.project === 'object') {
    const id = safeString(raw.project.id);
    const name = safeString(raw.project.name);
    const updatedAt = safeString(raw.project.updatedAt, new Date().toISOString());
    if (!id || !name) {
      return null;
    }

    return {
      id,
      name,
      updatedAt,
      state: sanitizeProjectState(raw.state),
      source,
      sourcePath,
    };
  }

  const id = safeString(raw.id);
  const name = safeString(raw.name);
  const updatedAt = safeString(raw.updatedAt, new Date().toISOString());
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    updatedAt,
    state: sanitizeProjectState(raw.state),
    source,
    sourcePath,
  };
}

function measureTextWidth(ctx: MeasureContext | null, text: string) {
  if (!ctx) {
    return text.length * 10;
  }

  return ctx.measureText(text).width;
}

export function wrapTextToLines(ctx: MeasureContext | null, text: string, maxWidth: number) {
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
      if (measureTextWidth(ctx, candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
      }

      if (measureTextWidth(ctx, word) <= maxWidth) {
        current = word;
        continue;
      }

      let fragment = '';
      for (const char of word) {
        const charCandidate = `${fragment}${char}`;
        if (measureTextWidth(ctx, charCandidate) <= maxWidth) {
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

export function computeTextBoxMeta(box: TextBoxModel): TextBoxMeta {
  const fontFamily = getFontFamily(box.fontKey);
  const width = clamp(box.width, TEXT_BOX_MIN_WIDTH, TEXT_BOX_MAX_WIDTH);
  const fontSize = clamp(box.fontSize, TEXT_BOX_FONT_SIZE_MIN, TEXT_BOX_FONT_SIZE_MAX);
  const lineHeight = fontSize * 1.2;

  if (measureContext) {
    measureContext.font = `800 ${fontSize}px ${fontFamily}`;
  }

  const lines = wrapTextToLines(measureContext, box.text, width);
  const lineCount = lines.length;
  const maxLineWidth = lines.reduce((acc, line) => Math.max(acc, measureTextWidth(measureContext, line)), 0);
  const height = Math.max(lineHeight, lineCount * lineHeight);

  let lineClassification: TextBoxMeta['lineClassification'] = 'three-or-more-lines';
  if (lineCount <= 1) {
    lineClassification = 'single-line';
  } else if (lineCount === 2) {
    lineClassification = 'two-lines';
  }

  const hasManualLineBreak = box.text.includes('\n');
  const wrappedByWidth = !hasManualLineBreak && lineCount > 1;

  return {
    id: box.id,
    text: box.text,
    x: box.x,
    y: box.y,
    width,
    height,
    lineHeight,
    lines,
    lineCount,
    lineClassification,
    hasManualLineBreak,
    wrappedByWidth,
    maxLineWidth,
    font: {
      key: box.fontKey,
      family: fontFamily,
      size: fontSize,
      color: box.color,
      weight: 800,
    },
    bounds: {
      x: box.x,
      y: box.y,
      width,
      height,
    },
  };
}

export function computePhoneMeta(
  canvasWidth: number,
  canvasHeight: number,
  phoneOffset: Offset,
  phoneScale: number,
): PhoneMeta {
  const basePhone = getPhoneBaseMetrics(canvasWidth, canvasHeight, phoneScale);
  const body = {
    x: basePhone.x + phoneOffset.x,
    y: basePhone.y + phoneOffset.y,
    width: basePhone.width,
    height: basePhone.height,
  };

  const screenInset = 22 * phoneScale;
  const screen = {
    x: body.x + screenInset,
    y: body.y + screenInset,
    width: body.width - screenInset * 2,
    height: body.height - screenInset * 2,
  };

  const notch = {
    x: screen.x + (screen.width - 194 * phoneScale) / 2,
    y: screen.y + 14 * phoneScale,
    width: 194 * phoneScale,
    height: 46 * phoneScale,
  };

  return {
    body,
    screen,
    notch,
    radius: PHONE_FRAME_RADIUS * phoneScale,
    screenRadius: PHONE_SCREEN_RADIUS * phoneScale,
    center: {
      x: body.x + body.width / 2,
      y: body.y + body.height / 2,
    },
  };
}

export function computeCanvasMeta(canvas: ProjectCanvasRecord): CanvasMeta {
  const preset = getCanvasPresetById(canvas.state.canvasPresetId);
  const phone = computePhoneMeta(preset.width, preset.height, canvas.state.phoneOffset, canvas.state.phoneScale);
  const textBoxes = canvas.state.textBoxes.map((box) => computeTextBoxMeta(box));

  return {
    canvasId: canvas.id,
    canvasName: canvas.name,
    canvasPreset: {
      id: preset.id,
      label: preset.label,
      width: preset.width,
      height: preset.height,
    },
    background: {
      mode: canvas.state.backgroundMode,
      primary: canvas.state.backgroundPrimary,
      secondary: canvas.state.backgroundSecondary,
      angle: canvas.state.gradientAngle,
    },
    media: {
      kind: canvas.state.media.kind,
      name: canvas.state.media.name,
    },
    phone,
    textBoxes,
    shapes: [
      {
        id: 'background',
        type: 'background',
        zIndex: 0,
        bounds: { x: 0, y: 0, width: preset.width, height: preset.height },
        background: {
          mode: canvas.state.backgroundMode,
          primary: canvas.state.backgroundPrimary,
          secondary: canvas.state.backgroundSecondary,
          angle: canvas.state.gradientAngle,
        },
      },
      ...textBoxes.map((textBox, index) => ({
        id: textBox.id,
        type: 'text-box' as const,
        zIndex: index + 1,
        bounds: textBox.bounds,
        textBox,
      })),
      {
        id: 'phone-frame',
        type: 'phone-frame',
        zIndex: textBoxes.length + 1,
        bounds: phone.body,
        phone,
      },
    ],
  };
}

export function findCanvas(project: ProjectDesignState, canvasId: string) {
  return project.canvases.find((canvas) => canvas.id === canvasId) ?? null;
}

export function findTextBox(canvas: ProjectCanvasRecord, textBoxId: string) {
  return canvas.state.textBoxes.find((box) => box.id === textBoxId) ?? null;
}

export function patchTextBox(box: TextBoxModel, patch: Partial<TextBoxModel>): TextBoxModel {
  return {
    ...box,
    text: typeof patch.text === 'string' ? patch.text : box.text,
    x: typeof patch.x === 'number' ? patch.x : box.x,
    y: typeof patch.y === 'number' ? patch.y : box.y,
    width:
      typeof patch.width === 'number'
        ? clamp(patch.width, TEXT_BOX_MIN_WIDTH, TEXT_BOX_MAX_WIDTH)
        : box.width,
    fontSize:
      typeof patch.fontSize === 'number'
        ? clamp(patch.fontSize, TEXT_BOX_FONT_SIZE_MIN, TEXT_BOX_FONT_SIZE_MAX)
        : box.fontSize,
    fontKey: isFontKey(patch.fontKey) ? patch.fontKey : box.fontKey,
    color: typeof patch.color === 'string' ? patch.color : box.color,
  };
}

export function cloneProjectForApi(source: StoredProjectRecord, nextName?: string): StoredProjectRecord {
  const canvasIdMap = new Map<string, string>();
  const clonedCanvases = source.state.canvases.map((canvas) => {
    const nextCanvasId = createCanvasId();
    canvasIdMap.set(canvas.id, nextCanvasId);
    return {
      id: nextCanvasId,
      name: canvas.name,
      state: cloneCanvasState(canvas.state),
      thumbnailDataUrl: canvas.thumbnailDataUrl,
    };
  });

  const nextCurrentCanvasId =
    canvasIdMap.get(source.state.currentCanvasId) ?? clonedCanvases[0]?.id ?? createCanvasId();

  return {
    id: createProjectId(),
    name: nextName?.trim() || `${source.name} Copy`,
    updatedAt: new Date().toISOString(),
    state: {
      canvases: clonedCanvases,
      currentCanvasId: nextCurrentCanvasId,
    },
    source: 'api',
    sourcePath: '',
  };
}
