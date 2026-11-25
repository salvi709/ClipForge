import fs from 'node:fs';
import path from 'node:path';

export type ProjectStatus =
  | 'waiting'
  | 'preparing'
  | 'queued'
  | 'extracting'
  | 'loading_model'
  | 'transcribing'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deleting'
  | 'deletion_failed';

export type VideoMetadata = {
  duration: number;
  width: number;
  height: number;
  codec: string;
  has_audio?: boolean;
  audio_analysis?: AudioAnalysis;
  scene_analysis?: SceneAnalysis;
};

export type AudioAnalysis = {
  speech_regions: Array<{ start: number; end: number; duration: number }>;
  silence_periods: Array<{ start: number; end: number; duration: number }>;
  volume_peaks: Array<{ timestamp: number; level: number }>;
};

export type SceneAnalysis = {
  scene_changes: Array<{ timestamp: number; score: number }>;
  motion_analysis: { average_magnitude: number };
};

export type TranscriptWord = {
  start: number;
  end: number;
  word: string;
  probability: number;
};

export type TranscriptSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
  uncertain_reason?: string;
};

export type SentenceUnit = {
  id: number;
  start: number;
  end: number;
  text: string;
  complete?: boolean;
  words?: TranscriptWord[];
  uncertain?: boolean;
  uncertain_reason?: string;
};

export type TranscriptData = {
  language: string;
  language_probability: number;
  device: string;
  segments: TranscriptSegment[];
  sentences?: SentenceUnit[];
  uncertain_ranges?: Array<{ start: number; end: number; reason: string }>;
  transcription_options?: { language: string; quality: string; model: string };
  transcript_source?: string;
  is_generated?: boolean;
};

export type ProjectRecord = {
  id: string;
  filename: string;
  source_path: string;
  size: number;
  metadata: VideoMetadata | null;
  status: ProjectStatus;
  created_at: string;
  transcript_path: string | null;
  error: string | null;
  warning: string | null;
  language: 'auto' | 'en';
  quality: 'fast' | 'accurate';
  processing: {
    started_at?: number;
    elapsed_seconds?: number;
    finished_at?: number;
    heartbeat_at?: number;
    processed_seconds?: number;
    total_seconds?: number;
    device?: string;
    model?: string;
    compute_type?: string;
    cancel_requested?: boolean;
    upload_seconds?: number;
  } | null;
  content_profile?: Record<string, unknown> | null;
  detected_category?: string;
  user_category?: string | null;
  category_confidence?: string | null;
  source_type: 'local' | 'youtube';
  youtube_video_id?: string | null;
  youtube_url?: string | null;
  youtube_metadata?: Record<string, unknown> | null;
  transcript_source?: string | null;
  analysis_mode: 'multimodal' | 'transcript_only';
};

export type DiscoveryState = {
  project_id: string;
  status: string;
  error: string | null;
  result_path: string | null;
  result_json: Record<string, unknown> | null;
  fingerprint: string | null;
  updated_at: string;
  evaluated: number;
  total: number;
  settings_json: string | null;
  progress_json: string | null;
};

export type FeedbackRecord = {
  id: string;
  project_id: string;
  clip_id: string;
  rating: string | null;
  action: string | null;
  adjusted_start: number | null;
  adjusted_end: number | null;
  user_notes: string | null;
  model_version: string | null;
  algorithm_version: string | null;
  original_start: number | null;
  original_end: number | null;
  scoring_factors: Record<string, number> | null;
  created_at: string;
};

export type ManualClipRecord = {
  id: string;
  project_id: string;
  title: string;
  start: number;
  end: number;
  duration: number;
  notes: string | null;
  created_at: string;
};

export type ExportRecord = {
  id: string;
  project_id: string;
  clip_id: string;
  export_path: string;
  strategy: string;
  duration: number;
  file_size: number;
  created_at: string;
};

export type EnhancementCache = {
  id: string;
  project_id: string;
  clip_id: string;
  fingerprint: string;
  enhancement_json: Record<string, unknown>;
  created_at: string;
};

export type SpeakerSegment = {
  speaker: string;
  start: number;
  end: number;
  confidence: number;
  transcript?: string;
  manually_corrected?: boolean;
};

export type SpeakerAnalysis = {
  speakers: string[];
  segments: SpeakerSegment[];
  speaker_count: number;
  overlapping_speech: Array<{ start: number; end: number; speakers: string[] }>;
  device: 'cpu' | 'cuda';
  processing_time: number;
  model_version: string;
  fingerprint: string;
  transcript_segments?: Array<TranscriptSegment & { speaker?: string }>;
  user_labels?: Record<string, string>;
};

export type SpeakerAnalysisCache = {
  id: string;
  project_id: string;
  fingerprint: string;
  analysis_json: SpeakerAnalysis;
  created_at: string;
};

export class InMemoryStore {
  readonly dataDir: string;
  private projects = new Map<string, ProjectRecord>();
  private transcripts = new Map<string, TranscriptData>();
  private discoveries = new Map<string, DiscoveryState>();
  private clipEdits = new Map<string, Map<string, { start: number; end: number }>>();
  private clipFeedback = new Map<string, FeedbackRecord[]>();
  private manualClips = new Map<string, ManualClipRecord[]>();
  private clipExports = new Map<string, ExportRecord[]>();
  private clipEnhancements = new Map<string, Map<string, EnhancementCache>>();
  private speakerAnalyses = new Map<string, SpeakerAnalysisCache>();
  private speakerLabels = new Map<string, Map<string, string>>();

  constructor(dataDir?: string) {
    this.dataDir = path.resolve(dataDir || process.env.CLIPFORGE_DATA_DIR || '/tmp/clipforge-data');
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  projectDir(projectId: string): string {
    return path.join(this.dataDir, 'projects', projectId);
  }

  create(
    projectId: string,
    filename: string,
    sourcePath: string,
    size: number,
    language: 'auto' | 'en' = 'auto',
    quality: 'fast' | 'accurate' = 'fast',
    sourceType: 'local' | 'youtube' = 'local'
  ): ProjectRecord {
    const record: ProjectRecord = {
      id: projectId,
      filename,
      source_path: sourcePath,
      size,
      metadata: null,
      status: 'waiting',
      created_at: new Date().toISOString(),
      transcript_path: null,
      error: null,
      warning: null,
      language,
      quality,
      processing: null,
      content_profile: null,
      detected_category: 'generic',
      user_category: null,
      category_confidence: null,
      source_type: sourceType,
      youtube_video_id: null,
      youtube_url: null,
      youtube_metadata: null,
      transcript_source: null,
      analysis_mode: sourceType === 'local' ? 'multimodal' : 'transcript_only',
    };
    this.projects.set(projectId, record);
    return record;
  }

  get(projectId: string): ProjectRecord | undefined {
    return this.projects.get(projectId);
  }

  list(): ProjectRecord[] {
    return Array.from(this.projects.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
  }

  update(projectId: string, patch: Partial<ProjectRecord>): ProjectRecord | undefined {
    const existing = this.projects.get(projectId);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.projects.set(projectId, updated);
    return updated;
  }

  saveTranscript(projectId: string, transcript: TranscriptData): string {
    const dir = this.projectDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'transcript.json');
    fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), 'utf-8');
    this.transcripts.set(projectId, transcript);
    this.update(projectId, { transcript_path: filePath });
    return filePath;
  }

  getTranscript(projectId: string): TranscriptData | null {
    const mem = this.transcripts.get(projectId);
    if (mem) return mem;
    const row = this.projects.get(projectId);
    if (row?.transcript_path && fs.existsSync(row.transcript_path)) {
      const parsed = JSON.parse(fs.readFileSync(row.transcript_path, 'utf-8')) as TranscriptData;
      this.transcripts.set(projectId, parsed);
      return parsed;
    }
    return null;
  }

  discovery(projectId: string): DiscoveryState | undefined {
    return this.discoveries.get(projectId);
  }

  updateDiscovery(projectId: string, patch: Partial<DiscoveryState>): DiscoveryState {
    if (!this.projects.has(projectId)) {
      throw new Error('Project not found');
    }
    const existing = this.discoveries.get(projectId) || {
      project_id: projectId,
      status: 'preparing_transcript',
      error: null,
      result_path: null,
      result_json: null,
      fingerprint: null,
      updated_at: new Date().toISOString(),
      evaluated: 0,
      total: 0,
      settings_json: null,
      progress_json: null,
    };
    const updated: DiscoveryState = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.discoveries.set(projectId, updated);
    return updated;
  }

  completeDiscovery(
    projectId: string,
    result: Record<string, unknown>,
    targetPath: string,
    progress: Record<string, unknown>
  ): void {
    if (!this.projects.has(projectId)) {
      throw new Error('Project not found');
    }
    this.clipEdits.delete(projectId);
    this.updateDiscovery(projectId, {
      status: 'completed',
      error: null,
      result_json: result,
      result_path: targetPath,
      fingerprint: String(result.fingerprint || ''),
      progress_json: JSON.stringify(progress),
    });
  }

  invalidateDiscovery(projectId: string): void {
    this.discoveries.delete(projectId);
    this.clipEdits.delete(projectId);
  }

  edits(projectId: string): Record<string, { start: number; end: number }> {
    const map = this.clipEdits.get(projectId);
    if (!map) return {};
    const out: Record<string, { start: number; end: number }> = {};
    for (const [clipId, range] of map.entries()) {
      out[clipId] = range;
    }
    return out;
  }

  saveEdit(projectId: string, clipId: string, start: number, end: number): void {
    let map = this.clipEdits.get(projectId);
    if (!map) {
      map = new Map();
      this.clipEdits.set(projectId, map);
    }
    map.set(clipId, { start, end });
  }

  saveFeedback(record: FeedbackRecord): void {
    const list = this.clipFeedback.get(record.project_id) || [];
    const filtered = list.filter((item) => item.clip_id !== record.clip_id || item.id !== record.id);
    filtered.unshift(record);
    this.clipFeedback.set(record.project_id, filtered);
  }

  getFeedback(projectId: string): FeedbackRecord[] {
    return this.clipFeedback.get(projectId) || [];
  }

  saveManualClip(record: ManualClipRecord): ManualClipRecord {
    const list = this.manualClips.get(record.project_id) || [];
    const next = [...list.filter((c) => c.id !== record.id), record].sort(
      (a, b) => a.start - b.start
    );
    this.manualClips.set(record.project_id, next);
    return record;
  }

  getManualClips(projectId: string): ManualClipRecord[] {
    return this.manualClips.get(projectId) || [];
  }

  deleteManualClip(projectId: string, clipId: string): void {
    const list = this.manualClips.get(projectId) || [];
    this.manualClips.set(
      projectId,
      list.filter((c) => c.id !== clipId)
    );
  }

  saveExport(record: ExportRecord): void {
    const list = this.clipExports.get(record.project_id) || [];
    list.unshift(record);
    this.clipExports.set(record.project_id, list);
  }

  getExports(projectId: string): ExportRecord[] {
    return this.clipExports.get(projectId) || [];
  }

  saveEnhancement(cache: EnhancementCache): void {
    let map = this.clipEnhancements.get(cache.project_id);
    if (!map) {
      map = new Map();
      this.clipEnhancements.set(cache.project_id, map);
    }
    map.set(cache.clip_id, cache);
  }

  getEnhancement(projectId: string, clipId: string): EnhancementCache | undefined {
    return this.clipEnhancements.get(projectId)?.get(clipId);
  }

  saveSpeakerAnalysis(cache: SpeakerAnalysisCache): void {
    this.speakerAnalyses.set(cache.project_id, cache);
  }

  getSpeakerAnalysis(projectId: string): SpeakerAnalysisCache | undefined {
    return this.speakerAnalyses.get(projectId);
  }

  deleteSpeakerAnalysis(projectId: string): void {
    this.speakerAnalyses.delete(projectId);
    this.speakerLabels.delete(projectId);
  }

  saveSpeakerLabel(projectId: string, speakerId: string, userLabel: string): void {
    let map = this.speakerLabels.get(projectId);
    if (!map) {
      map = new Map();
      this.speakerLabels.set(projectId, map);
    }
    map.set(speakerId, userLabel);
  }

  getSpeakerLabels(projectId: string): Record<string, string> {
    const map = this.speakerLabels.get(projectId);
    if (!map) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of map.entries()) out[k] = v;
    return out;
  }

  delete(projectId: string): void {
    this.projects.delete(projectId);
    this.transcripts.delete(projectId);
    this.discoveries.delete(projectId);
    this.clipEdits.delete(projectId);
    this.clipFeedback.delete(projectId);
    this.manualClips.delete(projectId);
    this.clipExports.delete(projectId);
    this.clipEnhancements.delete(projectId);
    this.speakerAnalyses.delete(projectId);
    this.speakerLabels.delete(projectId);
    const dir = this.projectDir(projectId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function publicProject(row: ProjectRecord) {
  const { source_path: _sp, transcript_path: _tp, ...rest } = row;
  return rest;
}
