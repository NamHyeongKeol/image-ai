import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import {
  computeCanvasMeta,
  getCanvasPresetById,
  sanitizeFileNameSegment,
  type CanvasMeta,
  type StoredProjectRecord,
} from './domain.js';

interface ProjectZipOptions {
  includePngPreview?: boolean;
}

export interface ProjectZipResult {
  zipBuffer: Buffer;
  zipFileName: string;
  warnings: string[];
  canvasCount: number;
}

function roundedRectPath(
  ctx: {
    beginPath: () => void;
    moveTo: (x: number, y: number) => void;
    lineTo: (x: number, y: number) => void;
    quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) => void;
    closePath: () => void;
  },
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCanvasPreview(meta: CanvasMeta) {
  const canvas = createCanvas(meta.canvasPreset.width, meta.canvasPreset.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  if (meta.background.mode === 'solid') {
    ctx.fillStyle = meta.background.primary;
    ctx.fillRect(0, 0, meta.canvasPreset.width, meta.canvasPreset.height);
  } else {
    const rad = (meta.background.angle * Math.PI) / 180;
    const halfDiagonal = Math.sqrt(meta.canvasPreset.width ** 2 + meta.canvasPreset.height ** 2) / 2;
    const cx = meta.canvasPreset.width / 2;
    const cy = meta.canvasPreset.height / 2;
    const x0 = cx - Math.cos(rad) * halfDiagonal;
    const y0 = cy - Math.sin(rad) * halfDiagonal;
    const x1 = cx + Math.cos(rad) * halfDiagonal;
    const y1 = cy + Math.sin(rad) * halfDiagonal;
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, meta.background.primary);
    gradient.addColorStop(1, meta.background.secondary);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, meta.canvasPreset.width, meta.canvasPreset.height);
  }

  for (const textBox of meta.textBoxes) {
    ctx.fillStyle = textBox.font.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `800 ${textBox.font.size}px ${textBox.font.family}`;
    textBox.lines.forEach((line, index) => {
      ctx.fillText(line, textBox.x, textBox.y + index * textBox.lineHeight);
    });
  }

  const { body, screen, notch, radius, screenRadius } = meta.phone;
  const bodyGradient = ctx.createLinearGradient(body.x, body.y, body.x + body.width, body.y + body.height);
  bodyGradient.addColorStop(0, '#0f172a');
  bodyGradient.addColorStop(0.5, '#111827');
  bodyGradient.addColorStop(1, '#374151');

  roundedRectPath(ctx, body.x, body.y, body.width, body.height, radius);
  ctx.fillStyle = bodyGradient;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#94a3b8';
  ctx.stroke();

  roundedRectPath(ctx, screen.x, screen.y, screen.width, screen.height, screenRadius);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(screen.x, screen.y, screen.width, screen.height);

  ctx.fillStyle = '#475569';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.max(18, Math.round(meta.canvasPreset.height * 0.016))}px "Noto Sans KR", sans-serif`;
  if (meta.media.kind) {
    ctx.fillText(
      `${meta.media.kind.toUpperCase()}: ${meta.media.name || 'untitled media'}`,
      screen.x + screen.width / 2,
      screen.y + screen.height / 2,
    );
  } else {
    ctx.fillText('No media uploaded', screen.x + screen.width / 2, screen.y + screen.height / 2);
  }
  ctx.restore();

  roundedRectPath(ctx, notch.x, notch.y, notch.width, notch.height, Math.max(10, notch.height / 2));
  ctx.fillStyle = '#020617';
  ctx.fill();

  try {
    return canvas.toBuffer('image/png');
  } catch {
    return null;
  }
}

function buildI18nTextMap(project: StoredProjectRecord) {
  return project.state.canvases.map((canvas) => {
    const canvasMeta = computeCanvasMeta(canvas);
    return {
      canvasId: canvas.id,
      canvasName: canvas.name,
      canvasPresetId: canvas.state.canvasPresetId,
      textBoxes: canvasMeta.textBoxes.map((textBox) => ({
        id: textBox.id,
        text: textBox.text,
        width: textBox.width,
        fontKey: textBox.font.key,
        fontSize: textBox.font.size,
        color: textBox.font.color,
        lineCount: textBox.lineCount,
        lineClassification: textBox.lineClassification,
      })),
    };
  });
}

export async function buildProjectZip(project: StoredProjectRecord, options?: ProjectZipOptions): Promise<ProjectZipResult> {
  const includePngPreview = options?.includePngPreview ?? true;
  const zip = new JSZip();
  const warnings: string[] = [];

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
        },
        canvasCount: project.state.canvases.length,
      },
      null,
      2,
    ),
  );

  zip.file(
    'project.json',
    JSON.stringify(
      {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        state: project.state,
      },
      null,
      2,
    ),
  );

  zip.file('i18n/text-map.json', JSON.stringify(buildI18nTextMap(project), null, 2));

  for (const [index, canvas] of project.state.canvases.entries()) {
    const preset = getCanvasPresetById(canvas.state.canvasPresetId);
    const safeCanvasName = sanitizeFileNameSegment(canvas.name || `canvas-${index + 1}`);
    const canvasDir = `canvases/${String(index + 1).padStart(2, '0')}-${safeCanvasName}`;
    const canvasMeta = computeCanvasMeta(canvas);

    zip.file(
      `${canvasDir}/state.json`,
      JSON.stringify(
        {
          id: canvas.id,
          name: canvas.name,
          preset,
          state: canvas.state,
        },
        null,
        2,
      ),
    );
    zip.file(`${canvasDir}/meta.json`, JSON.stringify(canvasMeta, null, 2));

    if (includePngPreview) {
      const previewBuffer = drawCanvasPreview(canvasMeta);
      if (previewBuffer) {
        zip.file(`${canvasDir}/preview.png`, previewBuffer);
      } else {
        warnings.push(
          `${index + 1}. ${canvas.name}: preview PNG rendering failed, meta/state JSON exported instead.`,
        );
      }
    }

    if (canvas.state.media.kind) {
      warnings.push(
        `${index + 1}. ${canvas.name}: media "${canvas.state.media.name}" is referenced but not embedded in API export.`,
      );
    }
  }

  if (warnings.length > 0) {
    zip.file('warnings.txt', warnings.join('\n'));
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipFileName = `${sanitizeFileNameSegment(project.name)}-api-export-${Date.now()}.zip`;

  return {
    zipBuffer,
    zipFileName,
    warnings,
    canvasCount: project.state.canvases.length,
  };
}
