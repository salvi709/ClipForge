import type { TranscriptData, TranscriptSegment } from './store.ts';
import { sentenceUnits } from './sentences.ts';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function validateYouTubeUrl(url: string): {
  valid: boolean;
  videoId?: string;
  error?: string;
} {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }
  const trimmed = url.trim();
  if (trimmed.length > 500) {
    return { valid: false, error: 'URL is too long' };
  }
  if (!trimmed.startsWith('https://')) {
    return {
      valid: false,
      error: 'URL must use HTTPS (e.g., https://youtube.com/...)',
    };
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('youtube.com') && !host.includes('youtu.be')) {
      return { valid: false, error: 'Not a YouTube URL' };
    }
    let videoId: string | null = null;
    if (host.includes('youtube.com') && (parsed.pathname === '/watch' || parsed.pathname === '/watch/')) {
      videoId = parsed.searchParams.get('v');
    } else if (host.includes('youtu.be')) {
      videoId = parsed.pathname.replace(/^\/+/, '').split('/')[0] || null;
    } else if (parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.split('/shorts/')[1]?.split('/')[0] || null;
    } else if (parsed.pathname.startsWith('/live/')) {
      videoId = parsed.pathname.split('/live/')[1]?.split('/')[0] || null;
    } else if (parsed.pathname.startsWith('/embed/')) {
      videoId = parsed.pathname.split('/embed/')[1]?.split('/')[0] || null;
    }

    if (!videoId || !VIDEO_ID_RE.test(videoId)) {
      return {
        valid: false,
        error:
          'Could not extract video ID. Supported formats: youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/...',
      };
    }
    return { valid: true, videoId };
  } catch {
    return { valid: false, error: 'Invalid YouTube URL' };
  }
}

export async function fetchYouTubeMetadata(videoId: string) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      title: String(data.title || `YouTube Video ${videoId}`),
      channel_name: String(data.author_name || 'YouTube Channel'),
      thumbnail_url: data.thumbnail_url ? String(data.thumbnail_url) : undefined,
      duration: 0,
      width: Number(data.width || 1280),
      height: Number(data.height || 720),
      codec: 'youtube',
    };
  } catch {
    return null;
  }
}

export function parseSrtTranscript(content: string) {
  const segments: Array<{ text: string; start: number; duration: number }> = [];
  const blocks = content.trim().split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 3) continue;
    const match = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!match) continue;
    const start =
      Number(match[1]) * 3600 +
      Number(match[2]) * 60 +
      Number(match[3]) +
      Number(match[4]) / 1000;
    const end =
      Number(match[5]) * 3600 +
      Number(match[6]) * 60 +
      Number(match[7]) +
      Number(match[8]) / 1000;
    const text = lines.slice(2).join(' ').trim();
    if (text && end > start) {
      segments.push({
        text,
        start: Number(start.toFixed(3)),
        duration: Number((end - start).toFixed(3)),
      });
    }
  }
  return segments;
}

export function parseVttTranscript(content: string) {
  const segments: Array<{ text: string; start: number; duration: number }> = [];
  const cleaned = content.replace(/^WEBVTT[^\n]*\n?/i, '').trim();
  const blocks = cleaned.split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;
    const match = lines[tsIdx].match(
      /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/
    );
    if (!match) continue;
    const start =
      Number(match[1]) * 3600 +
      Number(match[2]) * 60 +
      Number(match[3]) +
      Number(match[4]) / 1000;
    const end =
      Number(match[5]) * 3600 +
      Number(match[6]) * 60 +
      Number(match[7]) +
      Number(match[8]) / 1000;
    const text = lines.slice(tsIdx + 1).join(' ').trim();
    if (text && end > start) {
      segments.push({
        text,
        start: Number(start.toFixed(3)),
        duration: Number((end - start).toFixed(3)),
      });
    }
  }
  return segments;
}

export function parseManualTranscript(
  content: string,
  format: 'srt' | 'vtt' | 'plain'
): TranscriptData | null {
  let rawSegments: Array<{ text: string; start: number; duration: number }> = [];
  if (format === 'srt') {
    rawSegments = parseSrtTranscript(content);
  } else if (format === 'vtt') {
    rawSegments = parseVttTranscript(content);
  } else if (format === 'plain') {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let cursor = 0;
    for (const line of lines) {
      const dur = Math.max(3, line.split(/\s+/).length * 0.4);
      rawSegments.push({
        text: line,
        start: Number(cursor.toFixed(3)),
        duration: Number(dur.toFixed(3)),
      });
      cursor += dur;
    }
  }

  if (rawSegments.length === 0) return null;

  const segments: TranscriptSegment[] = rawSegments.map((s, idx) => ({
    id: idx,
    start: s.start,
    end: Number((s.start + s.duration).toFixed(3)),
    text: s.text,
    words: [],
  }));

  const maxEnd = segments[segments.length - 1].end;
  const transcript: TranscriptData = {
    language: 'en',
    language_probability: 0.95,
    device: 'youtube',
    segments,
    transcript_source: 'user_provided',
    is_generated: false,
  };
  transcript.sentences = sentenceUnits(transcript, maxEnd);
  return transcript;
}

export function buildYouTubePlaybackUrl(videoId: string, startSeconds?: number): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  if (startSeconds && startSeconds > 0) {
    return `${base}&t=${Math.floor(startSeconds)}s`;
  }
  return base;
}

export function buildYouTubeEmbedUrl(videoId: string, startSeconds?: number): string {
  const base = `https://www.youtube.com/embed/${videoId}`;
  if (startSeconds && startSeconds > 0) {
    return `${base}?start=${Math.floor(startSeconds)}`;
  }
  return base;
}
