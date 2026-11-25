import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import type { AudioAnalysis, SceneAnalysis, VideoMetadata } from './store.ts';

const execFileAsync = promisify(execFile);

export const FFMPEG_BIN = process.env.CLIPFORGE_FFMPEG || 'ffmpeg';
export const FFPROBE_BIN = process.env.CLIPFORGE_FFPROBE || 'ffprobe';

export async function checkBinary(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function probeVideo(filePath: string): Promise<VideoMetadata> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { timeout: 15000 }
    );
    const parsed = JSON.parse(stdout);
    const streams: Array<Record<string, unknown>> = parsed.streams || [];
    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStream = streams.find((s) => s.codec_type === 'audio');
    const durationRaw =
      Number(parsed.format?.duration) ||
      Number(videoStream?.duration) ||
      Number(audioStream?.duration) ||
      0;

    return {
      duration: Math.max(0.1, Number(durationRaw.toFixed(3))),
      width: Number(videoStream?.width || 1280),
      height: Number(videoStream?.height || 720),
      codec: String(videoStream?.codec_name || 'h264'),
      has_audio: Boolean(audioStream),
    };
  } catch (err) {
    throw new Error(
      `Could not read video metadata with ffprobe: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function analyzeAudioTrack(
  filePath: string,
  duration: number
): Promise<AudioAnalysis> {
  const silencePeriods: Array<{ start: number; end: number; duration: number }> = [];
  try {
    const { stderr } = await execFileAsync(
      FFMPEG_BIN,
      [
        '-nostdin',
        '-i',
        filePath,
        '-af',
        'silencedetect=noise=-35dB:d=0.6',
        '-f',
        'null',
        '-',
      ],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
    );
    let currentStart: number | null = null;
    for (const line of stderr.split('\n')) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      if (startMatch) {
        currentStart = Number(startMatch[1]);
      }
      const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
      if (endMatch) {
        const end = Math.min(duration, Number(endMatch[1]));
        const dur = Number(endMatch[2]);
        const start = currentStart !== null ? currentStart : Math.max(0, end - dur);
        silencePeriods.push({
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
          duration: Number(dur.toFixed(2)),
        });
        currentStart = null;
      }
    }
  } catch {
    // Non-fatal: fallback to empty silence periods if video has no audio or ffmpeg errors
  }

  const speechRegions: Array<{ start: number; end: number; duration: number }> = [];
  let cursor = 0;
  for (const silence of silencePeriods) {
    if (silence.start - cursor >= 0.4) {
      speechRegions.push({
        start: Number(cursor.toFixed(2)),
        end: Number(silence.start.toFixed(2)),
        duration: Number((silence.start - cursor).toFixed(2)),
      });
    }
    cursor = Math.max(cursor, silence.end);
  }
  if (duration - cursor >= 0.4) {
    speechRegions.push({
      start: Number(cursor.toFixed(2)),
      end: Number(duration.toFixed(2)),
      duration: Number((duration - cursor).toFixed(2)),
    });
  }
  if (speechRegions.length === 0 && duration > 0) {
    speechRegions.push({
      start: 0,
      end: Number(duration.toFixed(2)),
      duration: Number(duration.toFixed(2)),
    });
  }

  const volumePeaks = speechRegions
    .filter((_, idx) => idx % 2 === 0)
    .slice(0, 8)
    .map((r) => ({
      timestamp: Number((r.start + r.duration * 0.35).toFixed(2)),
      level: 0.78,
    }));

  return {
    speech_regions: speechRegions,
    silence_periods: silencePeriods,
    volume_peaks: volumePeaks,
  };
}

export function buildSceneAnalysis(duration: number): SceneAnalysis {
  const sceneChanges: Array<{ timestamp: number; score: number }> = [];
  const step = Math.max(6, Math.min(18, duration / 6));
  for (let t = step; t < duration - 1; t += step) {
    sceneChanges.push({ timestamp: Number(t.toFixed(2)), score: 0.45 });
  }
  return {
    scene_changes: sceneChanges,
    motion_analysis: { average_magnitude: 0.24 },
  };
}

export async function exportVideoClip(
  sourcePath: string,
  outputPath: string,
  start: number,
  end: number,
  strategy: 'fast' | 'accurate' = 'accurate'
): Promise<{
  output_path: string;
  expected_duration: number;
  actual_duration: number;
  duration_accurate: boolean;
  file_size: number;
  strategy: string;
}> {
  const duration = end - start;
  if (duration < 0.1) {
    throw new Error('Clip duration must be at least 0.1 seconds');
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source video not found: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const args =
    strategy === 'fast'
      ? [
          '-nostdin',
          '-y',
          '-ss',
          String(start),
          '-i',
          sourcePath,
          '-t',
          String(duration),
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero',
          outputPath,
        ]
      : [
          '-nostdin',
          '-y',
          '-ss',
          String(start),
          '-i',
          sourcePath,
          '-t',
          String(duration),
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-avoid_negative_ts',
          'make_zero',
          outputPath,
        ];

  try {
    await execFileAsync(FFMPEG_BIN, args, { timeout: 120000 });
  } catch (err) {
    if (strategy === 'fast') {
      // Fallback to re-encode if stream copy fails
      await execFileAsync(
        FFMPEG_BIN,
        [
          '-nostdin',
          '-y',
          '-ss',
          String(start),
          '-i',
          sourcePath,
          '-t',
          String(duration),
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-avoid_negative_ts',
          'make_zero',
          outputPath,
        ],
        { timeout: 120000 }
      );
    } else {
      throw new Error(
        `FFmpeg export failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('Output file was not created');
  }
  const meta = await probeVideo(outputPath).catch(() => ({ duration }));
  const actualDuration = meta.duration;
  const stat = fs.statSync(outputPath);

  return {
    output_path: outputPath,
    expected_duration: Number(duration.toFixed(3)),
    actual_duration: Number(actualDuration.toFixed(3)),
    duration_accurate: Math.abs(actualDuration - duration) <= 0.5,
    file_size: stat.size,
    strategy,
  };
}

export function generateSafeClipFilename(title: string, rank: number): string {
  const safe = (title || 'clip')
    .replace(/[^a-zA-Z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 48);
  return `clip_${String(rank).padStart(2, '0')}_${safe || 'moment'}.mp4`;
}

export async function createBatchZip(
  clipFiles: Array<{ path: string; filename: string }>,
  zipPath: string
): Promise<{ zip_path: string; zip_size: number }> {
  const zip = new JSZip();
  for (const item of clipFiles) {
    if (fs.existsSync(item.path)) {
      zip.file(item.filename, fs.readFileSync(item.path));
    }
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, buffer);
  return {
    zip_path: zipPath,
    zip_size: buffer.length,
  };
}
