import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Crop as CropIcon,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';

export interface PhotoCropModalProps {
  file: File;
  queueIndex: number;
  queueTotal: number;
  onConfirm: (croppedFile: File) => void;
  onUseOriginal: () => void;
  onCancel: () => void;
}

type AspectPresetId = 'free' | '4:3' | '16:9' | '1:1' | '3:4';

interface AspectPreset {
  id: AspectPresetId;
  label: string;
  ratio: number | null;
}

const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Bebas', ratio: null },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
];

interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

interface DragState {
  handle: DragHandle;
  startClientX: number;
  startClientY: number;
  startRectPx: { x: number; y: number; w: number; h: number };
  dispW: number;
  dispH: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar untuk dipotong'));
    img.src = src;
  });
}

function computeCenteredRectForRatio(
  natW: number,
  natH: number,
  ratio: number | null
): NormRect {
  if (!ratio || natW <= 0 || natH <= 0) {
    return { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
  }

  const imgRatio = natW / natH;
  const maxFrac = 0.92;
  let wNorm: number;
  let hNorm: number;

  if (ratio >= imgRatio) {
    wNorm = maxFrac;
    hNorm = (wNorm * imgRatio) / ratio;
  } else {
    hNorm = maxFrac;
    wNorm = (hNorm * ratio) / imgRatio;
  }

  return {
    x: (1 - wNorm) / 2,
    y: (1 - hNorm) / 2,
    w: wNorm,
    h: hNorm,
  };
}

export const PhotoCropModal: React.FC<PhotoCropModalProps> = ({
  file,
  queueIndex,
  queueTotal,
  onConfirm,
  onUseOriginal,
  onCancel,
}) => {
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const [aspectId, setAspectId] = useState<AspectPresetId>('free');
  const [crop, setCrop] = useState<NormRect>({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
  const [working, setWorking] = useState(false);

  const stageImgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const workingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeUrlRef = useRef<string>('');

  const activeRatio =
    ASPECT_PRESETS.find((p) => p.id === aspectId)?.ratio ?? null;

  // Initialize image into a canvas-backed object URL so rotations & crops are crisp
  useEffect(() => {
    let cancelled = false;
    const rawUrl = URL.createObjectURL(file);
    activeUrlRef.current = rawUrl;

    loadImageElement(rawUrl)
      .then((img) => {
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
        }
        workingCanvasRef.current = canvas;
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        setSourceUrl(rawUrl);
        setAspectId('free');
        setCrop({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
      })
      .catch(() => {
        if (!cancelled) {
          setSourceUrl(rawUrl);
        }
      });

    return () => {
      cancelled = true;
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
        activeUrlRef.current = '';
      }
    };
  }, [file]);

  const handleSelectAspect = (preset: AspectPreset) => {
    setAspectId(preset.id);
    if (naturalSize.w > 0 && naturalSize.h > 0) {
      setCrop(computeCenteredRectForRatio(naturalSize.w, naturalSize.h, preset.ratio));
    }
  };

  const handleResetCrop = () => {
    setCrop(computeCenteredRectForRatio(naturalSize.w, naturalSize.h, activeRatio));
  };

  const handleRotate = (direction: 'cw' | 'ccw') => {
    const srcCanvas = workingCanvasRef.current;
    if (!srcCanvas) return;

    const newCanvas = document.createElement('canvas');
    newCanvas.width = srcCanvas.height;
    newCanvas.height = srcCanvas.width;
    const ctx = newCanvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    if (direction === 'cw') {
      ctx.translate(newCanvas.width, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, newCanvas.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.restore();

    workingCanvasRef.current = newCanvas;
    const nextSize = { w: newCanvas.width, h: newCanvas.height };
    setNaturalSize(nextSize);
    setCrop(computeCenteredRectForRatio(nextSize.w, nextSize.h, activeRatio));

    newCanvas.toBlob(
      (blob) => {
        if (!blob) return;
        const nextUrl = URL.createObjectURL(blob);
        activeUrlRef.current = nextUrl;
        setSourceUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return nextUrl;
        });
      },
      'image/jpeg',
      0.95
    );
  };

  const beginDrag = (
    e: React.PointerEvent<HTMLElement>,
    handle: DragHandle
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const overlay = overlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    dragRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRectPx: {
        x: crop.x * rect.width,
        y: crop.y * rect.height,
        w: crop.w * rect.width,
        h: crop.h * rect.height,
      },
      dispW: rect.width,
      dispH: rect.height,
    };
  };

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();

      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      const { startRectPx, dispW, dispH, handle } = drag;
      const minPx = Math.min(48, dispW * 0.2, dispH * 0.2);

      let { x, y, w, h } = startRectPx;

      if (handle === 'move') {
        x = clamp(startRectPx.x + dx, 0, dispW - startRectPx.w);
        y = clamp(startRectPx.y + dy, 0, dispH - startRectPx.h);
      } else if (!activeRatio) {
        // Freeform resize
        if (handle.includes('e')) {
          w = clamp(startRectPx.w + dx, minPx, dispW - startRectPx.x);
        }
        if (handle.includes('s')) {
          h = clamp(startRectPx.h + dy, minPx, dispH - startRectPx.y);
        }
        if (handle.includes('w')) {
          const maxLeft = startRectPx.x + startRectPx.w - minPx;
          const nextX = clamp(startRectPx.x + dx, 0, maxLeft);
          w = startRectPx.x + startRectPx.w - nextX;
          x = nextX;
        }
        if (handle.includes('n')) {
          const maxTop = startRectPx.y + startRectPx.h - minPx;
          const nextY = clamp(startRectPx.y + dy, 0, maxTop);
          h = startRectPx.y + startRectPx.h - nextY;
          y = nextY;
        }
      } else {
        // Aspect-locked resize using corner handles
        const anchorRight = startRectPx.x + startRectPx.w;
        const anchorBottom = startRectPx.y + startRectPx.h;

        const candFromX = handle.includes('w')
          ? startRectPx.w - dx
          : startRectPx.w + dx;
        const candFromY =
          (handle.includes('n') ? startRectPx.h - dy : startRectPx.h + dy) *
          activeRatio;
        const candidateW =
          Math.abs(dx) >= Math.abs(dy * activeRatio) ? candFromX : candFromY;

        const maxW = handle.includes('w') ? anchorRight : dispW - startRectPx.x;
        const maxH = handle.includes('n') ? anchorBottom : dispH - startRectPx.y;
        const maxWByH = maxH * activeRatio;
        const minW = Math.max(minPx, minPx * activeRatio);

        w = clamp(candidateW, minW, Math.min(maxW, maxWByH));
        h = w / activeRatio;

        if (handle.includes('w')) {
          x = anchorRight - w;
        }
        if (handle.includes('n')) {
          y = anchorBottom - h;
        }
      }

      setCrop({
        x: x / dispW,
        y: y / dispH,
        w: w / dispW,
        h: h / dispH,
      });
    },
    [activeRatio]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleConfirmCrop = async () => {
    const srcCanvas = workingCanvasRef.current;
    if (!srcCanvas) {
      onUseOriginal();
      return;
    }

    setWorking(true);
    try {
      const sx = Math.max(0, Math.round(crop.x * srcCanvas.width));
      const sy = Math.max(0, Math.round(crop.y * srcCanvas.height));
      const sw = Math.max(
        1,
        Math.min(srcCanvas.width - sx, Math.round(crop.w * srcCanvas.width))
      );
      const sh = Math.max(
        1,
        Math.min(srcCanvas.height - sy, Math.round(crop.h * srcCanvas.height))
      );

      const outCanvas = document.createElement('canvas');
      outCanvas.width = sw;
      outCanvas.height = sh;
      const ctx = outCanvas.getContext('2d');
      if (!ctx) {
        onUseOriginal();
        return;
      }

      ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

      const blob = await new Promise<Blob | null>((resolve) =>
        outCanvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
      );

      if (!blob) {
        onUseOriginal();
        return;
      }

      const baseName = file.name.replace(/\.[^.]+$/, '');
      const croppedFile = new File([blob], `${baseName}-crop.jpg`, {
        type: 'image/jpeg',
      });
      onConfirm(croppedFile);
    } finally {
      setWorking(false);
    }
  };

  const outPxW = Math.max(1, Math.round(crop.w * naturalSize.w));
  const outPxH = Math.max(1, Math.round(crop.h * naturalSize.h));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-modal-title"
    >
      <div className="w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl bg-slate-900 text-slate-100 border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[94dvh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <CropIcon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h2
                id="crop-modal-title"
                className="truncate text-sm sm:text-base font-bold text-white"
              >
                Potong (Crop) Foto
              </h2>
              <p className="text-[11px] text-slate-400 tabular-nums">
                {queueTotal > 1
                  ? `Foto ${queueIndex + 1} dari ${queueTotal} · `
                  : ''}
                Geser kotak atau tarik sudut untuk memotong
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleRotate('ccw')}
              title="Putar Kiri 90°"
              aria-label="Putar Kiri 90 derajat"
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handleRotate('cw')}
              title="Putar Kanan 90°"
              aria-label="Putar Kanan 90 derajat"
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Tutup crop foto"
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Crop Stage */}
        <div
          className="relative flex-1 min-h-[240px] flex items-center justify-center bg-slate-950 p-4 overflow-hidden select-none"
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {sourceUrl ? (
            <div className="relative inline-block max-w-full max-h-[50dvh] overflow-hidden rounded-lg">
              <img
                ref={stageImgRef}
                src={sourceUrl}
                alt="Pratinjau crop foto"
                draggable={false}
                referrerPolicy="no-referrer"
                className="block max-w-full max-h-[50dvh] w-auto h-auto select-none pointer-events-none"
              />

              {/* Interactive Crop Box Overlay */}
              <div
                ref={overlayRef}
                className="absolute inset-0 touch-none"
              >
                <div
                  onPointerDown={(e) => beginDrag(e, 'move')}
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                    boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.68)',
                  }}
                  className="absolute border-2 border-white cursor-move"
                >
                  {/* 3x3 Rule of thirds guide lines */}
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                    <div className="border-r border-b border-white/25" />
                    <div className="border-r border-b border-white/25" />
                    <div className="border-b border-white/25" />
                    <div className="border-r border-b border-white/25" />
                    <div className="border-r border-b border-white/25" />
                    <div className="border-b border-white/25" />
                    <div className="border-r border-white/25" />
                    <div className="border-r border-white/25" />
                    <div />
                  </div>

                  {/* Corner Resize Handles (large touch hitboxes) */}
                  <button
                    type="button"
                    aria-label="Tarik sudut kiri atas"
                    onPointerDown={(e) => beginDrag(e, 'nw')}
                    className="absolute -left-3.5 -top-3.5 h-8 w-8 flex items-center justify-center cursor-nwse-resize touch-none"
                  >
                    <span className="h-3.5 w-3.5 rounded-full bg-white border-2 border-emerald-600 shadow-sm" />
                  </button>
                  <button
                    type="button"
                    aria-label="Tarik sudut kanan atas"
                    onPointerDown={(e) => beginDrag(e, 'ne')}
                    className="absolute -right-3.5 -top-3.5 h-8 w-8 flex items-center justify-center cursor-nesw-resize touch-none"
                  >
                    <span className="h-3.5 w-3.5 rounded-full bg-white border-2 border-emerald-600 shadow-sm" />
                  </button>
                  <button
                    type="button"
                    aria-label="Tarik sudut kiri bawah"
                    onPointerDown={(e) => beginDrag(e, 'sw')}
                    className="absolute -left-3.5 -bottom-3.5 h-8 w-8 flex items-center justify-center cursor-nesw-resize touch-none"
                  >
                    <span className="h-3.5 w-3.5 rounded-full bg-white border-2 border-emerald-600 shadow-sm" />
                  </button>
                  <button
                    type="button"
                    aria-label="Tarik sudut kanan bawah"
                    onPointerDown={(e) => beginDrag(e, 'se')}
                    className="absolute -right-3.5 -bottom-3.5 h-8 w-8 flex items-center justify-center cursor-nwse-resize touch-none"
                  >
                    <span className="h-3.5 w-3.5 rounded-full bg-white border-2 border-emerald-600 shadow-sm" />
                  </button>

                  {/* Side Edge Handles when Freeform */}
                  {!activeRatio && (
                    <>
                      <button
                        type="button"
                        aria-label="Tarik tepi atas"
                        onPointerDown={(e) => beginDrag(e, 'n')}
                        className="absolute left-1/2 -top-3 -translate-x-1/2 h-6 w-10 flex items-center justify-center cursor-ns-resize touch-none"
                      >
                        <span className="h-1.5 w-6 rounded-full bg-white shadow-sm" />
                      </button>
                      <button
                        type="button"
                        aria-label="Tarik tepi bawah"
                        onPointerDown={(e) => beginDrag(e, 's')}
                        className="absolute left-1/2 -bottom-3 -translate-x-1/2 h-6 w-10 flex items-center justify-center cursor-ns-resize touch-none"
                      >
                        <span className="h-1.5 w-6 rounded-full bg-white shadow-sm" />
                      </button>
                      <button
                        type="button"
                        aria-label="Tarik tepi kiri"
                        onPointerDown={(e) => beginDrag(e, 'w')}
                        className="absolute -left-3 top-1/2 -translate-y-1/2 h-10 w-6 flex items-center justify-center cursor-ew-resize touch-none"
                      >
                        <span className="h-6 w-1.5 rounded-full bg-white shadow-sm" />
                      </button>
                      <button
                        type="button"
                        aria-label="Tarik tepi kanan"
                        onPointerDown={(e) => beginDrag(e, 'e')}
                        className="absolute -right-3 top-1/2 -translate-y-1/2 h-10 w-6 flex items-center justify-center cursor-ew-resize touch-none"
                      >
                        <span className="h-6 w-1.5 rounded-full bg-white shadow-sm" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Memuat foto...</p>
          )}
        </div>

        {/* Bottom Controls */}
        <div className="border-t border-white/10 bg-slate-900 px-4 sm:px-5 py-3.5 space-y-3">
          {/* Aspect Ratio Bar & Resolution */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {ASPECT_PRESETS.map((preset) => {
                const isActive = aspectId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectAspect(preset)}
                    className={`min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isActive
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white/10 text-slate-300 hover:bg-white/15'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={handleResetCrop}
                className="min-h-[36px] rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Reset
              </button>
            </div>

            {naturalSize.w > 0 && (
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {outPxW} × {outPxH} px
              </span>
            )}
          </div>

          {/* Primary Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={onUseOriginal}
              className="min-h-[44px] flex-1 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/15 transition-colors whitespace-nowrap cursor-pointer"
            >
              Gunakan Asli
            </button>
            <button
              type="button"
              disabled={working || !sourceUrl}
              onClick={handleConfirmCrop}
              className="min-h-[44px] flex-[1.3] inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <Check className="h-4 w-4 shrink-0" />
              <span>{working ? 'Memotong...' : 'Simpan Crop'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
