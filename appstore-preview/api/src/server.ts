import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  cloneProjectDesignState,
  cloneProjectForApi,
  computeCanvasMeta,
  createProjectDesignState,
  findCanvas,
  findTextBox,
  normalizeProjectRecord,
  patchTextBox,
  sanitizeProjectState,
  type StoredProjectRecord,
  type TextBoxModel,
} from './domain.js';
import {
  APPSTORE_PREVIEW_ROOT,
  ProjectNotFoundError,
  createProject,
  getProjectOrThrow,
  listProjects,
  saveProject,
} from './store.js';
import { buildProjectZip } from './zip.js';

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

interface JsonObject {
  [key: string]: unknown;
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(response: ServerResponse, status: number, payload: JsonObject) {
  setCorsHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendBinary(
  response: ServerResponse,
  status: number,
  contentType: string,
  fileName: string,
  data: Buffer,
  extraHeaders?: Record<string, string>,
) {
  setCorsHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  response.setHeader('Content-Length', String(data.length));
  if (extraHeaders) {
    for (const [headerName, headerValue] of Object.entries(extraHeaders)) {
      response.setHeader(headerName, headerValue);
    }
  }
  response.end(data);
}

function toProjectSummary(project: StoredProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    canvasCount: project.state.canvases.length,
    currentCanvasId: project.state.currentCanvasId,
    source: project.source,
  };
}

function ensureJsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of request) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += bufferChunk.length;
    if (totalLength > 10 * 1024 * 1024) {
      throw new HttpError(413, 'Request body is too large (max 10MB).');
    }
    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return ensureJsonObject(parsed);
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function notFound() {
  throw new HttpError(404, 'API route not found.');
}

function getParam(segments: string[], index: number, label: string) {
  const value = segments[index];
  if (!value) {
    throw new HttpError(400, `Missing path parameter: ${label}`);
  }
  return decodeURIComponent(value);
}

function cloneAsEditableProject(project: StoredProjectRecord): StoredProjectRecord {
  return {
    ...project,
    source: 'api',
    sourcePath: '',
    updatedAt: new Date().toISOString(),
    state: cloneProjectDesignState(project.state),
  };
}

function resolveCanvasOrThrow(project: StoredProjectRecord, canvasId: string) {
  const canvas = findCanvas(project.state, canvasId);
  if (!canvas) {
    throw new HttpError(404, `Canvas not found: ${canvasId}`);
  }
  return canvas;
}

function resolveTextBoxOrThrow(canvas: ReturnType<typeof resolveCanvasOrThrow>, textBoxId: string) {
  const textBox = findTextBox(canvas, textBoxId);
  if (!textBox) {
    throw new HttpError(404, `Text box not found: ${textBoxId}`);
  }
  return textBox;
}

function patchProjectTextBox(
  project: StoredProjectRecord,
  canvasId: string,
  textBoxId: string,
  patch: Partial<TextBoxModel>,
) {
  const canvas = resolveCanvasOrThrow(project, canvasId);
  resolveTextBoxOrThrow(canvas, textBoxId);

  canvas.state.textBoxes = canvas.state.textBoxes.map((box) => (box.id === textBoxId ? patchTextBox(box, patch) : box));
  project.updatedAt = new Date().toISOString();
}

async function importProjectFromFile(filePathInput: string) {
  const resolvedFilePath = path.isAbsolute(filePathInput)
    ? filePathInput
    : path.resolve(APPSTORE_PREVIEW_ROOT, filePathInput);
  const raw = await readFile(resolvedFilePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const normalized = normalizeProjectRecord(parsed, 'api', resolvedFilePath);
  if (!normalized) {
    throw new HttpError(400, `Could not parse project file: ${resolvedFilePath}`);
  }

  return normalized;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  if (!request.url || !request.method) {
    throw new HttpError(400, 'Invalid request.');
  }

  if (request.method === 'OPTIONS') {
    setCorsHeaders(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  const url = new URL(request.url, 'http://127.0.0.1');
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] !== 'api') {
    notFound();
  }

  if (request.method === 'GET' && segments.length === 2 && segments[1] === 'health') {
    sendJson(response, 200, {
      ok: true,
      service: 'appstore-preview-api',
      now: new Date().toISOString(),
    });
    return;
  }

  if (segments[1] !== 'projects') {
    notFound();
  }

  if (request.method === 'GET' && segments.length === 2) {
    const projects = await listProjects();
    sendJson(response, 200, {
      projects: projects.map((project) => toProjectSummary(project)),
      total: projects.length,
    });
    return;
  }

  if (request.method === 'POST' && segments.length === 2) {
    const body = await readJsonBody(request);
    const projectName = typeof body.name === 'string' ? body.name : undefined;
    const state = body.state ? sanitizeProjectState(body.state) : createProjectDesignState();
    const project = await createProject(projectName, state);
    sendJson(response, 201, {
      project: toProjectSummary(project),
      state: project.state,
    });
    return;
  }

  if (request.method === 'POST' && segments.length === 3 && segments[2] === 'import') {
    const body = await readJsonBody(request);
    const payload = body.payload as unknown;
    const filePath = typeof body.filePath === 'string' ? body.filePath : null;
    const nameOverride = typeof body.name === 'string' ? body.name.trim() : '';

    let imported: StoredProjectRecord;
    if (payload) {
      const normalized = normalizeProjectRecord(payload, 'api', '[payload]');
      if (!normalized) {
        throw new HttpError(400, 'Invalid project payload.');
      }
      imported = normalized;
    } else if (filePath) {
      imported = await importProjectFromFile(filePath);
    } else {
      throw new HttpError(400, 'Either "payload" or "filePath" is required.');
    }

    const editable = cloneAsEditableProject(imported);
    if (nameOverride) {
      editable.name = nameOverride;
    }
    const persisted = await saveProject(editable);
    sendJson(response, 201, {
      imported: true,
      project: toProjectSummary(persisted),
      state: persisted.state,
    });
    return;
  }

  const projectId = getParam(segments, 2, 'projectId');
  const project = await getProjectOrThrow(projectId);

  if (request.method === 'GET' && segments.length === 3) {
    sendJson(response, 200, {
      project: toProjectSummary(project),
      state: project.state,
    });
    return;
  }

  if (request.method === 'POST' && segments.length === 4 && segments[3] === 'clone') {
    const body = await readJsonBody(request);
    const nextName = typeof body.name === 'string' ? body.name : undefined;
    const cloned = cloneProjectForApi(project, nextName);
    const persisted = await saveProject(cloned);
    sendJson(response, 201, {
      clonedFrom: project.id,
      project: toProjectSummary(persisted),
      state: persisted.state,
    });
    return;
  }

  if (request.method === 'GET' && segments.length === 4 && segments[3] === 'meta') {
    const canvasMetas = project.state.canvases.map((canvas) => computeCanvasMeta(canvas));
    sendJson(response, 200, {
      project: toProjectSummary(project),
      metas: canvasMetas,
    });
    return;
  }

  if (request.method === 'POST' && segments.length === 5 && segments[3] === 'export' && segments[4] === 'zip') {
    const body = await readJsonBody(request);
    const includePngPreview = body.includePngPreview !== false;
    const exported = await buildProjectZip(project, { includePngPreview });

    sendBinary(
      response,
      200,
      'application/zip',
      exported.zipFileName,
      exported.zipBuffer,
      {
        'X-AppStore-Preview-Warnings': String(exported.warnings.length),
        'X-AppStore-Preview-Canvas-Count': String(exported.canvasCount),
      },
    );
    return;
  }

  if (segments.length < 6 || segments[3] !== 'canvases') {
    notFound();
  }

  const canvasId = getParam(segments, 4, 'canvasId');
  const canvas = resolveCanvasOrThrow(project, canvasId);

  if (request.method === 'GET' && segments.length === 6 && segments[5] === 'meta') {
    sendJson(response, 200, {
      project: toProjectSummary(project),
      canvasMeta: computeCanvasMeta(canvas),
    });
    return;
  }

  if (segments.length >= 6 && segments[5] === 'text-boxes') {
    if (request.method === 'PATCH' && segments.length === 6) {
      const body = await readJsonBody(request);
      const updates = Array.isArray(body.updates) ? (body.updates as unknown[]) : null;
      if (!updates || updates.length === 0) {
        throw new HttpError(400, '"updates" array is required.');
      }

      const editable = cloneAsEditableProject(project);
      const skipped: string[] = [];
      const updatedTextBoxIds: string[] = [];

      for (const row of updates) {
        if (!row || typeof row !== 'object') {
          continue;
        }
        const patchPayload = row as JsonObject;
        const textBoxId = typeof patchPayload.id === 'string' ? patchPayload.id : null;
        if (!textBoxId) {
          continue;
        }

        const targetCanvas = resolveCanvasOrThrow(editable, canvasId);
        const targetBox = findTextBox(targetCanvas, textBoxId);
        if (!targetBox) {
          skipped.push(textBoxId);
          continue;
        }

        patchProjectTextBox(editable, canvasId, textBoxId, patchPayload as Partial<TextBoxModel>);
        updatedTextBoxIds.push(textBoxId);
      }

      if (updatedTextBoxIds.length === 0) {
        throw new HttpError(400, 'No text boxes were updated.');
      }

      const persisted = await saveProject(editable);
      const nextCanvas = resolveCanvasOrThrow(persisted, canvasId);
      const canvasMeta = computeCanvasMeta(nextCanvas);
      sendJson(response, 200, {
        project: toProjectSummary(persisted),
        updatedTextBoxIds,
        skippedTextBoxIds: skipped,
        canvasMeta,
      });
      return;
    }

    if (segments.length >= 7) {
      const textBoxId = getParam(segments, 6, 'textBoxId');

      if (request.method === 'PATCH' && segments.length === 7) {
        const body = await readJsonBody(request);
        const editable = cloneAsEditableProject(project);
        patchProjectTextBox(editable, canvasId, textBoxId, body as Partial<TextBoxModel>);
        const persisted = await saveProject(editable);
        const nextCanvas = resolveCanvasOrThrow(persisted, canvasId);
        const textBoxMeta = computeCanvasMeta(nextCanvas).textBoxes.find((item) => item.id === textBoxId) ?? null;

        sendJson(response, 200, {
          project: toProjectSummary(persisted),
          canvasId,
          textBoxId,
          textBoxMeta,
        });
        return;
      }

      if (request.method === 'GET' && segments.length === 8 && segments[7] === 'meta') {
        resolveTextBoxOrThrow(canvas, textBoxId);
        const textBoxMeta = computeCanvasMeta(canvas).textBoxes.find((item) => item.id === textBoxId) ?? null;
        sendJson(response, 200, {
          projectId: project.id,
          canvasId,
          textBoxId,
          textBoxMeta,
        });
        return;
      }
    }
  }

  notFound();
}

function toErrorPayload(error: unknown) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      message: error.message,
    };
  }

  if (error instanceof ProjectNotFoundError) {
    return {
      status: 404,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: 'Unknown server error.',
  };
}

const apiPort = Number(process.env.APPSTORE_PREVIEW_API_PORT ?? 4318);

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    const payload = toErrorPayload(error);
    sendJson(response, payload.status, { error: payload.message });
  }
});

server.listen(apiPort, () => {
  console.log(`[appstore-preview-api] listening on http://localhost:${apiPort}`);
});
