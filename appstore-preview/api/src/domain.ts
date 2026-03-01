import { createCanvas } from '@napi-rs/canvas';
import {
  CANVAS_PRESETS,
  DEFAULT_CANVAS_PRESET,
  FONT_OPTIONS,
  PHONE_FRAME_RADIUS,
  PHONE_SCREEN_RADIUS,
  TEXT_BOX_FONT_SIZE_MAX,
  TEXT_BOX_FONT_SIZE_MIN,
  TEXT_BOX_MAX_WIDTH,
  TEXT_BOX_MIN_WIDTH,
  clamp,
  cloneCanvasState,
  cloneProjectDesignState,
  createCanvasId,
  createCanvasRecord,
  createEmptyCanvasState,
  createProjectDesignState,
  createProjectId,
  duplicateProjectState,
  getCanvasDimensionsFromState,
  getCanvasPresetById,
  getFontFamily,
  getPhoneBaseMetrics,
  isFontKey,
  sanitizeCanvasState,
  sanitizeFileNameSegment,
  sanitizeProjectState,
  type BackgroundMode,
  type CanvasDesignState,
  type FontKey,
  type MediaKind,
  type Offset,
  type ProjectCanvasRecord,
  type ProjectDesignState,
  type Rect,
  type TextBoxModel,
} from '../../shared/project-core.js';

export {
  CANVAS_PRESETS,
  DEFAULT_CANVAS_PRESET,
  FONT_OPTIONS,
  PHONE_FRAME_RADIUS,
  PHONE_SCREEN_RADIUS,
  TEXT_BOX_FONT_SIZE_MAX,
  TEXT_BOX_FONT_SIZE_MIN,
  TEXT_BOX_MAX_WIDTH,
  TEXT_BOX_MIN_WIDTH,
  clamp,
  cloneCanvasState,
  cloneProjectDesignState,
  createCanvasId,
  createCanvasRecord,
  createEmptyCanvasState,
  createProjectDesignState,
  createProjectId,
  getCanvasDimensionsFromState,
  getCanvasPresetById,
  getFontFamily,
  getPhoneBaseMetrics,
  sanitizeCanvasState,
  sanitizeFileNameSegment,
  sanitizeProjectState,
};

export type {
  BackgroundMode,
  CanvasDesignState,
  FontKey,
  MediaKind,
  Offset,
  ProjectCanvasRecord,
  ProjectDesignState,
  Rect,
  TextBoxModel,
};

export interface StoredProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
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
    revision?: number;
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

interface MeasureContext {
  font: string;
  measureText: (text: string) => { width: number };
}

const measureCanvas = createCanvas(16, 16);
const measureContext = measureCanvas.getContext('2d') as unknown as MeasureContext | null;

export function createProjectRecord(name: string, state: ProjectDesignState = createProjectDesignState()): StoredProjectRecord {
  return {
    id: createProjectId(),
    name,
    updatedAt: new Date().toISOString(),
    revision: 0,
    state: cloneProjectDesignState(state),
    source: 'api',
    sourcePath: '',
  };
}

function safeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function safeInteger(value: unknown, fallback = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

export function normalizeProjectRecord(value: unknown, source: 'api' | 'app-save', sourcePath: string): StoredProjectRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<StoredProjectRecord> & Partial<ProjectFilePayload> & {
    project?: { id?: unknown; name?: unknown; updatedAt?: unknown; revision?: unknown };
    revision?: unknown;
  };

  if (raw.project && typeof raw.project === 'object') {
    const id = safeString(raw.project.id);
    const name = safeString(raw.project.name);
    const updatedAt = safeString(raw.project.updatedAt, new Date().toISOString());
    const revision = safeInteger(raw.project.revision, 0);
    if (!id || !name) {
      return null;
    }

    return {
      id,
      name,
      updatedAt,
      revision,
      state: sanitizeProjectState(raw.state),
      source,
      sourcePath,
    };
  }

  const id = safeString(raw.id);
  const name = safeString(raw.name);
  const updatedAt = safeString(raw.updatedAt, new Date().toISOString());
  const revision = safeInteger(raw.revision, 0);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    updatedAt,
    revision,
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
  const { duplicatedState } = duplicateProjectState(source.state);

  return {
    id: createProjectId(),
    name: nextName?.trim() || `${source.name} Copy`,
    updatedAt: new Date().toISOString(),
    revision: 0,
    state: duplicatedState,
    source: 'api',
    sourcePath: '',
  };
}
