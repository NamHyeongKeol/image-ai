import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cloneProjectDesignState,
  createProjectDesignState,
  createProjectRecord,
  getCanvasPresetById,
  normalizeProjectRecord,
  sanitizeFileNameSegment,
  type ProjectDesignState,
  type StoredProjectRecord,
} from './domain.js';
import { deleteProjectMediaByProjectId } from './media-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const APPSTORE_PREVIEW_ROOT = path.resolve(__dirname, '../..');
export const PROJECT_SAVES_DIR = path.join(APPSTORE_PREVIEW_ROOT, '.project-saves');
const LEGACY_API_PROJECTS_DIR = path.join(PROJECT_SAVES_DIR, 'api-projects');
const PROJECT_FILE_EXTENSION = '.appstore-preview-project.json';

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectRevisionConflictError extends Error {
  projectId: string;
  expectedRevision: number;
  actualRevision: number;

  constructor(projectId: string, expectedRevision: number, actualRevision: number) {
    super(`Project revision conflict: ${projectId} (expected ${expectedRevision}, actual ${actualRevision})`);
    this.name = 'ProjectRevisionConflictError';
    this.projectId = projectId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

interface ProjectFilePayload {
  version: number;
  project: {
    id: string;
    name: string;
    updatedAt: string;
    revision?: number;
  };
  canvas: {
    width: number;
    height: number;
  };
  state: ProjectDesignState;
}

interface SaveProjectOptions {
  expectedRevision?: number | null;
}

async function ensureDirectories() {
  await mkdir(PROJECT_SAVES_DIR, { recursive: true });
}

async function tryReadJsonFile(filePath: string) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseIsoTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function createUnifiedProjectFilePath(project: { id: string; name: string }) {
  const safeName = sanitizeFileNameSegment(project.name);
  return path.join(PROJECT_SAVES_DIR, `${safeName}-${project.id}${PROJECT_FILE_EXTENSION}`);
}

async function listProjectFilePaths(baseDir: string) {
  const result: string[] = [];
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(PROJECT_FILE_EXTENSION)) {
        continue;
      }
      result.push(path.join(baseDir, entry.name));
    }
  } catch {
    // ignore
  }
  return result;
}

async function listLegacyJsonPaths() {
  const result: string[] = [];
  try {
    const entries = await readdir(LEGACY_API_PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      result.push(path.join(LEGACY_API_PROJECTS_DIR, entry.name));
    }
  } catch {
    // ignore
  }
  return result;
}

async function loadProjectsFromPaths(paths: string[], source: 'api' | 'app-save') {
  const loaded: StoredProjectRecord[] = [];
  for (const sourcePath of paths) {
    const value = await tryReadJsonFile(sourcePath);
    const normalized = normalizeProjectRecord(value, source, sourcePath);
    if (!normalized) {
      continue;
    }
    loaded.push(normalized);
  }
  return loaded;
}

function mergeProjectsByLatest(projects: StoredProjectRecord[]) {
  const byId = new Map<string, StoredProjectRecord>();
  for (const project of projects) {
    const existing = byId.get(project.id);
    if (!existing) {
      byId.set(project.id, project);
      continue;
    }

    const existingTs = parseIsoTimestamp(existing.updatedAt);
    const nextTs = parseIsoTimestamp(project.updatedAt);
    if (nextTs > existingTs || (nextTs === existingTs && project.revision >= existing.revision)) {
      byId.set(project.id, project);
    }
  }

  return Array.from(byId.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listProjects() {
  await ensureDirectories();

  const unifiedPaths = await listProjectFilePaths(PROJECT_SAVES_DIR);
  const unifiedProjects = await loadProjectsFromPaths(unifiedPaths, 'api');

  const legacyPaths = await listLegacyJsonPaths();
  const legacyProjects = await loadProjectsFromPaths(legacyPaths, 'api');

  return mergeProjectsByLatest([...unifiedProjects, ...legacyProjects]);
}

export async function getProjectOrNull(projectId: string) {
  const projects = await listProjects();
  return projects.find((project) => project.id === projectId) ?? null;
}

export async function getProjectOrThrow(projectId: string) {
  const project = await getProjectOrNull(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  return project;
}

async function findExistingProjectPath(projectId: string) {
  const projects = await listProjects();
  const existing = projects.find((project) => project.id === projectId);
  return existing?.sourcePath ?? null;
}

function normalizeRevision(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function hasStateChanged(left: ProjectDesignState, right: ProjectDesignState) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export async function saveProject(project: StoredProjectRecord, options?: SaveProjectOptions) {
  await ensureDirectories();

  const persistedState = cloneProjectDesignState(project.state);
  const existingRecord = await getProjectOrNull(project.id);
  const existingRevision = existingRecord?.revision ?? 0;
  const expectedRevision = normalizeRevision(options?.expectedRevision);

  if (existingRecord && expectedRevision !== null && expectedRevision !== existingRevision) {
    throw new ProjectRevisionConflictError(project.id, expectedRevision, existingRevision);
  }

  const nameChanged = existingRecord ? existingRecord.name !== project.name : true;
  const stateChanged = existingRecord ? hasStateChanged(existingRecord.state, persistedState) : true;
  const hasMeaningfulChange = nameChanged || stateChanged;
  const nextRevision = existingRecord ? (hasMeaningfulChange ? existingRevision + 1 : existingRevision) : 0;

  const activeCanvas =
    persistedState.canvases.find((canvas) => canvas.id === persistedState.currentCanvasId) ??
    persistedState.canvases[0];
  const activePreset = getCanvasPresetById(activeCanvas?.state.canvasPresetId ?? '886x1920');

  const updatedAt = hasMeaningfulChange
    ? project.updatedAt || new Date().toISOString()
    : existingRecord?.updatedAt || project.updatedAt || new Date().toISOString();
  const payload: ProjectFilePayload = {
    version: 3,
    project: {
      id: project.id,
      name: project.name,
      updatedAt,
      revision: nextRevision,
    },
    canvas: {
      width: activePreset.width,
      height: activePreset.height,
    },
    state: persistedState,
  };

  const existingPath = existingRecord?.sourcePath ?? (await findExistingProjectPath(project.id));
  const legacyPath =
    existingPath && path.resolve(existingPath).startsWith(path.resolve(LEGACY_API_PROJECTS_DIR))
      ? existingPath
      : null;
  const targetPath = createUnifiedProjectFilePath(project);
  const staleUnifiedPath =
    existingPath && !legacyPath && path.resolve(existingPath) !== path.resolve(targetPath)
      ? existingPath
      : null;
  const shouldWriteProjectFile = hasMeaningfulChange || Boolean(legacyPath) || Boolean(staleUnifiedPath) || !existingPath;

  if (shouldWriteProjectFile) {
    await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  if (legacyPath) {
    await rm(legacyPath, { force: true });
  }

  if (staleUnifiedPath) {
    await rm(staleUnifiedPath, { force: true });
  }

  return {
    ...project,
    source: 'api' as const,
    sourcePath: targetPath,
    updatedAt,
    revision: nextRevision,
    state: persistedState,
  };
}

export async function createProject(name?: string, state?: ProjectDesignState) {
  const project = createProjectRecord(
    name?.trim() || 'API Project',
    state ? cloneProjectDesignState(state) : createProjectDesignState(),
  );
  return saveProject(project);
}

export async function deleteProjectById(projectId: string) {
  await ensureDirectories();

  const unifiedPaths = await listProjectFilePaths(PROJECT_SAVES_DIR);
  const legacyPaths = await listLegacyJsonPaths();
  const allPaths = [...unifiedPaths, ...legacyPaths];

  let removedCount = 0;
  for (const sourcePath of allPaths) {
    const value = await tryReadJsonFile(sourcePath);
    const normalized = normalizeProjectRecord(value, 'api', sourcePath);
    if (!normalized || normalized.id !== projectId) {
      continue;
    }

    await rm(sourcePath, { force: true });
    removedCount += 1;
  }

  if (removedCount === 0) {
    throw new ProjectNotFoundError(projectId);
  }

  await deleteProjectMediaByProjectId(projectId);

  return removedCount;
}
