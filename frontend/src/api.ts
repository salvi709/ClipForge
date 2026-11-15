export type Status =
  | "queued" | "extracting" | "loading_model" | "saving" | "cancelled"
  | "waiting"
  | "preparing"
  | "transcribing"
  | "completed"
  | "failed"
  | "deleting"
  | "deletion_failed";

export type ContentCategory = 
  | 'educational' | 'podcast' | 'gaming' | 'vlog' 
  | 'travel' | 'cinematic' | 'sports' | 'comedy' 
  | 'documentary' | 'music' | 'mixed' | 'generic' | 'minimal_speech';

export type ContentProfile = {
  duration: number;
  word_count: number;
  speech_density: number;
  has_meaningful_speech: boolean;
  category_scores: Record<string, number>;
  primary_category: ContentCategory;
  secondary_category?: ContentCategory;
  confidence: number;
  characteristics: {
    question_count: number;
    question_density: number;
    conversational_markers: number;
    excitement_markers: number;
    technical_terms: number;
    vocabulary_diversity: number;
    volume_peak_count?: number;
    average_motion?: number;
  };
  is_mixed_content: boolean;
  detection_notes: string[];
  detection_explanation?: string;
  supporting_evidence?: string[];
};

export type Project = {
  id: string;
  filename: string;
  size: number;
  status: Status;
  created_at: string;
  processing?: { started_at?: number; elapsed_seconds?: number; finished_at?: number; heartbeat_at?: number; processed_seconds?: number; total_seconds?: number; device?: string; model?: string; compute_type?: string; cancel_requested?: boolean; };
  error: string | null;
  warning: string | null;
  language: "auto" | "en";
  quality: "fast" | "accurate";
  metadata: {
    duration: number;
    width: number;
    height: number;
    codec: string;
  } | null;
  detected_category?: ContentCategory;
  user_category?: ContentCategory;
  category_confidence?: string;
  content_profile?: ContentProfile;
};
export type Segment = {
  id: number;
  start: number;
  end: number;
  text: string;
  words: { start: number; end: number; word: string; probability: number }[];
};
export type Transcript = {
  language: string;
  language_probability: number;
  device: string;
  segments: Segment[];
  sentences?: Segment[];
  uncertain_ranges?: { start: number; end: number; reason: string }[];
  transcription_options?: { language: string; quality: string; model: string };
};
export type Health = {
  status: string;
  checks: { ffmpeg: boolean; ffprobe: boolean; model: boolean };
  max_upload_bytes: number;
  device_preference: string;
  quality_model_ready?: boolean;
  transcription_models?: { fast: string; accurate: string };
};

export type TranscriptionOptions = {
  language: "auto" | "en";
  quality: "fast" | "accurate";
};
export type Clip = {
  id: string;
  rank: number;
  title: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  reason: string;
  evidence: string;
  excerpt: string;
  original_start: number;
  original_end: number;
  adjusted: boolean;
  duration_exception: boolean;
  confidence?: "strong" | "lower";
  quality_rejections?: string[];
  criteria: {
    hook_strength: number;
    informational_value: number;
    context_completeness: number;
    clarity: number;
  };
  scoring_factors?: Record<string, number>;
};
export type DiscoveryOptions = { clip_count: number; min_seconds: number; max_seconds: number };
export type DiscoveryResult = {
  status: string;
  clips: Clip[];
  top_picks?: Clip[];
  more_discoveries?: Clip[];
  category?: string;
  error?: string | null;
  message?: string | null;
  evaluated?: number;
  total?: number;
  model?: string;
  candidate_count?: number;
  score_weights?: Record<string, number>;
  settings?: DiscoveryOptions | null;
  result_settings?: DiscoveryOptions | null;
  previous_result?: boolean;
  progress?: { stage?: string; started_at?: number; queued_at?: number; elapsed_seconds?: number; heartbeat_at?: number; stage_started_at?: number; finished_at?: number; cancel_requested?: boolean; completed_stages?: string[] };
};

export type ClipFeedbackRating = "excellent" | "good" | "average" | "bad";
export type ClipFeedbackAction = "accept" | "reject" | "accepted" | "rejected" | "adjusted";

export type ClipFeedbackRecord = {
  id?: string;
  project_id: string;
  clip_id: string;
  rating?: ClipFeedbackRating | null;
  action?: ClipFeedbackAction | null;
  adjusted_start?: number | null;
  adjusted_end?: number | null;
  original_start?: number | null;
  original_end?: number | null;
  scoring_factors?: Record<string, number> | null;
  user_notes?: string | null;
  created_at?: string;
};

export type ManualClip = {
  id: string;
  project_id: string;
  title: string;
  start: number;
  end: number;
  duration: number;
  notes?: string | null;
  created_at?: string;
};

export type FeedbackStats = {
  category: string;
  user_feedback_metrics: {
    has_human_feedback: boolean;
    human_evaluation?: {
      is_measured_human_metric: boolean;
      feedback_count: number;
      top_3_acceptance_rate: number;
      precision_at_3: number;
      overall_precision: number;
      human_rated_quality: number;
      boundary_accuracy_percent: number | null;
      avg_boundary_adjustment_seconds: number;
      ratings_breakdown: Record<string, number>;
      actions_breakdown: Record<string, number>;
    } | null;
    heuristic_estimates: {
      is_measured_human_metric: boolean;
      estimated_average_score: number;
      candidate_timeline_coverage_ratio: number;
      disclaimer: string;
    };
  };
  discovery_quality_metrics?: {
    candidate_count: number;
    quality_pass_rate: number;
    duplicate_recommendation_rate: number;
    top_picks_count: number;
    more_discoveries_count: number;
  };
  reference_comparison?: {
    has_reference: boolean;
    reference_count?: number;
    matches_found?: number;
    recall?: number;
    precision?: number;
    f1_score?: number;
    boundary_accuracy_percent?: number;
  };
  manual_clips_count: number;
  feedback_records: ClipFeedbackRecord[];
};
export type DiscoveryHealth = {
  status: string;
  model: string;
  message: string;
};

export type ExportStrategy = "fast" | "accurate";
export type ExportRequest = {
  strategy: ExportStrategy;
};
export type ExportResult = {
  export_id: string;
  clip_id: string;
  filename: string;
  expected_duration: number;
  file_size: number;
  strategy: ExportStrategy;
};

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : `Local engine returned ${response.status}.`,
    );
  }
  return response.json();
}

export function validateFile(file: File, limit: number): string | null {
  if (!file.name.toLowerCase().endsWith(".mp4"))
    return "Choose an MP4 video. Other formats are not supported yet.";
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > limit)
    return `Video exceeds the ${Math.round(limit / 1024 / 1024)} MB upload limit.`;
  return null;
}

export function uploadVideo(
  file: File,
  onProgress: (value: number) => void,
  options: TranscriptionOptions = { language: "auto", quality: "fast" },
): Promise<Project> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/projects?language=${options.language}&quality=${options.quality}`,
    );
    xhr.setRequestHeader("Content-Type", "video/mp4");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-Upload-ID", crypto.randomUUID());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(
        new Error("Upload connection lost. Check the local backend and retry."),
      );
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("The local engine returned an unreadable response."));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else
        reject(
          new Error(
            typeof data.detail === "string" ? data.detail : "Upload failed.",
          ),
        );
    };
    xhr.send(file);
  });
}

export function timestamp(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((value / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

export async function exportClip(projectId: string, clipId: string, strategy: ExportStrategy = "fast"): Promise<ExportResult> {
  return api<ExportResult>(`/projects/${projectId}/clips/${clipId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy })
  });
}

export function downloadExport(projectId: string, exportId: string, filename: string): void {
  const link = document.createElement('a');
  link.href = `/api/projects/${projectId}/exports/${exportId}`;
  link.download = filename;
  link.click();
}

export async function submitClipFeedback(
  projectId: string,
  clipId: string,
  feedback: {
    rating?: ClipFeedbackRating;
    action?: ClipFeedbackAction;
    adjusted_start?: number;
    adjusted_end?: number;
    original_start?: number;
    original_end?: number;
    scoring_factors?: Record<string, number>;
    user_notes?: string;
  }
): Promise<{ feedback_id: string; clip_id: string }> {
  return api<{ feedback_id: string; clip_id: string }>(
    `/projects/${projectId}/clips/${clipId}/feedback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback),
    }
  );
}

export async function createManualClip(
  projectId: string,
  data: { start: number; end: number; title?: string; notes?: string }
): Promise<ManualClip> {
  return api<ManualClip>(`/projects/${projectId}/manual-clips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function getManualClips(projectId: string): Promise<ManualClip[]> {
  try {
    const res = await api<ManualClip[]>(`/projects/${projectId}/manual-clips`);
    if (!Array.isArray(res)) return [];
    return res.filter(m => m && typeof m.start === "number" && typeof m.end === "number");
  } catch {
    return [];
  }
}

export async function deleteManualClip(projectId: string, clipId: string): Promise<{ deleted: boolean }> {
  return api<{ deleted: boolean }>(`/projects/${projectId}/manual-clips/${clipId}`, {
    method: "DELETE",
  });
}

export async function getFeedbackStats(projectId: string): Promise<FeedbackStats | null> {
  try {
    const res = await api<FeedbackStats>(`/projects/${projectId}/feedback/stats`);
    if (!res || typeof res !== "object" || !res.user_feedback_metrics) {
      return null;
    }
    return res;
  } catch {
    return null;
  }
}


export async function updateCategory(projectId: string, category: ContentCategory): Promise<Project> {
  return api<Project>(`/projects/${projectId}/category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category }),
  });
}


// Smart Enhancement Types
export type TitleOption = {
  text: string;
  hook_type: string;
  reasoning: string;
};

export type CaptionStyleRecommendation = {
  style: string;
  max_chars_per_line: number;
  line_count: number;
  highlight_keywords: boolean;
  animation: string;
  position: string;
  font_weight: string;
  color_scheme: string;
  reasoning: string;
  uncertain_marker?: string;
  show_uncertainty_warning: boolean;
};

export type CropSuggestion = {
  type: 'none' | 'center' | 'subject_tracking' | 'manual';
  confidence: number;
  position: { x: number; y: number };
  note: string;
};

export type FormatRecommendation = {
  recommended_format: '9:16' | '16:9' | '1:1';
  original_aspect_ratio: string;
  crop_suggestion: CropSuggestion;
  reasoning: string;
  platforms: string[];
};

export type EditingIdea = {
  type: string;
  suggestion: string;
  reasoning: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  timestamps?: number[];
};

export type SoundEffectIdea = {
  type: string;
  timing: string;
  reasoning: string;
  timestamp?: number;
};

export type MusicRecommendation = {
  music_mood: string;
  volume_level: string;
  volume_note: string;
  speech_density: number;
  silence_moments: Array<{ start: number; end: number }>;
  sound_effect_ideas: SoundEffectIdea[];
  licensing_note: string;
  application_note: string;
};

export type ExportPreset = {
  platform: string;
  aspect_ratio: string;
  resolution: { width: number; height: number };
  frame_rate: number;
  format: string;
  codec: string;
  audio_codec: string;
  audio_bitrate?: string;
  max_duration?: number;
  recommended: boolean;
  notes: string;
};

export type ClipEnhancement = {
  clip_id: string;
  fingerprint: string;
  titles: TitleOption[];
  caption_style: CaptionStyleRecommendation;
  format_recommendation: FormatRecommendation;
  editing_ideas: EditingIdea[];
  music_recommendation: MusicRecommendation;
  export_presets: ExportPreset[];
  generated_at: string;
};

export async function generateEnhancement(projectId: string, clipId: string): Promise<ClipEnhancement> {
  return api<ClipEnhancement>(`/projects/${projectId}/clips/${clipId}/enhance`, {
    method: 'POST',
  });
}

export async function getEnhancement(projectId: string, clipId: string): Promise<ClipEnhancement> {
  return api<ClipEnhancement>(`/projects/${projectId}/clips/${clipId}/enhancements`);
}

export async function regenerateTitles(projectId: string, clipId: string): Promise<{ titles: TitleOption[] }> {
  return api<{ titles: TitleOption[] }>(`/projects/${projectId}/clips/${clipId}/enhancements/titles/regenerate`, {
    method: 'POST',
  });
}

export async function exportCaptions(projectId: string, clipId: string): Promise<{ format: string; content: string; caption_count: number }> {
  return api<{ format: string; content: string; caption_count: number }>(`/projects/${projectId}/clips/${clipId}/captions/export`, {
    method: 'POST',
  });
}


// Speaker Intelligence Types
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
  overlapping_speech: Array<{
    start: number;
    end: number;
    speakers: string[];
  }>;
  device: 'cpu' | 'cuda';
  processing_time: number;
  model_version: string;
  fingerprint: string;
  user_labels?: Record<string, string>;
  transcript_segments?: Array<Segment & { speaker?: string }>;
  error?: string;
};

export type SpeakerStatus = {
  available: boolean;
  error_message: string | null;
  requires_installation: boolean;
};

export type SpeakerTimeline = {
  timeline: string;
  segment_count: number;
  speaker_count: number;
};

// Speaker Intelligence API Functions
export async function getSpeakerStatus(projectId: string): Promise<SpeakerStatus> {
  return api<SpeakerStatus>(`/projects/${projectId}/speakers/status`);
}

export async function analyzeSpeakers(projectId: string): Promise<SpeakerAnalysis> {
  return api<SpeakerAnalysis>(`/projects/${projectId}/speakers/analyze`, {
    method: 'POST'
  });
}

export async function getSpeakers(projectId: string): Promise<SpeakerAnalysis> {
  return api<SpeakerAnalysis>(`/projects/${projectId}/speakers`);
}

export async function updateSpeakerLabel(
  projectId: string,
  speakerId: string,
  userLabel: string
): Promise<{ success: boolean; speaker_id: string; user_label: string }> {
  return api(`/projects/${projectId}/speakers/labels`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speaker_id: speakerId, user_label: userLabel })
  });
}

export async function correctSpeakerSegment(
  projectId: string,
  segmentIndex: number,
  newSpeaker: string
): Promise<{ success: boolean; updated_segment: SpeakerSegment }> {
  return api(`/projects/${projectId}/speakers/segments/${segmentIndex}/correct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_speaker: newSpeaker })
  });
}

export async function deleteSpeakerAnalysis(projectId: string): Promise<{ success: boolean; message: string }> {
  return api(`/projects/${projectId}/speakers`, {
    method: 'DELETE'
  });
}

export async function getSpeakerTimeline(projectId: string): Promise<SpeakerTimeline> {
  return api<SpeakerTimeline>(`/projects/${projectId}/speakers/timeline`);
}
