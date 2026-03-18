'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { removeGreenBackground, extractStillFrame } from '@/lib/positionGenerator';
import { useExerciseTemplates } from '@/hooks/useExerciseTemplates';
import { usePositions } from '@/hooks/usePositions';
import type { ExerciseTemplate } from '@/types';

const CANVAS_W = 1620;
const CANVAS_H = 2880;
const HEAD_LINE = 619;
const FEET_LINE = 2724;
const TARGET_H = FEET_LINE - HEAD_LINE;
const HANDLE_R = 28;

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

// ─── AssignCard ────────────────────────────────────────────────────────────────

function AssignCard({ template, disabled, onAssign }: {
  template: ExerciseTemplate; disabled: boolean; onAssign: () => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || !template.inputVideoUrl) return;
    loaded.current = true;
    extractStillFrame(template.inputVideoUrl).then(setThumb).catch(() => {});
  }, [template.inputVideoUrl]);

  return (
    <button
      onClick={onAssign}
      disabled={disabled}
      title={template.exerciseName || 'Exercise'}
      className="overflow-hidden rounded-lg border-2 border-gray-200 text-left transition-all hover:border-blue-400 hover:shadow-sm disabled:opacity-50"
    >
      {thumb ? (
        <img src={thumb} alt={template.exerciseName || ''} className="aspect-[3/4] w-full object-cover" />
      ) : (
        <div className="flex aspect-[3/4] w-full items-center justify-center bg-gray-100">
          {template.inputVideoUrl ? (
            <svg className="h-4 w-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <span className="text-xs text-gray-400">No video</span>
          )}
        </div>
      )}
      <div className="p-1.5">
        <p className="truncate text-xs font-medium text-gray-900">{template.exerciseName || 'Exercise'}</p>
        {template.equipmentType && <p className="truncate text-xs text-gray-500">{template.equipmentType}</p>}
      </div>
    </button>
  );
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
  const { x, y, w, h } = sp;
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

export default function CanvaEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subjectImg, setSubjectImg] = useState<HTMLImageElement | null>(null);
  const [srcRect, setSrcRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [pos, setPos] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [selected, setSelected] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [cursor, setCursor] = useState('default');
  const [flipped, setFlipped] = useState(false);
  const [extending, setExtending] = useState(false);
  const [showExtendMenu, setShowExtendMenu] = useState(false);
  const flippedRef = useRef(false);

  // Assign-to-exercise state
  const [showAssign, setShowAssign] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignEquipFilter, setAssignEquipFilter] = useState('All');
  const [assigning, setAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState('');
  const [assignError, setAssignError] = useState('');

  const { templates, updateTemplate } = useExerciseTemplates();
  const { createPosition } = usePositions();

  // Exercises that don't yet have a position image
  const eligibleTemplates = templates.filter((t) => !t.positionId);
  const assignEquipOptions = Array.from(new Set(eligibleTemplates.map((t) => t.equipmentType).filter(Boolean))).sort() as string[];
  const filteredTemplates = eligibleTemplates.filter((t) => {
    const matchesEquip = assignEquipFilter === 'All' || t.equipmentType === assignEquipFilter;
    const matchesSearch = !assignSearch.trim() ||
      (t.exerciseName || '').toLowerCase().includes(assignSearch.trim().toLowerCase()) ||
      (t.equipmentType || '').toLowerCase().includes(assignSearch.trim().toLowerCase());
    return matchesEquip && matchesSearch;
  });

  const posRef = useRef(pos);
  posRef.current = pos;
  flippedRef.current = flipped;
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

  const handleFile = async (file: File) => {
    setProcessing(true);
    const raw = await new Promise<string>((res) => {
      const reader = new FileReader();
      reader.onload = (e) => res(e.target!.result as string);
      reader.readAsDataURL(file);
    });
    const transparentUrl = await removeGreenBackground(raw);
    const img = new Image();
    img.onload = () => {
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
      setProcessing(false);
    };
    img.src = transparentUrl;
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !subjectImg) return;
    const ctx = canvas.getContext('2d')!;
    const p = posRef.current;

    ctx.fillStyle = '#1be300';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (flippedRef.current) {
      ctx.save();
      ctx.translate(p.x + p.w, p.y);
      ctx.scale(-1, 1);
      ctx.drawImage(subjectImg, srcRect.x, srcRect.y, srcRect.w, srcRect.h, 0, 0, p.w, p.h);
      ctx.restore();
    } else {
      ctx.drawImage(subjectImg, srcRect.x, srcRect.y, srcRect.w, srcRect.h, p.x, p.y, p.w, p.h);
    }

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

    // Center vertical line
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 16]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2, 0); ctx.lineTo(CANVAS_W / 2, CANVAS_H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('HEAD', 20, HEAD_LINE - 14);
    ctx.fillText('FEET', 20, FEET_LINE + 42);
  }, [subjectImg, srcRect]);

  useEffect(() => { draw(); }, [draw, pos, selected, flipped]);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
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

  const handleMouseDown = (clientX: number, clientY: number) => {
    const { x, y } = toCanvasCoords(clientX, clientY);
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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const ds = dragState.current;
      const { x, y } = toCanvasCoords(e.clientX, e.clientY);
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
      const newPos: Rect = ds.mode === 'move'
        ? { ...ds.startPos, x: ds.startPos.x + dx, y: ds.startPos.y + dy }
        : applyResize(ds.handle!, dx, dy, ds.startPos);
      setPos(newPos);
      posRef.current = newPos;
      draw();
    };
    const onUp = () => { dragState.current.mode = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draw]);

  const renderOffscreen = (): HTMLCanvasElement => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const ctx = offscreen.getContext('2d')!;
    ctx.fillStyle = '#1be300';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (subjectImg) {
      const p = posRef.current;
      if (flippedRef.current) {
        ctx.save();
        ctx.translate(p.x + p.w, p.y);
        ctx.scale(-1, 1);
        ctx.drawImage(subjectImg, srcRect.x, srcRect.y, srcRect.w, srcRect.h, 0, 0, p.w, p.h);
        ctx.restore();
      } else {
        ctx.drawImage(subjectImg, srcRect.x, srcRect.y, srcRect.w, srcRect.h, p.x, p.y, p.w, p.h);
      }
    }
    return offscreen;
  };

  const handleDownload = () => {
    const offscreen = renderOffscreen();
    const link = document.createElement('a');
    link.href = offscreen.toDataURL('image/png');
    link.download = 'position-image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setSubjectImg(null);
    setSelected(false);
  };

  const handleAssign = async (template: ExerciseTemplate) => {
    setAssigning(true);
    setAssignError('');
    try {
      const offscreen = renderOffscreen();
      const blob = await new Promise<Blob>((res, rej) =>
        offscreen.toBlob((b) => b ? res(b) : rej(new Error('Canvas export failed')), 'image/png')
      );
      const file = new File([blob], `${template.exerciseName || 'position'}.png`, { type: 'image/png' });
      const position = await createPosition(
        template.exerciseName || 'Position',
        template.equipmentType || '',
        file
      );
      await updateTemplate(template.id, { positionId: position.id, positionName: position.name });
      setAssignSuccess(template.exerciseName || 'Exercise');
      setShowAssign(false);
      setAssignSearch('');
      setTimeout(() => {
        setSubjectImg(null);
        setSelected(false);
        setAssignSuccess('');
      }, 2000);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setAssigning(false);
    }
  };

  const handleClear = () => {
    setSubjectImg(null);
    setSelected(false);
    setFlipped(false);
    setShowAssign(false);
    setAssignSuccess('');
    setAssignError('');
  };

  const handleExtend = async (direction: 'all' | 'top' | 'bottom' | 'left' | 'right') => {
    if (!subjectImg || extending) return;
    setExtending(true);
    setShowExtendMenu(false);

    const prompts: Record<string, string> = {
      all: 'Extend any equipment, cables, bars, or objects that are cut off so they reach the edges of the image. Keep the character and pose exactly the same. Maintain the green background.',
      top: 'Extend any equipment, cables, bars, or objects that are cut off at the TOP of the image so they reach the top edge. Do NOT extend anything at the bottom, left, or right edges. Keep the character and pose exactly the same. Maintain the green background.',
      bottom: 'Extend any equipment, cables, bars, or objects that are cut off at the BOTTOM of the image so they reach the bottom edge. Do NOT extend anything at the top, left, or right edges. Keep the character and pose exactly the same. Maintain the green background.',
      left: 'Extend any equipment, cables, bars, or objects that are cut off at the LEFT side of the image so they reach the left edge. Do NOT extend anything at the top, bottom, or right edges. Keep the character and pose exactly the same. Maintain the green background.',
      right: 'Extend any equipment, cables, bars, or objects that are cut off at the RIGHT side of the image so they reach the right edge. Do NOT extend anything at the top, bottom, or left edges. Keep the character and pose exactly the same. Maintain the green background.',
    };

    try {
      const offscreen = renderOffscreen();
      const canvasDataUrl = offscreen.toDataURL('image/jpeg', 0.85);
      const res = await fetch('/api/image-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: [canvasDataUrl],
          prompt: prompts[direction],
          outputCount: 1,
          aspectRatio: '9:16',
        }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 200) || 'Server error'); }
      if (!res.ok || !data.images?.length) {
        throw new Error(data.error || 'Failed to extend image');
      }
      const img = new Image();
      img.onload = () => {
        setSubjectImg(img);
        setSrcRect({ x: 0, y: 0, w: img.width, h: img.height });
        setPos({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
        posRef.current = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
        setFlipped(false);
        setSelected(false);
        setExtending(false);
      };
      img.onerror = () => {
        alert('Failed to load the extended image.');
        setExtending(false);
      };
      img.src = data.images[0];
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to extend');
      setExtending(false);
    }
  };

  // Empty state
  if (!subjectImg && !processing) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file && file.type.startsWith('image/')) handleFile(file);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-20 transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
      >
        <svg className="mb-3 h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="mb-3 text-sm text-gray-500">Drag & drop an image here, or</p>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Upload Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        <p className="mt-3 text-xs text-gray-400">Background will be removed automatically</p>
      </div>
    );
  }

  // Processing spinner
  if (processing) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-gray-50 py-20">
        <svg className="mb-3 h-8 w-8 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <p className="text-sm text-gray-500">Removing background...</p>
      </div>
    );
  }

  // Canvas editor
  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Click to select · Drag to move · Drag handles to resize</p>
        <div className="flex gap-2">
          <button
            onClick={handleClear}
            className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Clear
          </button>
          <button
            onClick={() => setFlipped((v) => !v)}
            title="Flip horizontally"
            className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${flipped ? 'border-purple-500 bg-purple-500 text-white hover:bg-purple-600' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            ⇄ Flip
          </button>
          <div className="relative">
            <button
              onClick={() => setShowExtendMenu((v) => !v)}
              disabled={extending || !subjectImg}
              className="rounded-lg border border-orange-500 bg-white px-4 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-50"
            >
              {extending ? (
                <span className="flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Extending...
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  Extend Edges
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 20 20"><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 8l4 4 4-4" /></svg>
                </span>
              )}
            </button>
            {showExtendMenu && !extending && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExtendMenu(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <button onClick={() => handleExtend('all')} className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600">All Edges</button>
                  <button onClick={() => handleExtend('top')} className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600">Extend to Top</button>
                  <button onClick={() => handleExtend('bottom')} className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600">Extend to Bottom</button>
                  <button onClick={() => handleExtend('left')} className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600">Extend to Left</button>
                  <button onClick={() => handleExtend('right')} className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600">Extend to Right</button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => { setShowAssign((v) => !v); setAssignError(''); setAssignEquipFilter('All'); }}
            className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${showAssign ? 'border-green-600 bg-green-600 text-white hover:bg-green-700' : 'border-green-600 bg-white text-green-700 hover:bg-green-50'}`}
          >
            Assign to Exercise
          </button>
          <button
            onClick={handleDownload}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Download
          </button>
        </div>
      </div>

      {/* Success banner */}
      {assignSuccess && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-800 border border-green-200">
          <svg className="h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Position image assigned to <strong className="ml-1">{assignSuccess}</strong>
        </div>
      )}

      {/* Assign panel */}
      {showAssign && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="relative flex-1">
              <svg className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                placeholder="Search exercises..."
                className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none"
                autoFocus
              />
            </div>
            {assignEquipOptions.length > 0 && (
              <select
                value={assignEquipFilter}
                onChange={(e) => setAssignEquipFilter(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="All">All Equipment</option>
                {assignEquipOptions.map((eq) => (
                  <option key={eq} value={eq}>{eq}</option>
                ))}
              </select>
            )}
            <button onClick={() => setShowAssign(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {assignError && (
            <p className="px-4 py-2 text-sm text-red-600">{assignError}</p>
          )}

          <div className="max-h-80 overflow-y-auto p-3">
            {eligibleTemplates.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">All exercises already have position images.</p>
            ) : filteredTemplates.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">No exercises match your search.</p>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {filteredTemplates.map((t) => (
                  <AssignCard
                    key={t.id}
                    template={t}
                    disabled={assigning}
                    onAssign={() => handleAssign(t)}
                  />
                ))}
              </div>
            )}
          </div>

          {assigning && (
            <div className="flex items-center justify-center gap-2 border-t px-4 py-3 text-sm text-gray-500">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Uploading & saving...
            </div>
          )}
        </div>
      )}

      {/* Canvas */}
      <div className="flex items-center justify-center rounded-xl bg-gray-200 py-6">
        <div className="relative" style={{ height: '70vh' }}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ height: '70vh', width: 'auto', maxWidth: '100%', display: 'block', cursor }}
            onMouseDown={(e) => handleMouseDown(e.clientX, e.clientY)}
          />
          {/* SVG overlay — overflow visible + interactive so off-canvas handles are clickable */}
          <svg
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            style={{ position: 'absolute', top: 0, left: 0, height: '70vh', width: 'auto', maxWidth: '100%', overflow: 'visible', cursor }}
            onMouseDown={(e) => handleMouseDown(e.clientX, e.clientY)}
          >
            {selected && (
              <>
                <rect x={pos.x} y={pos.y} width={pos.w} height={pos.h} fill="none" stroke="#2563eb" strokeWidth="5" />
                {getHandles(pos).map((h) => (
                  <circle key={h.id} cx={h.cx} cy={h.cy} r={HANDLE_R} fill="white" stroke="#2563eb" strokeWidth="4" />
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
