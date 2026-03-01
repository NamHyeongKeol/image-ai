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
  measuredLineCountByCanvas?: number | null;
  measuredLineCountByDom?: number | null;
  measuredTextWidthByCanvas?: number | null;
  measuredTextWidthByDom?: number | null;
  // Legacy fields (read compatibility only)
  measuredLineCount?: number | null;
  measuredTextWidth?: number | null;
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

function createId(prefix: 'project' | 'canvas') {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function createProjectId() {
  return createId('project');
}

export function createCanvasId() {
  return createId('canvas');
}

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

export function cloneProjectCanvasRecord(canvas: ProjectCanvasRecord): ProjectCanvasRecord {
  return {
    id: canvas.id,
    name: canvas.name,
    state: cloneCanvasState(canvas.state),
    thumbnailDataUrl: canvas.thumbnailDataUrl,
  };
}

export function cloneProjectDesignState(state: ProjectDesignState): ProjectDesignState {
  return {
    currentCanvasId: state.currentCanvasId,
    canvases: state.canvases.map((canvas) => cloneProjectCanvasRecord(canvas)),
  };
}

export function createCanvasRecord(name: string, state: CanvasDesignState = createEmptyCanvasState()): ProjectCanvasRecord {
  return {
    id: createCanvasId(),
    name,
    state: cloneCanvasState(state),
  };
}

interface ProjectStateNamingOptions {
  defaultCanvasName?: string;
  canvasNamePrefix?: string;
}

export interface SanitizeProjectStateOptions extends ProjectStateNamingOptions {
  legacyFallback?: boolean;
}

function resolveNamingOptions(options?: ProjectStateNamingOptions) {
  return {
    defaultCanvasName: options?.defaultCanvasName?.trim() || 'Canvas 1',
    canvasNamePrefix: options?.canvasNamePrefix?.trim() || 'Canvas',
  };
}

export function createProjectDesignState(initialCanvas?: ProjectCanvasRecord, options?: ProjectStateNamingOptions): ProjectDesignState {
  const naming = resolveNamingOptions(options);
  const firstCanvas = initialCanvas ?? createCanvasRecord(naming.defaultCanvasName);
  return {
    canvases: [{ ...firstCanvas, state: cloneCanvasState(firstCanvas.state) }],
    currentCanvasId: firstCanvas.id,
  };
}

function safeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeMeasuredLineCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : null;
}

function normalizeMeasuredTextWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
}

export function isFontKey(value: unknown): value is FontKey {
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
            measuredLineCountByCanvas: normalizeMeasuredLineCount(
              box.measuredLineCountByCanvas ?? box.measuredLineCount,
            ),
            measuredLineCountByDom: normalizeMeasuredLineCount(
              box.measuredLineCountByDom ?? box.measuredLineCount,
            ),
            measuredTextWidthByCanvas: normalizeMeasuredTextWidth(
              box.measuredTextWidthByCanvas ?? box.measuredTextWidth,
            ),
            measuredTextWidthByDom: normalizeMeasuredTextWidth(
              box.measuredTextWidthByDom ?? box.measuredTextWidth,
            ),
          }))
      : [],
    media: {
      kind: media?.kind === 'image' || media?.kind === 'video' ? media.kind : null,
      name: safeString(media?.name),
    },
  };
}

export function sanitizeProjectState(state: unknown, options?: SanitizeProjectStateOptions): ProjectDesignState {
  const naming = resolveNamingOptions(options);

  if (!state || typeof state !== 'object') {
    return createProjectDesignState(undefined, naming);
  }

  const raw = state as { canvases?: unknown; currentCanvasId?: unknown };
  if (!Array.isArray(raw.canvases)) {
    if (options?.legacyFallback) {
      return createProjectDesignState(
        createCanvasRecord(naming.defaultCanvasName, sanitizeCanvasState(state)),
        naming,
      );
    }
    return createProjectDesignState(undefined, naming);
  }

  const canvases = raw.canvases
    .filter((item): item is { id?: unknown; name?: unknown; state?: unknown; thumbnailDataUrl?: unknown } =>
      Boolean(item && typeof item === 'object'),
    )
    .map((canvas, index) => ({
      id: safeString(canvas.id, createCanvasId()),
      name: safeString(canvas.name, `${naming.canvasNamePrefix} ${index + 1}`) || `${naming.canvasNamePrefix} ${index + 1}`,
      state: sanitizeCanvasState(canvas.state ?? canvas),
      thumbnailDataUrl: typeof canvas.thumbnailDataUrl === 'string' ? canvas.thumbnailDataUrl : undefined,
    }));

  const safeCanvases = canvases.length > 0 ? canvases : [createCanvasRecord(naming.defaultCanvasName)];
  const firstCanvas = safeCanvases[0] ?? createCanvasRecord(naming.defaultCanvasName);
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

export interface DuplicatedProjectStateResult {
  duplicatedState: ProjectDesignState;
  canvasIdMap: Map<string, string>;
}

export function duplicateProjectState(state: ProjectDesignState): DuplicatedProjectStateResult {
  const canvasIdMap = new Map<string, string>();
  const duplicatedCanvases = state.canvases.map((canvas) => {
    const duplicatedCanvasId = createCanvasId();
    canvasIdMap.set(canvas.id, duplicatedCanvasId);
    return {
      id: duplicatedCanvasId,
      name: canvas.name,
      state: cloneCanvasState(canvas.state),
      thumbnailDataUrl: canvas.thumbnailDataUrl,
    } satisfies ProjectCanvasRecord;
  });

  const duplicatedCurrentCanvasId =
    canvasIdMap.get(state.currentCanvasId) ?? duplicatedCanvases[0]?.id ?? createCanvasId();

  return {
    duplicatedState: {
      canvases: duplicatedCanvases,
      currentCanvasId: duplicatedCurrentCanvasId,
    },
    canvasIdMap,
  };
}
