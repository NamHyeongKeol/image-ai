import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Download, Film, Image as ImageIcon, Palette, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type MediaKind = 'image' | 'video' | null;
type BackgroundMode = 'solid' | 'gradient';
type ArtifactKind = 'image' | 'video';
type FontKey = (typeof FONT_OPTIONS)[number]['key'];

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
  titleText: string;
  titleFontFamily: string;
  titleColor: string;
  titleSize: number;
  media: HTMLImageElement | HTMLVideoElement | null;
}

const CANVAS_PRESET = { label: '886 x 1920 (기본)', width: 886, height: 1920 } as const;

const FONT_OPTIONS = [
  { key: 'pretendard', label: 'Pretendard', family: 'Pretendard, "Noto Sans KR", sans-serif' },
  { key: 'noto', label: 'Noto Sans KR', family: '"Noto Sans KR", sans-serif' },
  { key: 'nanum', label: 'Nanum Myeongjo', family: '"Nanum Myeongjo", serif' },
  { key: 'black-han', label: 'Black Han Sans', family: '"Black Han Sans", sans-serif' },
] as const;

const DEFAULTS = {
  titleText: '',
  titleFontKey: FONT_OPTIONS[0].key,
  titleColor: '#1f3b7c',
  titleSize: 66,
  backgroundMode: 'solid' as BackgroundMode,
  backgroundPrimary: '#f2f4f7',
  backgroundSecondary: '#dbeafe',
  gradientAngle: 26,
};

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

  return lines;
}

function drawComposition(ctx: CanvasRenderingContext2D, options: DrawOptions) {
  const {
    width,
    height,
    backgroundMode,
    backgroundPrimary,
    backgroundSecondary,
    gradientAngle,
    titleText,
    titleFontFamily,
    titleColor,
    titleSize,
    media,
  } = options;

  fillBackground(ctx, width, height, backgroundMode, backgroundPrimary, backgroundSecondary, gradientAngle);
  const hasTitle = titleText.trim().length > 0;

  if (hasTitle) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = titleColor;
    ctx.font = `800 ${titleSize}px ${titleFontFamily}`;
    const textLines = wrapTextToLines(ctx, titleText, width - 140);
    const lineHeight = titleSize * 1.2;
    const textStartY = 210;

    textLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, textStartY + index * lineHeight);
    });
    ctx.restore();
  }

  const phoneWidth = width - 220;
  const phoneHeight = 1400;
  const phoneX = (width - phoneWidth) / 2;
  const phoneY = hasTitle ? 440 : 260;
  const phoneRadius = 104;

  ctx.save();
  const bodyGradient = ctx.createLinearGradient(phoneX, phoneY, phoneX + phoneWidth, phoneY + phoneHeight);
  bodyGradient.addColorStop(0, '#0f172a');
  bodyGradient.addColorStop(0.5, '#111827');
  bodyGradient.addColorStop(1, '#374151');

  roundedRectPath(ctx, phoneX, phoneY, phoneWidth, phoneHeight, phoneRadius);
  ctx.fillStyle = bodyGradient;
  ctx.fill();

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  roundedRectPath(ctx, phoneX - 5, phoneY + 292, 6, 110, 4);
  ctx.fill();
  roundedRectPath(ctx, phoneX - 5, phoneY + 436, 6, 68, 4);
  ctx.fill();
  roundedRectPath(ctx, phoneX + phoneWidth - 1, phoneY + 350, 6, 140, 4);
  ctx.fill();

  const screenInset = 22;
  const screenX = phoneX + screenInset;
  const screenY = phoneY + screenInset;
  const screenWidth = phoneWidth - screenInset * 2;
  const screenHeight = phoneHeight - screenInset * 2;
  const screenRadius = 76;

  roundedRectPath(ctx, screenX, screenY, screenWidth, screenHeight, screenRadius);
  ctx.clip();
  ctx.fillStyle = '#dfe5ee';
  ctx.fillRect(screenX, screenY, screenWidth, screenHeight);

  const mediaReady =
    media instanceof HTMLVideoElement
      ? media.readyState >= 2 && media.videoWidth > 0 && media.videoHeight > 0
      : media instanceof HTMLImageElement
        ? media.naturalWidth > 0 && media.naturalHeight > 0
        : false;

  if (media && mediaReady) {
    drawMediaCover(ctx, media, screenX, screenY, screenWidth, screenHeight);
  } else {
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(screenX, screenY, screenWidth, screenHeight);
  }

  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, screenX + (screenWidth - 194) / 2, screenY + 14, 194, 46, 23);
  ctx.fillStyle = '#020617';
  ctx.fill();
  ctx.restore();
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

  const [assetKind, setAssetKind] = useState<MediaKind>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [assetName, setAssetName] = useState('');

  const [titleText, setTitleText] = useState(DEFAULTS.titleText);
  const [titleFontKey, setTitleFontKey] = useState<FontKey>(DEFAULTS.titleFontKey);
  const [titleColor, setTitleColor] = useState(DEFAULTS.titleColor);
  const [titleSize, setTitleSize] = useState(DEFAULTS.titleSize);

  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(DEFAULTS.backgroundMode);
  const [backgroundPrimary, setBackgroundPrimary] = useState(DEFAULTS.backgroundPrimary);
  const [backgroundSecondary, setBackgroundSecondary] = useState(DEFAULTS.backgroundSecondary);
  const [gradientAngle, setGradientAngle] = useState(DEFAULTS.gradientAngle);

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('이미지 또는 영상을 업로드해 주세요.');

  const selectedFont = useMemo(
    () => FONT_OPTIONS.find((option) => option.key === titleFontKey) ?? FONT_OPTIONS[0],
    [titleFontKey],
  );

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

    drawComposition(ctx, {
      width: CANVAS_PRESET.width,
      height: CANVAS_PRESET.height,
      backgroundMode,
      backgroundPrimary,
      backgroundSecondary,
      gradientAngle,
      titleText,
      titleFontFamily: selectedFont.family,
      titleColor,
      titleSize,
      media,
    });
  }, [assetKind, backgroundMode, backgroundPrimary, backgroundSecondary, gradientAngle, selectedFont.family, titleColor, titleSize, titleText]);

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

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';

      if (!file) {
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

        if (file.type.startsWith('video/')) {
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
          return;
        }

        throw new Error('이미지 또는 영상 파일만 업로드할 수 있습니다.');
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

  const resetStyle = useCallback(() => {
    setTitleText(DEFAULTS.titleText);
    setTitleFontKey(DEFAULTS.titleFontKey);
    setTitleColor(DEFAULTS.titleColor);
    setTitleSize(DEFAULTS.titleSize);
    setBackgroundMode(DEFAULTS.backgroundMode);
    setBackgroundPrimary(DEFAULTS.backgroundPrimary);
    setBackgroundSecondary(DEFAULTS.backgroundSecondary);
    setGradientAngle(DEFAULTS.gradientAngle);
    setStatusMessage('디자인 옵션을 기본값으로 초기화했습니다.');
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
      titleText,
      titleFontFamily: selectedFont.family,
      titleColor,
      titleSize,
      media: imageRef.current,
    });

    const blob = await blobFromCanvas(offscreen);
    setArtifactBlob(blob, 'image', 'image/png', buildOutputFileName(assetName || 'preview', 'png'));
  }, [assetName, backgroundMode, backgroundPrimary, backgroundSecondary, gradientAngle, selectedFont.family, setArtifactBlob, titleColor, titleSize, titleText]);

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
            titleText,
            titleFontFamily: selectedFont.family,
            titleColor,
            titleSize,
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
  }, [assetName, assetUrl, backgroundMode, backgroundPrimary, backgroundSecondary, gradientAngle, selectedFont.family, setArtifactBlob, titleColor, titleSize, titleText]);

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
            iPhone 규격(886x1920) 기준으로 이미지/영상을 업로드하고 배경·텍스트를 조정해 결과물을 생성합니다.
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

                <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                      이미지/영상 업로드
                    </Button>
                    <span className="text-sm text-zinc-600">지원: image/*, video/*</span>
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
                <Label>3. 상단 텍스트</Label>
                <Textarea
                  value={titleText}
                  onChange={(event) => setTitleText(event.target.value)}
                  placeholder="비워두면 상단 텍스트가 표시되지 않습니다."
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-zinc-500">서체</Label>
                    <select
                      value={titleFontKey}
                      onChange={(event) => setTitleFontKey(event.target.value as FontKey)}
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
                    <Input type="color" value={titleColor} onChange={(event) => setTitleColor(event.target.value)} className="h-10" />
                  </div>
                </div>

                <div className="rounded-md border border-zinc-300 bg-white px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>크기</span>
                    <span>{titleSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={42}
                    max={92}
                    value={titleSize}
                    onChange={(event) => setTitleSize(Number(event.target.value))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={resetStyle}>
                  <RotateCcw className="h-4 w-4" />
                  스타일 초기화
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
                <CardDescription>실제 출력 비율(886x1920)을 축소해서 표시합니다.</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <div className="w-full max-w-[360px] rounded-[28px] border border-zinc-200 bg-zinc-100 p-3 shadow-inner">
                  <canvas
                    ref={previewCanvasRef}
                    className="h-auto w-full rounded-[22px]"
                    style={{ aspectRatio: `${CANVAS_PRESET.width}/${CANVAS_PRESET.height}` }}
                  />
                </div>
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
