'use client';

import { useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { downloadVideo } from '@/lib/videoDownload';

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpeg.load({ coreURL: `${baseURL}/ffmpeg-core.js`, wasmURL: `${baseURL}/ffmpeg-core.wasm` });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

async function remuxToMp4(tsBlob: Blob, name: string): Promise<void> {
  const ffmpeg = await getFFmpeg();
  const inputData = await fetchFile(tsBlob);
  await ffmpeg.writeFile('input.ts', inputData);
  await ffmpeg.exec(['-i', 'input.ts', '-c', 'copy', '-movflags', '+faststart', '-y', 'output.mp4']);
  const data = await ffmpeg.readFile('output.mp4');
  await ffmpeg.deleteFile('input.ts').catch(() => {});
  await ffmpeg.deleteFile('output.mp4').catch(() => {});

  const blob = new Blob([new Uint8Array(data as Uint8Array).buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Stage = 'idle' | 'downloading' | 'converting' | 'done';

export default function ToolsPage() {
  const [url, setUrl] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');

  const handleDownload = async () => {
    if (!url.trim()) return;
    setStage('downloading');
    setError('');

    try {
      // Step 1: Fetch raw TS segments from API
      const res = await fetch(`/api/download-hls?url=${encodeURIComponent(url.trim())}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error (${res.status})`);
      }
      const tsBlob = await res.blob();

      // Extract filename hint from Content-Disposition
      const cd = res.headers.get('Content-Disposition');
      const match = cd?.match(/filename="(.+?)\.mp4"/);
      const name = match?.[1] || 'video';

      // Step 2: Remux TS → proper MP4 via ffmpeg-wasm
      setStage('converting');
      await remuxToMp4(tsBlob, name);

      setStage('done');
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
      setStage('idle');
    }
  };

  const busy = stage === 'downloading' || stage === 'converting';

  // Bulk URL import state
  const [bulkUrls, setBulkUrls] = useState('');
  const [bulkRunning, setBulkRunning] = useState(false);
  type BulkStatus = 'pending' | 'downloading' | 'uploading' | 'done' | 'error';
  interface BulkItem { url: string; status: BulkStatus; storageUrl?: string; error?: string; }
  const [bulkResults, setBulkResults] = useState<BulkItem[]>([]);

  const handleBulkImport = async () => {
    const urls = bulkUrls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
    if (urls.length === 0) return;
    setBulkRunning(true);
    const results: BulkItem[] = urls.map(u => ({ url: u, status: 'pending' }));
    setBulkResults([...results]);

    for (let i = 0; i < results.length; i++) {
      results[i] = { ...results[i], status: 'downloading' };
      setBulkResults([...results]);
      try {
        // Try client-side fetch first (browser passes Cloudflare)
        let blob: Blob;
        try {
          const res = await fetch(results[i].url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          blob = await res.blob();
          if (blob.size < 1000) throw new Error('Too small');
        } catch {
          // Fallback to server proxy
          const proxyRes = await fetch(`/api/download-proxy?url=${encodeURIComponent(results[i].url)}&filename=video.mp4`);
          if (!proxyRes.ok) {
            let errMsg: string;
            try { const d = await proxyRes.json(); errMsg = d.error || `HTTP ${proxyRes.status}`; } catch { errMsg = `HTTP ${proxyRes.status}`; }
            throw new Error(errMsg);
          }
          blob = await proxyRes.blob();
          if (blob.size < 1000) throw new Error('Downloaded file too small');
        }

        // Upload to Supabase
        results[i] = { ...results[i], status: 'uploading' };
        setBulkResults([...results]);
        const { uploadVideoBlob } = await import('@/lib/videoDownload');
        const storageUrl = await uploadVideoBlob(blob, 'imported-video.mp4');
        results[i] = { ...results[i], status: 'done', storageUrl };
      } catch (err) {
        results[i] = { ...results[i], status: 'error', error: err instanceof Error ? err.message : 'Failed' };
      }
      setBulkResults([...results]);
    }
    setBulkRunning(false);
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-12 space-y-12">

      {/* Bulk URL Import */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Bulk Video Import</h1>
        <p className="text-sm text-gray-500 mb-4">
          Paste video URLs (one per line). Downloads via browser first, falls back to server proxy. Uploads each to Supabase Storage.
        </p>
        <div className="space-y-3">
          <textarea
            value={bulkUrls}
            onChange={e => setBulkUrls(e.target.value)}
            placeholder={"https://app-media-r2.fitbod.me/v2/565/videos/full_1080p.mp4\nhttps://app-media-r2.fitbod.me/v2/566/videos/full_1080p.mp4"}
            rows={5}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            disabled={bulkRunning}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {bulkUrls.split('\n').filter(u => u.trim().startsWith('http')).length} URLs
            </span>
            <button
              onClick={handleBulkImport}
              disabled={bulkRunning || bulkUrls.split('\n').filter(u => u.trim().startsWith('http')).length === 0}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
            >
              {bulkRunning ? <><Spinner /> Importing...</> : 'Import All'}
            </button>
          </div>
          {bulkResults.length > 0 && (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              <div className="flex gap-3 text-xs text-gray-500 font-medium px-1">
                <span>{bulkResults.filter(r => r.status === 'done').length} done</span>
                <span>{bulkResults.filter(r => r.status === 'error').length} failed</span>
                <span>{bulkResults.filter(r => !['done', 'error'].includes(r.status)).length} remaining</span>
              </div>
              {bulkResults.map((r, i) => (
                <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                  r.status === 'done' ? 'bg-green-50 text-green-700' :
                  r.status === 'error' ? 'bg-red-50 text-red-700' :
                  r.status === 'pending' ? 'bg-gray-50 text-gray-500' :
                  'bg-blue-50 text-blue-700'
                }`}>
                  {r.status === 'downloading' || r.status === 'uploading' ? (
                    <Spinner />
                  ) : r.status === 'done' ? (
                    <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : r.status === 'error' ? (
                    <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <div className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate flex-1 font-mono">{r.url.split('/').slice(-3).join('/')}</span>
                  <span className="flex-shrink-0 capitalize">
                    {r.status === 'downloading' ? 'Downloading...' :
                     r.status === 'uploading' ? 'Uploading...' :
                     r.status === 'error' ? r.error :
                     r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* HLS Downloader */}
      <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">HLS Downloader</h1>
      <p className="text-sm text-gray-500 mb-8">
        Paste a <code className="bg-gray-100 px-1 rounded">.m3u8</code> stream URL to download it as a playable MP4.
      </p>

      <div className="space-y-3">
        <input
          type="url"
          value={url}
          onChange={e => { setUrl(e.target.value); setStage('idle'); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && !busy && handleDownload()}
          placeholder="https://cdn.example.com/video/playlist.m3u8"
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={busy}
        />

        <button
          onClick={handleDownload}
          disabled={!url.trim() || busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
        >
          {stage === 'downloading' ? (
            <><Spinner /> Downloading segments...</>
          ) : stage === 'converting' ? (
            <><Spinner /> Converting to MP4...</>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </>
          )}
        </button>

        {stage === 'done' && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Saved to your Downloads folder
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <svg className="h-4 w-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
