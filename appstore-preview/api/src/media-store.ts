import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CanvasMediaMeta {
  projectId: string;
  canvasId: string;
  kind: 'image' | 'video';
  name: string;
  type: string;
  byteSize: number;
  updatedAt: string;
}

export interface CanvasMediaRecord {
  meta: CanvasMediaMeta;
  data: Buffer;
}

interface SaveCanvasMediaInput {
  kind: 'image' | 'video';
  name: string;
  type: string;
  data: Buffer;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APPSTORE_PREVIEW_ROOT = path.resolve(__dirname, '../..');
const PROJECT_MEDIA_ROOT_DIR = path.join(APPSTORE_PREVIEW_ROOT, '.project-saves', 'media');
const MEDIA_BINARY_FILE_NAME = 'media.bin';
const MEDIA_META_FILE_NAME = 'media.meta.json';

function sanitizePathSegment(value: string) {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'unknown';
}

function getProjectMediaDir(projectId: string) {
  return path.join(PROJECT_MEDIA_ROOT_DIR, sanitizePathSegment(projectId));
}

function getCanvasMediaDir(projectId: string, canvasId: string) {
  return path.join(getProjectMediaDir(projectId), sanitizePathSegment(canvasId));
}

function getCanvasMediaBinaryPath(projectId: string, canvasId: string) {
  return path.join(getCanvasMediaDir(projectId, canvasId), MEDIA_BINARY_FILE_NAME);
}

function getCanvasMediaMetaPath(projectId: string, canvasId: string) {
  return path.join(getCanvasMediaDir(projectId, canvasId), MEDIA_META_FILE_NAME);
}

function normalizeMeta(raw: unknown): CanvasMediaMeta | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<CanvasMediaMeta>;
  const kind = value.kind === 'image' || value.kind === 'video' ? value.kind : null;
  if (!kind) {
    return null;
  }

  const projectId = typeof value.projectId === 'string' ? value.projectId : '';
  const canvasId = typeof value.canvasId === 'string' ? value.canvasId : '';
  const name = typeof value.name === 'string' ? value.name : '';
  const type = typeof value.type === 'string' ? value.type : '';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString();
  const byteSize = typeof value.byteSize === 'number' && Number.isFinite(value.byteSize) ? value.byteSize : 0;

  if (!projectId || !canvasId) {
    return null;
  }

  return {
    projectId,
    canvasId,
    kind,
    name,
    type,
    byteSize,
    updatedAt,
  };
}

export async function readCanvasMediaMeta(projectId: string, canvasId: string): Promise<CanvasMediaMeta | null> {
  try {
    const raw = await readFile(getCanvasMediaMetaPath(projectId, canvasId), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return normalizeMeta(parsed);
  } catch {
    return null;
  }
}

export async function readCanvasMedia(projectId: string, canvasId: string): Promise<CanvasMediaRecord | null> {
  const meta = await readCanvasMediaMeta(projectId, canvasId);
  if (!meta) {
    return null;
  }

  try {
    const data = await readFile(getCanvasMediaBinaryPath(projectId, canvasId));
    if (data.length === 0) {
      return null;
    }

    return {
      meta: {
        ...meta,
        byteSize: data.length,
      },
      data,
    };
  } catch {
    return null;
  }
}

export async function saveCanvasMedia(projectId: string, canvasId: string, input: SaveCanvasMediaInput) {
  const mediaDir = getCanvasMediaDir(projectId, canvasId);
  await mkdir(mediaDir, { recursive: true });

  const binaryPath = getCanvasMediaBinaryPath(projectId, canvasId);
  await writeFile(binaryPath, input.data);

  const meta: CanvasMediaMeta = {
    projectId,
    canvasId,
    kind: input.kind,
    name: input.name,
    type: input.type,
    byteSize: input.data.length,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(getCanvasMediaMetaPath(projectId, canvasId), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

export async function deleteCanvasMedia(projectId: string, canvasId: string) {
  await rm(getCanvasMediaDir(projectId, canvasId), { recursive: true, force: true });
}

export async function deleteProjectMediaByProjectId(projectId: string) {
  await rm(getProjectMediaDir(projectId), { recursive: true, force: true });
}

export async function cloneCanvasMedia(options: {
  sourceProjectId: string;
  sourceCanvasId: string;
  targetProjectId: string;
  targetCanvasId: string;
}) {
  const source = await readCanvasMedia(options.sourceProjectId, options.sourceCanvasId);
  if (!source) {
    await deleteCanvasMedia(options.targetProjectId, options.targetCanvasId);
    return {
      copied: false as const,
      meta: null,
    };
  }

  const clonedMeta = await saveCanvasMedia(options.targetProjectId, options.targetCanvasId, {
    kind: source.meta.kind,
    name: source.meta.name,
    type: source.meta.type,
    data: source.data,
  });

  return {
    copied: true as const,
    meta: clonedMeta,
  };
}
