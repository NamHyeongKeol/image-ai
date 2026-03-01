import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cloneProjectDesignState,
  createProjectDesignState,
  createProjectRecord,
  normalizeProjectRecord,
  type ProjectDesignState,
  type StoredProjectRecord,
} from './domain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const APPSTORE_PREVIEW_ROOT = path.resolve(__dirname, '../..');
export const PROJECT_SAVES_DIR = path.join(APPSTORE_PREVIEW_ROOT, '.project-saves');
export const API_PROJECTS_DIR = path.join(PROJECT_SAVES_DIR, 'api-projects');

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

interface ApiProjectPersisted {
  version: 1;
  id: string;
  name: string;
  updatedAt: string;
  state: ProjectDesignState;
}

async function ensureDirectories() {
  await mkdir(PROJECT_SAVES_DIR, { recursive: true });
  await mkdir(API_PROJECTS_DIR, { recursive: true });
}

async function tryReadJsonFile(filePath: string) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toApiProjectPath(projectId: string) {
  return path.join(API_PROJECTS_DIR, `${projectId}.json`);
}

export async function listProjects() {
  await ensureDirectories();

  const byId = new Map<string, StoredProjectRecord>();

  const apiEntries = await readdir(API_PROJECTS_DIR, { withFileTypes: true });
  for (const entry of apiEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const sourcePath = path.join(API_PROJECTS_DIR, entry.name);
    const value = await tryReadJsonFile(sourcePath);
    const normalized = normalizeProjectRecord(value, 'api', sourcePath);
    if (!normalized) {
      continue;
    }

    byId.set(normalized.id, normalized);
  }

  const appSaveEntries = await readdir(PROJECT_SAVES_DIR, { withFileTypes: true });
  for (const entry of appSaveEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.appstore-preview-project.json')) {
      continue;
    }

    const sourcePath = path.join(PROJECT_SAVES_DIR, entry.name);
    const value = await tryReadJsonFile(sourcePath);
    const normalized = normalizeProjectRecord(value, 'app-save', sourcePath);
    if (!normalized) {
      continue;
    }

    if (!byId.has(normalized.id)) {
      byId.set(normalized.id, normalized);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

export async function saveProject(project: StoredProjectRecord) {
  await ensureDirectories();

  const persisted: ApiProjectPersisted = {
    version: 1,
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    state: cloneProjectDesignState(project.state),
  };

  const targetPath = toApiProjectPath(project.id);
  await writeFile(targetPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

  return {
    ...project,
    source: 'api' as const,
    sourcePath: targetPath,
    state: cloneProjectDesignState(project.state),
  };
}

export async function createProject(name?: string, state?: ProjectDesignState) {
  const project = createProjectRecord(
    name?.trim() || 'API Project',
    state ? cloneProjectDesignState(state) : createProjectDesignState(),
  );
  return saveProject(project);
}
