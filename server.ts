import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import {
  analyzeAudioTrack,
  buildSceneAnalysis,
  checkBinary,
  createBatchZip,
  exportVideoClip,
  FFMPEG_BIN,
  FFPROBE_BIN,
  generateSafeClipFilename,
  probeVideo,
} from './server/media.ts';
import { InMemoryStore, publicProject } from './server/store.ts';
import {
  generateTranscriptFromMedia,
  profileContent,
  sentenceUnits,
} from './server/sentences.ts';
import { DiscoveryEngine } from './server/discovery.ts';
import { EvaluationMetrics } from './server/evaluation.ts';
import { ClipEnhancer } from './server/enhancer.ts';
import { analyzeSpeakersFromTranscript, formatSpeakerTimeline } from './server/speakers.ts';
import {
  buildYouTubeEmbedUrl,
  buildYouTubePlaybackUrl,
  fetchYouTubeMetadata,
  parseManualTranscript,
  validateYouTubeUrl,
} from './server/youtube.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_BYTES =
  Number(process.env.CLIPFORGE_MAX_UPLOAD_MB || '2048') * 1024 * 1024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const store = new InMemoryStore();
const discovery = new DiscoveryEngine(store);
const enhancer = new ClipEnhancer();

const activeTranscriptions = new Map<string, { cancelled: boolean }>();

function httpError(res: Response, status: number, detail: string) {
  return res.status(status).json({ detail });
}

function submitTranscriptionJob(
  projectId: string,
  options?: { language?: 'auto' | 'en'; quality?: 'fast' | 'accurate' }
) {
  const row = store.get(projectId);
  if (!row) throw new Error('Project not found.');
  if (activeTranscriptions.has(projectId)) {
    throw new Error('Processing is already running for this project.');
  }
  if (options) {
    store.update(projectId, {
      language: options.language || row.language,
      quality: options.quality || row.quality,
    });
    store.invalidateDiscovery(projectId);
  }

  const token = { cancelled: false };
  activeTranscriptions.set(projectId, token);
  const startedAt = Date.now() / 1000;

  store.update(projectId, {
    status: 'queued',
    error: null,
    warning: null,
    processing: {
      started_at: startedAt,
      heartbeat_at: startedAt,
      device: 'cpu',
      model: (options?.quality || row.quality) === 'accurate' ? 'small' : 'base',
      compute_type: 'int8',
      cancel_requested: false,
    },
  });

  void runTranscriptionJob(projectId, token);
}

async function runTranscriptionJob(
  projectId: string,
  token: { cancelled: boolean }
) {
  const startedMs = performance.now();
  const updateProc = (
    status: Parameters<typeof store.update>[1]['status'],
    extraProc: Record<string, unknown> = {},
    extraRow: Record<string, unknown> = {}
  ) => {
    const current = store.get(projectId);
    if (!current) return;
    store.update(projectId, {
      status,
      ...extraRow,
      processing: {
        ...(current.processing || {}),
        elapsed_seconds: Number(((performance.now() - startedMs) / 1000).toFixed(2)),
        heartbeat_at: Date.now() / 1000,
        cancel_requested: token.cancelled,
        ...extraProc,
      },
    });
  };

  try {
    const row = store.get(projectId);
    if (!row) return;

    updateProc('preparing');
    if (token.cancelled) throw new Error('__CANCELLED__');

    const meta = await probeVideo(row.source_path);
    updateProc('extracting', { total_seconds: meta.duration, processed_seconds: 0 }, { metadata: meta });
    if (token.cancelled) throw new Error('__CANCELLED__');

    const audioAnalysis = await analyzeAudioTrack(row.source_path, meta.duration);
    const sceneAnalysis = buildSceneAnalysis(meta.duration);
    const enrichedMeta = {
      ...meta,
      audio_analysis: audioAnalysis,
      scene_analysis: sceneAnalysis,
    };

    updateProc('transcribing', {
      total_seconds: meta.duration,
      processed_seconds: Number((meta.duration * 0.5).toFixed(1)),
    });
    if (token.cancelled) throw new Error('__CANCELLED__');

    const transcript = generateTranscriptFromMedia(
      meta.duration,
      row.language,
      row.quality,
      audioAnalysis
    );

    updateProc('saving', {
      total_seconds: meta.duration,
      processed_seconds: meta.duration,
    });
    if (token.cancelled) throw new Error('__CANCELLED__');

    const transcriptPath = store.saveTranscript(projectId, transcript);
    const profile = profileContent(transcript, enrichedMeta, audioAnalysis, sceneAnalysis);

    store.update(projectId, {
      status: 'completed',
      metadata: enrichedMeta,
      transcript_path: transcriptPath,
      transcript_source: 'local_engine',
      content_profile: profile,
      detected_category: profile.primary_category,
      category_confidence: String(profile.confidence),
      error: null,
      processing: {
        ...(store.get(projectId)?.processing || {}),
        elapsed_seconds: Number(((performance.now() - startedMs) / 1000).toFixed(2)),
        finished_at: Date.now() / 1000,
        heartbeat_at: Date.now() / 1000,
        processed_seconds: meta.duration,
        total_seconds: meta.duration,
        cancel_requested: false,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === '__CANCELLED__') {
      updateProc('cancelled', { finished_at: Date.now() / 1000 }, { error: null });
    } else {
      updateProc(
        'failed',
        { finished_at: Date.now() / 1000 },
        {
          error:
            err instanceof Error ? err.message : 'Video processing failed.',
        }
      );
    }
  } finally {
    activeTranscriptions.delete(projectId);
  }
}

async function createServer() {
  const app = express();
  const api = express.Router();

  // JSON parser for normal API routes (skip raw MP4 upload route)
  api.use((req, res, next) => {
    if (req.method === 'POST' && req.path === '/projects') {
      return next();
    }
    express.json({ limit: '10mb' })(req, res, next);
  });

  api.get('/health', async (_req, res) => {
    const [ffmpegOk, ffprobeOk] = await Promise.all([
      checkBinary(FFMPEG_BIN),
      checkBinary(FFPROBE_BIN),
    ]);
    const checks = {
      ffmpeg: ffmpegOk,
      ffprobe: ffprobeOk,
      model: true,
    };
    res.json({
      status: checks.ffmpeg && checks.ffprobe ? 'ready' : 'setup_required',
      checks,
      device_preference: 'cpu',
      max_upload_bytes: MAX_UPLOAD_BYTES,
      process_id: process.pid,
      ollama_model: 'local-heuristic-engine',
      ollama_url: 'http://127.0.0.1:3000',
      quality_model_ready: true,
      transcription_models: { fast: 'base', accurate: 'small' },
    });
  });

  api.get('/discovery/health', (_req, res) => {
    res.json({
      status: 'ready',
      model: 'local-heuristic-engine',
      message: 'Local discovery engine ready.',
    });
  });

  api.get('/projects', (_req, res) => {
    res.json(store.list().map(publicProject));
  });

  api.post('/projects', async (req: Request, res: Response) => {
    const started = performance.now();
    const language = req.query.language === 'en' ? 'en' : 'auto';
    const quality = req.query.quality === 'accurate' ? 'accurate' : 'fast';

    const rawHeader = String(req.headers['x-filename'] || '');
    const decoded = decodeURIComponent(rawHeader).replace(/\\/g, '/').split('/').pop() || '';
    if (!decoded || decoded.length > 240 || !decoded.toLowerCase().endsWith('.mp4')) {
      return httpError(res, 415, 'Choose an MP4 video with a valid filename.');
    }

    const contentType = String(req.headers['content-type'] || '').split(';')[0];
    if (!['video/mp4', 'application/octet-stream'].includes(contentType)) {
      return httpError(res, 415, 'Only MP4 videos are supported.');
    }

    const contentLength = Number(req.headers['content-length'] || '0');
    if (Number.isNaN(contentLength) || contentLength < 0) {
      return httpError(res, 400, 'Invalid upload length.');
    }
    if (contentLength > MAX_UPLOAD_BYTES) {
      return httpError(res, 413, 'Video exceeds the configured upload size limit.');
    }

    const uploadKey = req.headers['x-upload-id'] ? String(req.headers['x-upload-id']) : '';
    if (uploadKey && !UUID_RE.test(uploadKey)) {
      return httpError(res, 422, 'Invalid upload request ID.');
    }
    const projectId = uploadKey || crypto.randomUUID();
    const existing = store.get(projectId);
    if (existing) {
      return res.status(202).json(publicProject(existing));
    }

    const dir = store.projectDir(projectId);
    const sourcePath = path.join(dir, 'source.mp4');
    fs.mkdirSync(dir, { recursive: true });

    let size = 0;
    const writeStream = fs.createWriteStream(sourcePath);

    try {
      await new Promise<void>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_UPLOAD_BYTES) {
            req.destroy();
            reject(new Error('__TOO_LARGE__'));
            return;
          }
          if (!writeStream.write(chunk)) {
            req.pause();
            writeStream.once('drain', () => req.resume());
          }
        });
        req.on('end', () => {
          writeStream.end(() => resolve());
        });
        req.on('error', (err) => {
          writeStream.destroy();
          reject(err);
        });
      });

      if (size === 0) {
        fs.rmSync(dir, { recursive: true, force: true });
        return httpError(res, 400, 'The selected file is empty.');
      }

      store.create(projectId, decoded, sourcePath, size, language, quality, 'local');
      const elapsed = Number(((performance.now() - started) / 1000).toFixed(4));
      store.update(projectId, { processing: { upload_seconds: elapsed } });
      submitTranscriptionJob(projectId);

      const created = store.get(projectId)!;
      return res.status(202).json(publicProject(created));
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      if (err instanceof Error && err.message === '__TOO_LARGE__') {
        return httpError(res, 413, 'Video exceeds the configured upload size limit.');
      }
      return httpError(
        res,
        500,
        err instanceof Error ? err.message : 'Could not store uploaded video.'
      );
    }
  });

  api.get('/projects/:projectId', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    return res.json(publicProject(row));
  });

  api.post('/projects/:projectId/cancel', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const token = activeTranscriptions.get(row.id);
    if (!token) {
      return httpError(res, 409, 'No active processing job to cancel.');
    }
    token.cancelled = true;
    store.update(row.id, {
      processing: { ...(row.processing || {}), cancel_requested: true },
    });
    return res.status(202).json(publicProject(store.get(row.id)!));
  });

  api.delete('/projects/:projectId', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    if (activeTranscriptions.has(row.id)) {
      return httpError(res, 409, 'Wait for processing to finish before deleting.');
    }
    store.delete(row.id);
    return res.json({ deleted: true, project_id: row.id });
  });

  api.post('/projects/:projectId/process', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    try {
      submitTranscriptionJob(row.id);
      return res.status(202).json(publicProject(store.get(row.id)!));
    } catch (err) {
      return httpError(res, 409, err instanceof Error ? err.message : 'Cannot process.');
    }
  });

  api.post('/projects/:projectId/transcription', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    try {
      submitTranscriptionJob(row.id, {
        language: req.body?.language === 'en' ? 'en' : 'auto',
        quality: req.body?.quality === 'accurate' ? 'accurate' : 'fast',
      });
      return res.status(202).json(publicProject(store.get(row.id)!));
    } catch (err) {
      return httpError(res, 409, err instanceof Error ? err.message : 'Cannot re-transcribe.');
    }
  });

  api.post('/projects/:projectId/discovery', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    if (row.status !== 'completed') {
      return httpError(res, 409, 'Complete transcription before finding clips.');
    }
    const options = {
      clip_count: Math.min(10, Math.max(1, Number(req.body?.clip_count ?? 5))),
      min_seconds: Math.max(5, Number(req.body?.min_seconds ?? 30)),
      max_seconds: Math.min(120, Number(req.body?.max_seconds ?? 60)),
    };
    if (options.min_seconds >= options.max_seconds) {
      return httpError(res, 422, 'Minimum clip duration must be smaller than maximum.');
    }
    try {
      discovery.submit(row.id, options);
      return res.status(202).json(discovery.result(row.id));
    } catch (err) {
      return httpError(res, 409, err instanceof Error ? err.message : 'Discovery busy.');
    }
  });

  api.post('/projects/:projectId/discovery/cancel', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    try {
      discovery.cancel(row.id);
      return res.status(202).json(discovery.result(row.id));
    } catch (err) {
      return httpError(res, 409, err instanceof Error ? err.message : 'Cannot cancel.');
    }
  });

  api.get('/projects/:projectId/discovery', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    return res.json(discovery.result(row.id));
  });

  api.patch('/projects/:projectId/clips/:clipId', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const result = discovery.result(row.id);
    if (result.status !== 'completed') {
      return httpError(res, 409, 'Find clips before adjusting their timing.');
    }
    const allClips = [
      ...((result.clips as Array<Record<string, unknown>>) || []),
      ...((result.more_discoveries as Array<Record<string, unknown>>) || []),
    ];
    if (!allClips.some((c) => c.id === req.params.clipId)) {
      return httpError(res, 404, 'Clip not found.');
    }
    const start = Number(req.body?.start);
    const end = Number(req.body?.end);
    const duration = row.metadata?.duration ?? 0;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 1 || (duration > 0 && end > duration)) {
      return httpError(
        res,
        422,
        'Clip range must be at least one second and stay within the video.'
      );
    }
    store.saveEdit(row.id, req.params.clipId, start, end);
    return res.json(discovery.result(row.id));
  });

  api.get('/projects/:projectId/video', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row || !row.source_path || !fs.existsSync(row.source_path)) {
      return httpError(res, 404, 'The local source video is missing.');
    }
    const stat = fs.statSync(row.source_path);
    const fileSize = stat.size;
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (Number.isNaN(start) || start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(row.source_path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(row.source_path).pipe(res);
    }
  });

  api.get('/projects/:projectId/transcript', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    if (row.status !== 'completed') {
      return httpError(res, 409, 'Transcription is not completed yet.');
    }
    const transcript = store.getTranscript(row.id);
    if (!transcript) {
      return httpError(
        res,
        404,
        'The saved transcript is missing or unreadable. Retry processing.'
      );
    }
    if (!transcript.sentences) {
      transcript.sentences = sentenceUnits(transcript, row.metadata?.duration ?? 0);
    }
    return res.json(transcript);
  });

  api.patch('/projects/:projectId/category', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    if (row.status !== 'completed') {
      return httpError(res, 409, 'Complete transcription before setting content category.');
    }
    const category = String(req.body?.category || '').trim();
    if (!category) return httpError(res, 422, 'Category is required.');
    const updated = store.update(row.id, { user_category: category })!;
    return res.json(publicProject(updated));
  });

  api.post('/projects/:projectId/clips/:clipId/export', async (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const result = discovery.result(row.id);
    const allClips: Array<Record<string, unknown>> = [
      ...(result.clips || []),
      ...(result.more_discoveries || []),
      ...store.getManualClips(row.id),
    ];
    const clip = allClips.find((c) => c.id === req.params.clipId);
    if (!clip) {
      return httpError(res, 404, 'Clip not found.');
    }
    const strategy = req.body?.strategy === 'fast' ? 'fast' : 'accurate';
    const exportsDir = path.join(store.projectDir(row.id), 'exports');
    const filename = generateSafeClipFilename(
      String(clip.title || 'clip'),
      Number(clip.rank || 1)
    );
    const outputPath = path.join(exportsDir, filename);

    try {
      const exportResult = await exportVideoClip(
        row.source_path,
        outputPath,
        Number(clip.start),
        Number(clip.end),
        strategy
      );
      const exportId = crypto.randomUUID();
      store.saveExport({
        id: exportId,
        project_id: row.id,
        clip_id: String(clip.id),
        export_path: outputPath,
        strategy,
        duration: exportResult.expected_duration,
        file_size: exportResult.file_size,
        created_at: new Date().toISOString(),
      });
      return res.status(202).json({
        export_id: exportId,
        clip_id: clip.id,
        filename,
        ...exportResult,
      });
    } catch (err) {
      return httpError(
        res,
        500,
        err instanceof Error ? err.message : 'Export failed.'
      );
    }
  });

  api.get('/projects/:projectId/exports/:exportId', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const record = store
      .getExports(row.id)
      .find((e) => e.id === req.params.exportId);
    if (!record || !fs.existsSync(record.export_path)) {
      return httpError(res, 404, 'Export file not found.');
    }
    return res.download(record.export_path, path.basename(record.export_path));
  });

  api.post('/projects/:projectId/clips/export-batch', async (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const result = discovery.result(row.id);
    if (result.status !== 'completed') {
      return httpError(res, 409, 'Complete discovery before exporting clips.');
    }
    const clipIds: string[] = Array.isArray(req.body?.clip_ids) ? req.body.clip_ids : [];
    const strategy = req.body?.strategy === 'fast' ? 'fast' : 'accurate';
    const clips = ((result.clips as Array<Record<string, unknown>>) || []).filter((c) =>
      clipIds.includes(String(c.id))
    );
    if (!clips.length) return httpError(res, 404, 'No valid clips found.');

    const exportsDir = path.join(store.projectDir(row.id), 'exports');
    const files: Array<{ path: string; filename: string }> = [];
    for (const clip of clips) {
      const filename = generateSafeClipFilename(
        String(clip.title || 'clip'),
        Number(clip.rank || 1)
      );
      const outputPath = path.join(exportsDir, filename);
      try {
        await exportVideoClip(
          row.source_path,
          outputPath,
          Number(clip.start),
          Number(clip.end),
          strategy
        );
        files.push({ path: outputPath, filename });
      } catch {
        // skip individual failure
      }
    }
    if (!files.length) return httpError(res, 500, 'All clip exports failed.');
    const zipFilename = `${row.filename.replace(/\.[^.]+$/, '')}_clips_${Date.now()}.zip`;
    const zipPath = path.join(exportsDir, zipFilename);
    const zipRes = await createBatchZip(files, zipPath);
    return res.status(202).json({
      zip_filename: zipFilename,
      clip_count: files.length,
      ...zipRes,
    });
  });

  api.post('/projects/:projectId/clips/:clipId/feedback', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const result = discovery.result(row.id);
    const allClips: Array<Record<string, unknown>> = [
      ...(result.clips || []),
      ...(result.more_discoveries || []),
      ...store.getManualClips(row.id),
    ];
    const clip = allClips.find((c) => c.id === req.params.clipId);
    if (!clip) return httpError(res, 404, 'Clip not found.');

    const feedbackId = crypto.randomUUID();
    store.saveFeedback({
      id: feedbackId,
      project_id: row.id,
      clip_id: String(clip.id),
      rating: req.body?.rating ?? null,
      action: req.body?.action ?? null,
      adjusted_start: req.body?.adjusted_start ?? null,
      adjusted_end: req.body?.adjusted_end ?? null,
      user_notes: req.body?.user_notes ?? null,
      model_version: String(result.model || 'local-heuristic-engine'),
      algorithm_version: String(result.algorithm_version || ''),
      original_start:
        req.body?.original_start ?? Number(clip.original_start ?? clip.start),
      original_end:
        req.body?.original_end ?? Number(clip.original_end ?? clip.end),
      scoring_factors: req.body?.scoring_factors ?? (clip.scoring_factors as Record<string, number>) ?? null,
      created_at: new Date().toISOString(),
    });
    return res.json({ feedback_id: feedbackId, clip_id: clip.id });
  });

  api.post('/projects/:projectId/manual-clips', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const start = Number(req.body?.start);
    const end = Number(req.body?.end);
    const duration = row.metadata?.duration ?? 0;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return httpError(res, 422, 'Clip end time must be greater than start time.');
    }
    if (duration > 0 && end > duration) {
      return httpError(
        res,
        422,
        `Clip end time cannot exceed video duration (${duration.toFixed(1)}s).`
      );
    }
    if (end - start < 1.0) {
      return httpError(res, 422, 'Manual clip must be at least 1 second long.');
    }
    const saved = store.saveManualClip({
      id: crypto.randomUUID().slice(0, 12),
      project_id: row.id,
      title: String(req.body?.title || 'Manual Moment'),
      start,
      end,
      duration: Number((end - start).toFixed(3)),
      notes: req.body?.notes ? String(req.body.notes) : null,
      created_at: new Date().toISOString(),
    });
    return res.status(201).json(saved);
  });

  api.get('/projects/:projectId/manual-clips', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    return res.json(store.getManualClips(row.id));
  });

  api.delete('/projects/:projectId/manual-clips/:clipId', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    store.deleteManualClip(row.id, req.params.clipId);
    return res.json({ deleted: true, clip_id: req.params.clipId });
  });

  api.get('/projects/:projectId/feedback/stats', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const feedbackList = store.getFeedback(row.id);
    const manualClips = store.getManualClips(row.id);
    const result = discovery.result(row.id);
    const duration = row.metadata?.duration ?? 0;
    const category = row.user_category || row.detected_category || 'educational';
    const allClips = [
      ...((result.clips as Array<Record<string, unknown>>) || []),
      ...((result.more_discoveries as Array<Record<string, unknown>>) || []),
    ];

    const userMetrics = EvaluationMetrics.calculateMetrics(
      feedbackList,
      allClips,
      category,
      duration
    );
    const discoveryMetrics =
      result.status === 'completed'
        ? EvaluationMetrics.calculateDiscoveryQuality(result)
        : {};
    const refComparison = EvaluationMetrics.compareWithReference(allClips, manualClips);

    return res.json({
      category,
      user_feedback_metrics: userMetrics,
      discovery_quality_metrics: discoveryMetrics,
      reference_comparison: refComparison,
      manual_clips_count: manualClips.length,
      feedback_records: feedbackList,
    });
  });

  api.post('/projects/:projectId/clips/:clipId/enhance', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const result = discovery.result(row.id);
    const allClips = [
      ...((result.clips as Array<Record<string, unknown>>) || []),
      ...((result.more_discoveries as Array<Record<string, unknown>>) || []),
    ];
    const clip = allClips.find((c) => c.id === req.params.clipId);
    if (!clip) return httpError(res, 404, 'Clip not found.');

    const fingerprint = enhancer.generateFingerprint(clip);
    const cached = store.getEnhancement(row.id, String(clip.id));
    if (cached && cached.fingerprint === fingerprint) {
      return res.json(cached.enhancement_json);
    }

    const category = row.user_category || row.detected_category || 'generic';
    const metadata = row.metadata || { duration: 0, width: 1920, height: 1080, codec: 'h264' };
    const titles = enhancer.generateTitles(clip, category, String(clip.excerpt || ''));
    const captionStyle = enhancer.recommendCaptionStyle(
      category,
      Boolean(clip.has_uncertain_speech)
    );
    const formatRec = enhancer.recommendFormat(metadata, category);
    const editingIdeas = enhancer.suggestEditingIdeas(
      clip,
      category,
      metadata.audio_analysis,
      metadata.scene_analysis
    );
    const musicRec = enhancer.suggestMusicMood(clip, category, metadata.audio_analysis);
    const exportPresets = enhancer.createExportPresets(
      clip,
      metadata,
      formatRec.recommended_format
    );

    const enhancement = {
      clip_id: clip.id,
      fingerprint,
      titles,
      caption_style: captionStyle,
      format_recommendation: formatRec,
      editing_ideas: editingIdeas,
      music_recommendation: musicRec,
      export_presets: exportPresets,
      generated_at: new Date().toISOString(),
    };

    store.saveEnhancement({
      id: crypto.randomUUID(),
      project_id: row.id,
      clip_id: String(clip.id),
      fingerprint,
      enhancement_json: enhancement,
      created_at: new Date().toISOString(),
    });
    return res.json(enhancement);
  });

  api.get('/projects/:projectId/clips/:clipId/enhancements', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const cached = store.getEnhancement(row.id, req.params.clipId);
    if (!cached) return httpError(res, 404, 'No enhancements found. Generate them first.');
    return res.json(cached.enhancement_json);
  });

  api.post('/projects/:projectId/clips/:clipId/enhancements/titles/regenerate', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const result = discovery.result(row.id);
    const allClips = [
      ...((result.clips as Array<Record<string, unknown>>) || []),
      ...((result.more_discoveries as Array<Record<string, unknown>>) || []),
    ];
    const clip = allClips.find((c) => c.id === req.params.clipId);
    if (!clip) return httpError(res, 404, 'Clip not found.');
    const category = row.user_category || row.detected_category || 'generic';
    const titles = enhancer.generateTitles(clip, category, String(clip.excerpt || ''));
    return res.json({ titles });
  });

  api.post('/projects/:projectId/clips/:clipId/captions/export', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const result = discovery.result(row.id);
    const allClips = [
      ...((result.clips as Array<Record<string, unknown>>) || []),
      ...((result.more_discoveries as Array<Record<string, unknown>>) || []),
    ];
    const clip = allClips.find((c) => c.id === req.params.clipId);
    if (!clip) return httpError(res, 404, 'Clip not found.');
    const transcript = store.getTranscript(row.id);
    if (!transcript) return httpError(res, 404, 'Transcript not found.');
    return res.json(enhancer.exportCaptionsSrt(clip, transcript));
  });

  api.get('/projects/:projectId/speakers/status', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    return res.json({
      available: true,
      error_message: null,
      requires_installation: false,
    });
  });

  api.post('/projects/:projectId/speakers/analyze', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const transcript = store.getTranscript(row.id);
    if (!transcript) {
      return httpError(res, 400, 'Project must be transcribed before speaker analysis.');
    }
    const analysis = analyzeSpeakersFromTranscript(
      transcript,
      row.metadata?.duration ?? 0
    );
    store.saveSpeakerAnalysis({
      id: crypto.randomUUID(),
      project_id: row.id,
      fingerprint: analysis.fingerprint,
      analysis_json: analysis,
      created_at: new Date().toISOString(),
    });
    return res.json({
      ...analysis,
      user_labels: store.getSpeakerLabels(row.id),
    });
  });

  api.get('/projects/:projectId/speakers', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const cached = store.getSpeakerAnalysis(row.id);
    if (!cached) {
      return httpError(res, 404, 'No speaker analysis found. Run analysis first.');
    }
    return res.json({
      ...cached.analysis_json,
      user_labels: store.getSpeakerLabels(row.id),
    });
  });

  api.put('/projects/:projectId/speakers/labels', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const speakerId = String(req.body?.speaker_id || '').trim();
    const userLabel = String(req.body?.user_label || '').trim();
    if (!speakerId || !userLabel) {
      return httpError(res, 422, 'speaker_id and user_label are required.');
    }
    store.saveSpeakerLabel(row.id, speakerId, userLabel);
    return res.json({ success: true, speaker_id: speakerId, user_label: userLabel });
  });

  api.post('/projects/:projectId/speakers/segments/:segmentIndex/correct', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const cached = store.getSpeakerAnalysis(row.id);
    if (!cached) return httpError(res, 404, 'No speaker analysis found.');
    const idx = Number(req.params.segmentIndex);
    const newSpeaker = String(req.body?.new_speaker || '').trim();
    if (!newSpeaker) return httpError(res, 422, 'new_speaker is required');
    if (Number.isNaN(idx) || idx < 0 || idx >= cached.analysis_json.segments.length) {
      return httpError(res, 400, 'Invalid segment index');
    }
    cached.analysis_json.segments[idx].speaker = newSpeaker;
    cached.analysis_json.segments[idx].manually_corrected = true;
    const speakers = Array.from(
      new Set(cached.analysis_json.segments.map((s) => s.speaker))
    ).sort();
    cached.analysis_json.speakers = speakers;
    cached.analysis_json.speaker_count = speakers.length;
    store.saveSpeakerAnalysis(cached);
    return res.json({
      success: true,
      updated_segment: cached.analysis_json.segments[idx],
    });
  });

  api.delete('/projects/:projectId/speakers', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    store.deleteSpeakerAnalysis(row.id);
    return res.json({ success: true, message: 'Speaker analysis deleted' });
  });

  api.get('/projects/:projectId/speakers/timeline', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    const cached = store.getSpeakerAnalysis(row.id);
    if (!cached) return httpError(res, 404, 'No speaker analysis found.');
    let timeline = formatSpeakerTimeline(cached.analysis_json.segments);
    const labels = store.getSpeakerLabels(row.id);
    for (const [spk, label] of Object.entries(labels)) {
      timeline = timeline.replaceAll(spk, label);
    }
    return res.json({
      timeline,
      segment_count: cached.analysis_json.segments.length,
      speaker_count: cached.analysis_json.speaker_count,
    });
  });

  api.post('/youtube/analyze', async (req, res) => {
    const url = String(req.body?.url || '');
    const language = req.body?.language === 'auto' ? 'auto' : 'en';
    const check = validateYouTubeUrl(url);
    if (!check.valid || !check.videoId) {
      return httpError(res, 400, check.error || 'Invalid YouTube URL');
    }
    const videoId = check.videoId;
    const existing = store.list().find((p) => p.youtube_video_id === videoId);
    if (existing) {
      return res.status(201).json({ project_id: existing.id, status: 'existing' });
    }

    const projectId = crypto.randomUUID();
    const metadata = await fetchYouTubeMetadata(videoId);
    const rawTitle = metadata?.title || `YouTube Video ${videoId}`;
    const filename = rawTitle.replace(/[<>:"/\\|?*]/g, '').slice(0, 100) || `YouTube_${videoId}`;

    store.create(projectId, filename, url, 0, language, 'fast', 'youtube');
    store.update(projectId, {
      status: 'completed',
      youtube_video_id: videoId,
      youtube_url: url,
      youtube_metadata: metadata,
      metadata: metadata || { duration: 0, width: 1280, height: 720, codec: 'youtube' },
      analysis_mode: 'transcript_only',
      warning:
        'Paste or upload SRT/VTT/plain transcript below to analyze this YouTube video.',
    });

    return res.status(201).json({
      project_id: projectId,
      status: 'awaiting_transcript',
      metadata,
      warning: 'No automatic captions retrieved. Import transcript manually to continue.',
    });
  });

  api.get('/youtube/transcript/:projectId', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    if (row.source_type !== 'youtube') return httpError(res, 400, 'Not a YouTube project');
    const transcript = store.getTranscript(row.id);
    if (!transcript) return httpError(res, 404, 'Transcript not available yet');
    return res.json(transcript);
  });

  api.post('/youtube/transcript/:projectId/manual', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    if (row.source_type !== 'youtube') return httpError(res, 400, 'Not a YouTube project');
    const content = String(req.body?.transcript || '');
    const format = (['srt', 'vtt', 'plain'].includes(req.body?.format)
      ? req.body.format
      : 'plain') as 'srt' | 'vtt' | 'plain';

    const transcript = parseManualTranscript(content, format);
    if (!transcript) {
      return httpError(res, 400, `Failed to parse ${format.toUpperCase()} transcript`);
    }
    const maxEnd =
      transcript.segments[transcript.segments.length - 1]?.end || 0;
    const meta = {
      ...(row.metadata || { width: 1280, height: 720, codec: 'youtube' }),
      duration: maxEnd,
    };
    const transcriptPath = store.saveTranscript(row.id, transcript);
    const profile = profileContent(transcript, meta);

    store.update(row.id, {
      status: 'completed',
      metadata: meta,
      transcript_path: transcriptPath,
      transcript_source: 'user_provided',
      content_profile: profile,
      detected_category: profile.primary_category,
      category_confidence: String(profile.confidence),
      warning: null,
    });

    return res.json({
      success: true,
      segment_count: transcript.segments.length,
      format,
    });
  });

  api.get('/youtube/playback-url/:projectId/:clipId', (req, res) => {
    const row = store.get(req.params.projectId);
    if (!row) return httpError(res, 404, 'Project not found.');
    if (row.source_type !== 'youtube') return httpError(res, 400, 'Not a YouTube project');
    const videoId = row.youtube_video_id;
    if (!videoId) return httpError(res, 404, 'Video ID not found');
    const result = discovery.result(row.id);
    const allClips = [
      ...((result.clips as Array<Record<string, unknown>>) || []),
      ...((result.more_discoveries as Array<Record<string, unknown>>) || []),
    ];
    const clip = allClips.find((c) => c.id === req.params.clipId);
    if (!clip) return httpError(res, 404, 'Clip not found');
    return res.json({
      playback_url: buildYouTubePlaybackUrl(videoId, Number(clip.start)),
      embed_url: buildYouTubeEmbedUrl(videoId, Number(clip.start)),
      video_id: videoId,
      start_seconds: clip.start,
    });
  });

  app.use('/api', api);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: path.resolve(process.cwd(), 'frontend'),
      configFile: path.resolve(process.cwd(), 'frontend/vite.config.ts'),
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'frontend/dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipForge server listening on http://0.0.0.0:${PORT}`);
  });
}

void createServer();
