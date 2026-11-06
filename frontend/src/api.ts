export type Status =
  | "queued" | "extracting" | "loading_model" | "saving" | "cancelled"
  | "waiting"
  | "preparing"
  | "transcribing"
  | "completed"
  | "failed"
  | "deleting"
  | "deletion_failed";
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
};
export type DiscoveryOptions = { clip_count: number; min_seconds: number; max_seconds: number };
export type DiscoveryResult = {
  status: string;
  clips: Clip[];
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
