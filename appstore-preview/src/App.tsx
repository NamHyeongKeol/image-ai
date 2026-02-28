import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  DragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { Download, Film, Image as ImageIcon, Palette, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
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
  media: HTMLImageElement | HTMLVideoElement | null;
}

interface DragSession {
  target: DragTarget;
  pointerId: number;
  startPoint: Offset;
  startPhoneOffset: Offset;
  textBoxId?: string;
  startTextBoxPosition?: Offset;
  moved: boolean;
}

const CANVAS_PRESET = { label: '886 x 1920 (기본)', width: 886, height: 1920 } as const;

const BASE_PHONE_WIDTH = CANVAS_PRESET.width - 220;
const BASE_PHONE_HEIGHT = 1400;

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  }

  return layout;
}

function pickRecorderMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
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
  const nextTextBoxIdRef = useRef(1);

  const [assetKind, setAssetKind] = useState<MediaKind>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [assetName, setAssetName] = useState('');

  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(DEFAULTS.backgroundMode);
  const [backgroundPrimary, setBackgroundPrimary] = useState(DEFAULTS.backgroundPrimary);
  const [backgroundSecondary, setBackgroundSecondary] = useState(DEFAULTS.backgroundSecondary);
  const [gradientAngle, setGradientAngle] = useState(DEFAULTS.gradientAngle);

  const [phoneOffset, setPhoneOffset] = useState<Offset>({ x: 0, y: 0 });
  const [phoneScale, setPhoneScale] = useState(DEFAULTS.phoneScale);

  const [textBoxes, setTextBoxes] = useState<TextBoxModel[]>([]);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [isPlacingTextBox, setIsPlacingTextBox] = useState(false);

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isUploadDropActive, setIsUploadDropActive] = useState(false);
  const [isCanvasDropActive, setIsCanvasDropActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState(
    'iPhone 프레임/텍스트박스를 드래그해 배치하고, 이미지/영상을 DnD 또는 클릭 업로드해 주세요.',
  );

  const selectedTextBox = useMemo(
    () => textBoxes.find((box) => box.id === selectedTextBoxId) ?? null,
    [textBoxes, selectedTextBoxId],
  );

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
      media,
    });

    layoutRef.current = layout;
  }, [
    assetKind,
    backgroundMode,
    backgroundPrimary,
    backgroundSecondary,
    gradientAngle,
    phoneOffset,
    phoneScale,
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
      } catch (error) {
        imageRef.current = null;
        videoRef.current?.pause();
        videoRef.current = null;
        setAssetKind(null);
        setAssetName('');
        setAssetObjectUrl(null);
        setErrorMessage(error instanceof Error ? error.message : '업로드 처리에 실패했습니다.');
        setStatusMessage('파일을 다시 선택해 주세요.');
      }
    },
    [setAssetObjectUrl],
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
        dragSessionRef.current = {
          target: 'text-box',
          pointerId: event.pointerId,
          startPoint: point,
          startPhoneOffset: phoneOffset,
          textBoxId: hitTextBox.id,
          startTextBoxPosition: { x: hitTextBox.x, y: hitTextBox.y },
          moved: false,
        };

        return;
      }

      if (pointInRect(point, layout.phone.body)) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.style.cursor = 'grabbing';

        setSelectedTextBoxId(null);
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
    [bringTextBoxToFront, findTopmostTextBoxAtPoint, phoneOffset, toCanvasPoint],
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

        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          session.moved = true;
        }

        if (session.target === 'phone') {
          setPhoneOffset({
            x: session.startPhoneOffset.x + dx,
            y: session.startPhoneOffset.y + dy,
          });
          return;
        }

        if (session.target === 'text-box' && session.textBoxId && session.startTextBoxPosition) {
          setTextBoxes((previous) =>
            previous.map((box) =>
              box.id === session.textBoxId
                ? {
                    ...box,
                    x: session.startTextBoxPosition!.x + dx,
                    y: session.startTextBoxPosition!.y + dy,
                  }
                : box,
            ),
          );
          return;
        }
      }

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
    [findTopmostTextBoxAtPoint, isPlacingTextBox, toCanvasPoint],
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
    event.currentTarget.style.cursor = isPlacingTextBox ? 'crosshair' : 'default';
  }, [isPlacingTextBox]);

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
        await exportVideo();
        setStatusMessage('영상 출력 완료: 영상 파일이 저장되었습니다.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '내보내기에 실패했습니다.');
      setStatusMessage('오류를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setIsExporting(false);
    }
  }, [assetKind, exportImage, exportVideo]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_20%,#d9f4ff_0,#f2f4f7_42%,#eef2ff_100%)] px-4 py-8 text-zinc-900">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border border-white/70 bg-white/80 px-6 py-5 shadow-sm backdrop-blur">
          <h1 className="text-2xl font-semibold tracking-tight">App Store Preview Composer</h1>
          <p className="mt-2 text-sm text-zinc-600">
            iPhone 규격(886x1920) 기준으로 업로드/드래그 배치 후 결과물을 생성합니다.
          </p>
        </header>

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
