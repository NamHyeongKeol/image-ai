'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { applyBrushMosaic } from '@/lib/mosaic';
import { Upload, RefreshCw, Download, Undo2, Paintbrush } from 'lucide-react';

export function FaceMosaic() {
  const [isDragging, setIsDragging] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [brushSize, setBrushSize] = useState([40]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<ImageData[]>([]);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Draw image to canvas when image changes
  useEffect(() => {
    if (!image) return;
    
    const drawToCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        requestAnimationFrame(drawToCanvas);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Calculate dimensions (max 900px for good quality)
      const maxSize = 900;
      let width = image.width;
      let height = image.height;

      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = (height / width) * maxSize;
          width = maxSize;
        } else {
          width = (width / height) * maxSize;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(image, 0, 0, width, height);
      
      // Save initial state for undo
      historyRef.current = [ctx.getImageData(0, 0, width, height)];
      setCanUndo(false);
    };

    requestAnimationFrame(drawToCanvas);
  }, [image]);

  const handleFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setStatus({ type: 'error', message: '지원하지 않는 파일 형식입니다. (PNG, JPG, WEBP만 지원)' });
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setStatus({ type: 'error', message: '파일 크기가 너무 큽니다. (최대 20MB)' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        setImage(img);
        setStatus({ type: 'info', message: '브러쉬로 모자이크할 영역을 터치/드래그하세요!' });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Get canvas coordinates from mouse/touch event
  const getCanvasCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  // Save state for undo before drawing
  const saveState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current.push(currentState);
    // Keep only last 20 states to save memory
    if (historyRef.current.length > 20) {
      historyRef.current.shift();
    }
    setCanUndo(true);
  };

  // Apply mosaic at position
  const applyMosaicAt = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    applyBrushMosaic(ctx, x, y, brushSize[0], canvas.width, canvas.height);
  };

  // Interpolate between last position and current for smooth drawing
  const interpolateAndApply = (x: number, y: number) => {
    if (!lastPosRef.current) {
      applyMosaicAt(x, y);
      lastPosRef.current = { x, y };
      return;
    }

    const dx = x - lastPosRef.current.x;
    const dy = y - lastPosRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = brushSize[0] / 4; // Smooth interpolation

    if (dist > step) {
      const steps = Math.ceil(dist / step);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const interpX = lastPosRef.current.x + dx * t;
        const interpY = lastPosRef.current.y + dy * t;
        applyMosaicAt(interpX, interpY);
      }
    } else {
      applyMosaicAt(x, y);
    }

    lastPosRef.current = { x, y };
  };

  const handleDrawStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const coords = getCanvasCoords(e);
    if (!coords) return;

    saveState();
    setIsDrawing(true);
    lastPosRef.current = null;
    interpolateAndApply(coords.x, coords.y);
  };

  const handleDrawMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const coords = getCanvasCoords(e);
    if (!coords) return;

    interpolateAndApply(coords.x, coords.y);
  };

  const handleDrawEnd = () => {
    setIsDrawing(false);
    lastPosRef.current = null;
  };

  const handleUndo = () => {
    if (historyRef.current.length <= 1) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Remove current state and restore previous
    historyRef.current.pop();
    const previousState = historyRef.current[historyRef.current.length - 1];
    if (previousState) {
      ctx.putImageData(previousState, 0, 0);
    }
    
    setCanUndo(historyRef.current.length > 1);
    setStatus({ type: 'info', message: '실행 취소됨' });
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `mosaic_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    setStatus({ type: 'success', message: '이미지가 다운로드되었습니다!' });
  };

  const handleReset = () => {
    setImage(null);
    setStatus(null);
    historyRef.current = [];
    setCanUndo(false);
    
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 shadow-lg shadow-violet-500/25">
              <Paintbrush className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">
              Mosaic Brush
            </h1>
          </div>
          <p className="text-center text-slate-400 mt-2">
            브러쉬로 터치하여 원하는 영역을 모자이크 처리하세요
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Upload Section */}
        {!image && (
          <div className="max-w-2xl mx-auto">
            <Card
              className={`border-2 border-dashed transition-all duration-300 cursor-pointer ${
                isDragging
                  ? 'border-violet-500 bg-violet-500/10 scale-[1.02]'
                  : 'border-slate-700 bg-slate-900/50 hover:border-violet-500/50 hover:bg-slate-800/50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className={`p-4 rounded-full bg-slate-800 mb-6 transition-transform ${isDragging ? 'scale-110' : ''}`}>
                  <Upload className="w-12 h-12 text-violet-400" />
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">
                  이미지를 드래그 앤 드롭하세요
                </h2>
                <p className="text-slate-400 mb-4">또는 클릭하여 파일을 선택하세요</p>
                <span className="px-4 py-1.5 rounded-full bg-slate-800 text-sm text-slate-400">
                  PNG, JPG, JPEG, WEBP 지원
                </span>
              </CardContent>
            </Card>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
        )}

        {/* Editor Section */}
        {image && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Canvas */}
            <div className="flex justify-center">
              <Card className="bg-slate-900/50 border-slate-800 inline-block">
                <CardContent className="p-4">
                  <div 
                    className="bg-slate-950 rounded-lg p-2 cursor-crosshair touch-none"
                    style={{ 
                      cursor: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="${brushSize[0]}" height="${brushSize[0]}" viewBox="0 0 ${brushSize[0]} ${brushSize[0]}"><circle cx="${brushSize[0]/2}" cy="${brushSize[0]/2}" r="${brushSize[0]/2 - 1}" fill="none" stroke="white" stroke-width="2" opacity="0.7"/></svg>') ${brushSize[0]/2} ${brushSize[0]/2}, crosshair`
                    }}
                  >
                    <canvas
                      ref={canvasRef}
                      className="max-w-full rounded shadow-lg"
                      style={{ maxHeight: '70vh' }}
                      onMouseDown={handleDrawStart}
                      onMouseMove={handleDrawMove}
                      onMouseUp={handleDrawEnd}
                      onMouseLeave={handleDrawEnd}
                      onTouchStart={handleDrawStart}
                      onTouchMove={handleDrawMove}
                      onTouchEnd={handleDrawEnd}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Brush Size Control */}
            <Card className="max-w-md mx-auto bg-slate-900/50 border-slate-800">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <Paintbrush className="w-5 h-5 text-violet-400 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex justify-between mb-2">
                      <label className="text-sm font-medium text-slate-300">브러쉬 크기</label>
                      <span className="text-sm text-violet-400 font-mono">{brushSize[0]}px</span>
                    </div>
                    <Slider
                      value={brushSize}
                      onValueChange={setBrushSize}
                      min={10}
                      max={150}
                      step={5}
                      className="w-full"
                    />
                  </div>
                  {/* Brush Preview */}
                  <div 
                    className="flex-shrink-0 rounded-full border-2 border-violet-400/50"
                    style={{ 
                      width: Math.min(brushSize[0], 50), 
                      height: Math.min(brushSize[0], 50),
                      background: 'rgba(139, 92, 246, 0.2)'
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex flex-wrap justify-center gap-4">
              <Button
                variant="outline"
                onClick={handleReset}
                className="border-slate-700 hover:bg-slate-800"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                다시 시작
              </Button>
              <Button
                variant="outline"
                onClick={handleUndo}
                disabled={!canUndo}
                className="border-slate-700 hover:bg-slate-800"
              >
                <Undo2 className="w-4 h-4 mr-2" />
                실행 취소
              </Button>
              <Button
                onClick={handleDownload}
                className="bg-emerald-600 hover:bg-emerald-500"
              >
                <Download className="w-4 h-4 mr-2" />
                다운로드
              </Button>
            </div>

            {/* Status */}
            {status && (
              <div className="text-center">
                <p className={`text-sm ${
                  status.type === 'success' ? 'text-emerald-400' :
                  status.type === 'error' ? 'text-red-400' :
                  'text-slate-400'
                }`}>
                  {status.message}
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 mt-auto">
        <p className="text-center text-slate-500 text-sm">
          브러쉬 크기가 클수록 모자이크 강도가 강해집니다
        </p>
      </footer>
    </div>
  );
}
