'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { removeGreenBackground } from '@/lib/positionGenerator';

const CANVAS_W = 1620;
const CANVAS_H = 2880;
const HEAD_LINE = 619;
const FEET_LINE = 2724;
const TARGET_H = FEET_LINE - HEAD_LINE; // 2105
const HANDLE_R = 28; // handle radius in canvas coords

type HandleId = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l';

interface Rect { x: number; y: number; w: number; h: number; }

interface DragState {
  mode: 'move' | 'resize' | null;
  handle: HandleId | null;
  startMouseX: number;
  startMouseY: number;
  startPos: Rect;
  aspectRatio: number;
}

interface Props {
  imageDataUrl: string;
  onClose: () => void;
}

function getHandles(p: Rect): { id: HandleId; cx: number; cy: number }[] {
  return [
    { id: 'tl', cx: p.x,           cy: p.y },
    { id: 't',  cx: p.x + p.w / 2, cy: p.y },
    { id: 'tr', cx: p.x + p.w,     cy: p.y },
    { id: 'r',  cx: p.x + p.w,     cy: p.y + p.h / 2 },
    { id: 'br', cx: p.x + p.w,     cy: p.y + p.h },
    { id: 'b',  cx: p.x + p.w / 2, cy: p.y + p.h },
    { id: 'bl', cx: p.x,           cy: p.y + p.h },
    { id: 'l',  cx: p.x,           cy: p.y + p.h / 2 },
  ];
}

function applyResize(handle: HandleId, dx: number, dy: number, sp: Rect): Rect {
  const ar = sp.w / sp.h;
  let { x, y, w, h } = sp;

  switch (handle) {
    case 'br': { const nw = Math.max(100, w + dx); return { x, y, w: nw, h: nw / ar }; }
    case 'bl': { const nw = Math.max(100, w - dx); return { x: x + w - nw, y, w: nw, h: nw / ar }; }
    case 'tr': { const nw = Math.max(100, w + dx); const nh = nw / ar; return { x, y: y + h - nh, w: nw, h: nh }; }
    case 'tl': { const nw = Math.max(100, w - dx); const nh = nw / ar; return { x: x + w - nw, y: y + h - nh, w: nw, h: nh }; }
    case 'r':  { const nw = Math.max(100, w + dx); const nh = nw / ar; return { x, y: y + (h - nh) / 2, w: nw, h: nh }; }
    case 'l':  { const nw = Math.max(100, w - dx); const nh = nw / ar; return { x: x + w - nw, y: y + (h - nh) / 2, w: nw, h: nh }; }
    case 'b':  { const nh = Math.max(100, h + dy); const nw = nh * ar; return { x: x + (w - nw) / 2, y, w: nw, h: nh }; }
    case 't':  { const nh = Math.max(100, h - dy); const nw = nh * ar; return { x: x + (w - nw) / 2, y: y + h - nh, w: nw, h: nh }; }
    default: return sp;
  }
}

export default function ImageResizeEditor({ imageDataUrl, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [subjectImg, setSubjectImg] = useState<HTMLImageElement | null>(null);
  const [srcRect, setSrcRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [pos, setPos] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [selected, setSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState('default');

  const posRef = useRef(pos);
  posRef.current = pos;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const dragState = useRef<DragState>({
    mode: null,
    handle: null,
    startMouseX: 0,
    startMouseY: 0,
    startPos: { x: 0, y: 0, w: 0, h: 0 },
    aspectRatio: 1,
  });

  // Load and process image on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      const transparentUrl = await removeGreenBackground(imageDataUrl);
      const img = new Image();
      img.onload = () => {
        // Detect bounding box of non-transparent pixels
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        const tmpCtx = tmp.getContext('2d')!;
        tmpCtx.drawImage(img, 0, 0);
        const pixels = tmpCtx.getImageData(0, 0, img.width, img.height).data;

        let minX = img.width, maxX = 0, minY = img.height, maxY = 0;
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            if (pixels[(y * img.width + x) * 4 + 3] > 10) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        const sw = maxX - minX + 1;
        const sh = maxY - minY + 1;
        const src: Rect = { x: minX, y: minY, w: sw, h: sh };
        setSrcRect(src);

        // Auto-position: same as existing auto-frame
        let scale = TARGET_H / sh;
        if (sw * scale > CANVAS_W) scale = CANVAS_W / sw;
        const drawW = Math.round(sw * scale);
        const drawH = Math.round(sh * scale);
        const initialPos: Rect = {
          x: Math.round((CANVAS_W - drawW) / 2),
          y: FEET_LINE - drawH,
          w: drawW,
          h: drawH,
        };
        setPos(initialPos);
        posRef.current = initialPos;
        setSubjectImg(img);
        setLoading(false);
      };
      img.src = transparentUrl;
    })();
  }, [imageDataUrl]);

  // Render canvas whenever state changes
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !subjectImg) return;
    const ctx = canvas.getContext('2d')!;
    const p = posRef.current;
    const sel = selectedRef.current;

    // Green background
    ctx.fillStyle = '#1be300';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Subject
    ctx.drawImage(subjectImg, srcRect.x, srcRect.y, srcRect.w, srcRect.h, p.x, p.y, p.w, p.h);

    // Guide lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 5;
    ctx.setLineDash([24, 18]);
    ctx.beginPath();
    ctx.moveTo(0, HEAD_LINE); ctx.lineTo(CANVAS_W, HEAD_LINE);
    ctx.moveTo(0, FEET_LINE); ctx.lineTo(CANVAS_W, FEET_LINE);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Guide labels
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('HEAD', 20, HEAD_LINE - 14);
    ctx.fillText('FEET', 20, FEET_LINE + 42);

    // Selection
    if (sel) {
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 5;
      ctx.strokeRect(p.x, p.y, p.w, p.h);

      const handles = getHandles(p);
      for (const h of handles) {
        ctx.beginPath();
        ctx.arc(h.cx, h.cy, HANDLE_R, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }
  }, [subjectImg, srcRect]);

  useEffect(() => { draw(); }, [draw, pos, selected]);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / CANVAS_W;
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  };

  const hitTestHandle = (cx: number, cy: number, p: Rect): HandleId | null => {
    for (const h of getHandles(p)) {
      const dx = cx - h.cx, dy = cy - h.cy;
      if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_R * 1.6) return h.id;
    }
    return null;
  };

  const hitTestSubject = (cx: number, cy: number, p: Rect) =>
    cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h;

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    const p = posRef.current;

    if (selectedRef.current) {
      const handle = hitTestHandle(x, y, p);
      if (handle) {
        dragState.current = { mode: 'resize', handle, startMouseX: x, startMouseY: y, startPos: { ...p }, aspectRatio: p.w / p.h };
        return;
      }
    }

    if (hitTestSubject(x, y, p)) {
      setSelected(true);
      selectedRef.current = true;
      dragState.current = { mode: 'move', handle: null, startMouseX: x, startMouseY: y, startPos: { ...p }, aspectRatio: p.w / p.h };
    } else {
      setSelected(false);
      selectedRef.current = false;
      dragState.current.mode = null;
    }
    draw();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ds = dragState.current;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);

    // Update cursor
    const p = posRef.current;
    if (selectedRef.current) {
      const handle = hitTestHandle(x, y, p);
      if (handle) { setCursor('nwse-resize'); }
      else if (hitTestSubject(x, y, p)) { setCursor(ds.mode === 'move' ? 'grabbing' : 'grab'); }
      else { setCursor('default'); }
    } else if (hitTestSubject(x, y, p)) {
      setCursor('grab');
    } else {
      setCursor('default');
    }

    if (!ds.mode) return;
    const dx = x - ds.startMouseX;
    const dy = y - ds.startMouseY;

    let newPos: Rect;
    if (ds.mode === 'move') {
      newPos = { ...ds.startPos, x: ds.startPos.x + dx, y: ds.startPos.y + dy };
    } else {
      newPos = applyResize(ds.handle!, dx, dy, ds.startPos);
    }
    setPos(newPos);
    posRef.current = newPos;
    draw();
  };

  const handleMouseUp = () => {
    dragState.current.mode = null;
  };

  const handleDownload = () => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const ctx = offscreen.getContext('2d')!;
    ctx.fillStyle = '#1be300';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (subjectImg) {
      const p = posRef.current;
      ctx.drawImage(subjectImg, srcRect.x, srcRect.y, srcRect.w, srcRect.h, p.x, p.y, p.w, p.h);
    }
    const link = document.createElement('a');
    link.href = offscreen.toDataURL('image/png');
    link.download = 'resized-position.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="flex flex-col bg-white rounded-xl overflow-hidden shadow-2xl"
        style={{ width: 'min(480px, 100%)', maxHeight: '95vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="font-semibold text-gray-900">Resize & Position</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Download
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-hidden flex items-center justify-center bg-gray-200 min-h-0">
          {loading ? (
            <div className="flex items-center gap-2 py-16 text-gray-500 text-sm">
              <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Removing background...
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ height: '100%', width: 'auto', maxWidth: '100%', display: 'block', cursor }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          )}
        </div>

        {/* Footer tip */}
        <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500 text-center flex-shrink-0">
          Click character to select · Drag to move · Drag handles to resize
        </div>
      </div>
    </div>
  );
}
