import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  FileVideo,
  Film,
  HardDrive,
  Layers2,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  Health,
  Project,
  timestamp,
  Transcript,
  uploadVideo,
  validateFile,
  TranscriptionOptions,
} from "./api";
import DiscoveryPanel from "./DiscoveryPanel";
import DeleteProjectDialog from "./DeleteProjectDialog";
import { CategoryDisplay } from "./CategoryDisplay";
import { useClipPreview } from "./useClipPreview";

const labels = {
  queued: "Queued", extracting: "Extracting audio", loading_model: "Loading transcription model", saving: "Saving transcript", cancelled: "Cancelled",
  waiting: "Waiting in queue",
  preparing: "Preparing video",
  transcribing: "Transcribing",
  completed: "Completed",
  failed: "Failed",
  deleting: "Deleting",
  deletion_failed: "Deletion incomplete",
};
const busy = (project: Project) =>
  ["waiting", "preparing", "queued", "extracting", "loading_model", "transcribing", "saving"].includes(project.status);

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");
  const deleteLock = useRef(false);
  const deletedIds = useRef(new Set<string>());
  const [uploading, setUploading] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcriptError, setTranscriptError] = useState("");
  const [query, setQuery] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [options, setOptions] = useState<TranscriptionOptions>({
    language: "en",
    quality: "fast",
  });
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const uploadLock = useRef(false);
  const project = projects.find((item) => item.id === selected);
  const clipPreview = useClipPreview(video, project?.id);
  const previewClip = useCallback(async (start: number, end: number) => {
    video.current?.scrollIntoView({ block: "center" });
    await clipPreview.preview(start, end);
  }, [clipPreview.preview]);
  const seekClip = useCallback((start: number) => {
    clipPreview.stop();
    if (video.current) video.current.currentTime = start;
    setCurrentTime(start);
  }, [clipPreview.stop]);

  useEffect(() => {
    if (project)
      setOptions({
        language: project.language ?? "auto",
        quality: project.quality ?? "fast",
      });
  }, [project?.id]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [nextHealth, nextProjects] = await Promise.all([
          api<Health>("/health"),
          api<Project[]>("/projects"),
        ]);
        if (active) {
          setHealth(previous => JSON.stringify(previous) === JSON.stringify(nextHealth) ? previous : nextHealth);
          const retained = nextProjects.filter((item) => !deletedIds.current.has(item.id));
          setProjects(previous => JSON.stringify(previous) === JSON.stringify(retained) ? previous : retained);
          setConnected(true);
        }
      } catch {
        if (active) setConnected(false);
      }
      if (active) timer = setTimeout(refresh, 1500);
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    setTranscript(null);
    setTranscriptError("");
    setQuery("");
    setCurrentTime(0);
    setVideoError(false);
    if (project?.status !== "completed") return;
    const controller = new AbortController();
    api<Transcript>(`/projects/${project.id}/transcript`, {
      signal: controller.signal,
    })
      .then(setTranscript)
      .catch((reason) => {
        if (!controller.signal.aborted) setTranscriptError(reason.message);
      });
    return () => controller.abort();
  }, [project?.id, project?.status]);

  async function upload(file?: File) {
    if (!file || uploadLock.current) return;
    const validation = validateFile(
      file,
      health?.max_upload_bytes ?? 2 * 1024 ** 3,
    );
    if (validation) {
      setError(validation);
      return;
    }
    if (!connected) {
      setError("Start the local backend before uploading a video.");
      return;
    }
    uploadLock.current = true;
    setUploading(0);
    setError("");
    try {
      const created = await uploadVideo(file, setUploading, options);
      setProjects((previous) => [
        created,
        ...previous.filter((item) => item.id !== created.id),
      ]);
      setSelected(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setUploading(null);
      uploadLock.current = false;
      if (input.current) input.current.value = "";
    }
  }

  async function retry() {
    if (!project) return;
    setError("");
    try {
      const updated = await api<Project>(`/projects/${project.id}/process`, {
        method: "POST",
      });
      setProjects((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (updated.status === "completed") {
        setTranscript(
          await api<Transcript>(`/projects/${updated.id}/transcript`),
        );
        setTranscriptError("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not retry.");
    }
  }

  async function deleteProject() {
    if (!deleteTarget || deleteLock.current) return;
    const target = deleteTarget;
    deleteLock.current = true;
    setDeleting(true);
    setDeleteError("");
    // Release the selected media resource so Windows can remove the source file.
    if (selected === target.id) {
      clipPreview.stop();
      video.current?.pause();
      video.current?.removeAttribute("src");
      video.current?.load();
    }
    try {
      await api(`/projects/${target.id}`, { method: "DELETE" });
      deletedIds.current.add(target.id);
      setProjects((previous) =>
        previous.filter((item) => item.id !== target.id),
      );
      setSelected((previous) => (previous === target.id ? null : previous));
      setDeleteTarget(null);
      setNotice(`Deleted ${target.filename} and its local project data.`);
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? reason.message
          : "Project deletion failed. Retry after checking local storage.",
      );
      if (selected === target.id && video.current) {
        video.current.src = `/api/projects/${target.id}/video`;
        video.current.load();
      }
    } finally {
      deleteLock.current = false;
      setDeleting(false);
    }
  }

  async function retranscribe() {
    if (!project) return;
    setError("");
    clipPreview.stop();
    try {
      const updated = await api<Project>(
        `/projects/${project.id}/transcription`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        },
      );
      setProjects((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not re-transcribe.",
      );
    }
  }

  const segments =
    (transcript?.sentences ?? transcript?.segments)?.filter((segment) =>
      segment.text.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const stage = project
    ? ["queued", "extracting", "transcribing", "completed"].indexOf(
        project.status === "loading_model" ? "transcribing" : project.status === "saving" ? "transcribing" : project.status,
      )
    : -1;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setSelected(null);
          }}
          aria-label="ClipForge home"
        >
          <span className="brand-icon">
            <Layers2 size={23} />
          </span>
          ClipForge<span className="brand-dot">.</span>
        </a>
        <div className="version-label">
          LOCAL WORKSPACE <span>V0.2</span>
        </div>
        <button
          className={`nav-button ${!project ? "active" : ""}`}
          onClick={() => setSelected(null)}
        >
          <Film size={17} /> Workspace <ChevronRight size={14} />
        </button>
        <div className="project-heading">
          <span>YOUR PROJECTS</span>
          <span>{projects.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="project-list">
          {projects.length === 0 ? (
            <p className="sidebar-empty">
              Your videos will appear here.
              <br />
              Everything stays on this device.
            </p>
          ) : (
            projects.map((item) => (
              <div className="project-row" key={item.id}>
                <button
                  className={`project-item ${selected === item.id ? "selected" : ""}`}
                  onClick={() => setSelected(item.id)}
                >
                  <FileVideo size={16} />
                  <span>
                    <strong>{item.filename}</strong>
                    <small>{labels[item.status]}</small>
                  </span>
                  {busy(item) && <LoaderCircle size={13} className="spin" />}
                </button>
                <button
                  className="project-delete"
                  aria-label={`Delete project: ${item.filename}`}
                  title="Delete project"
                  disabled={
                    deleting ||
                    !connected ||
                    busy(item) ||
                    item.status === "deleting"
                  }
                  onClick={() => {
                    setDeleteError("");
                    setNotice("");
                    setDeleteTarget(item);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <HardDrive size={16} />
          <div>
            Stored on your device<small>No cloud. No subscriptions.</small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>{project ? "Transcription" : "Overview"}</span>
          </div>
          <div
            className={`engine ${connected && health?.status === "ready" ? "ready" : ""}`}
          >
            <span />
            {!connected
              ? "Engine disconnected"
              : health?.status === "ready"
                ? "Local engine ready"
                : "Engine needs setup"}
          </div>
        </header>
        <div className="workspace">
          {notice && (
            <div className="notice" role="status">
              <Check size={16} />
              <span>{notice}</span>
              <button
                className="text-button"
                aria-label="Dismiss deletion message"
                onClick={() => setNotice("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">VIDEO TO WORDS. ON YOUR MACHINE.</div>
              <h1>
                {project
                  ? "Your footage, transcribed."
                  : "Start with your footage."}
              </h1>
              <p>
                {project
                  ? "Review your video and jump to any moment in the transcript."
                  : "Turn spoken moments into a searchable, timestamped transcript."}
              </p>
            </div>
            <button
              className="primary"
              disabled={uploading !== null || !connected}
              onClick={() => input.current?.click()}
            >
              <Plus size={17} /> Import video
            </button>
          </div>
          <div className="transcription-options">
            <label>
              Speech language
              <select
                aria-label="Speech language"
                value={options.language}
                disabled={uploading !== null || (!!project && busy(project))}
                onChange={(event) =>
                  setOptions((previous) => ({
                    language: event.target.value as "auto" | "en",
                    quality: previous.quality,
                  }))
                }
              >
                <option value="auto">Auto Detect</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>
              Transcription quality
              <select
                aria-label="Transcription quality"
                value={options.quality}
                disabled={uploading !== null || (!!project && busy(project))}
                onChange={(event) =>
                  setOptions((previous) => ({
                    quality: event.target.value as "fast" | "accurate",
                    language: previous.language,
                  }))
                }
              >
                <option value="fast">
                  Fast · {health?.transcription_models?.fast ?? "base"}
                </option>
                <option
                  value="accurate"
                  disabled={!health?.quality_model_ready}
                >
                  Quality · {health?.transcription_models?.accurate ?? "small"}
                  {!health?.quality_model_ready ? " (not installed)" : ""}
                </option>
              </select>
            </label>
            {project && (
              <button
                className="secondary"
                disabled={!connected || busy(project)}
                onClick={() => void retranscribe()}
              >
                Re-transcribe
              </button>
            )}
            <p>
              {project
                ? "Re-transcribing replaces the transcript and resets clip suggestions after success."
                : "Quality uses the larger small model. Auto Detect also supports mixed-language speech. No words are added to uncertain gaps."}
            </p>
          </div>
          <input
            ref={input}
            aria-label="Choose MP4 video"
            type="file"
            accept=".mp4,video/mp4"
            className="sr-only"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          {!connected && (
            <div className="notice">
              <CircleAlert size={17} />
              <div>
                Local engine disconnected. Start the FastAPI backend on port
                8000. Saved projects will return when it reconnects.
              </div>
            </div>
          )}
          {connected && health?.status !== "ready" && (
            <div className="notice">
              <CircleAlert size={17} />
              <div>
                <strong>Finish local engine setup</strong>
                <br />
                {!health?.checks.ffmpeg || !health?.checks.ffprobe
                  ? "Install FFmpeg and ffprobe, add their bin folder to PATH, and restart the backend. "
                  : ""}
                {!health?.checks.model ? (
                  <>
                    Install the local model once:{" "}
                    <code>python scripts/download_model.py --model base</code>
                    .{" "}
                  </>
                ) : (
                  ""
                )}
                See the README for setup instructions.
              </div>
            </div>
          )}
          {error && (
            <div role="alert" className="notice error">
              <CircleAlert size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {uploading !== null && (
            <div className="upload-progress" role="status">
              <span>
                Uploading video to local storage <b>{uploading}%</b>
              </span>
              <progress value={uploading} max={100} />
            </div>
          )}
          <div className="editor-grid">
            <section className="panel footage-panel">
              <div className="panel-heading">
                <span>
                  <Film size={16} className="footage-color" /> Source video
                </span>
                <span className="micro-label">
                  {project ? "MP4" : "01 / IMPORT"}
                </span>
              </div>
              {project ? (
                <>
                  <div className="video-wrapper">
                    <video
                      key={project.id}
                      ref={video}
                      controls
                      preload="metadata"
                      src={`/api/projects/${project.id}/video`}
                      onTimeUpdate={(event) =>
                        setCurrentTime(event.currentTarget.currentTime)
                      }
                      onError={() => setVideoError(true)}
                    />
                  </div>
                  {clipPreview.range && (
                    <div className="range-preview-status" role="status">
                      <span>
                        Range preview{" "}
                        <code>
                          {timestamp(clipPreview.range.start)} –{" "}
                          {timestamp(clipPreview.range.end)}
                        </code>
                      </span>
                      <button
                        className="text-button"
                        onClick={clipPreview.stop}
                      >
                        Stop preview
                      </button>
                    </div>
                  )}
                  {videoError && (
                    <div className="notice">
                      Your browser cannot play this video's codec. Transcription
                      can still work; use an H.264/AAC MP4 for preview playback.
                    </div>
                  )}
                  <div className="file-details">
                    <FileVideo size={21} className="footage-color" />
                    <div>
                      <h3>{project.filename}</h3>
                      <p>
                        {(project.size / 1024 ** 2).toFixed(1)} MB{" "}
                        <span>·</span>{" "}
                        {project.metadata
                          ? `${project.metadata.width} × ${project.metadata.height}`
                          : "Reading metadata"}{" "}
                        {project.metadata && (
                          <>
                            <span>·</span>
                            <code>{timestamp(project.metadata.duration)}</code>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div
                  className={`dropzone ${dragging ? "dragging" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void upload(event.dataTransfer.files[0]);
                  }}
                >
                  <div className="upload-symbol">
                    <Upload size={30} strokeWidth={1.4} />
                  </div>
                  <h2>Give your footage a voice.</h2>
                  <p>
                    Drop an MP4 here to get started,
                    <br />
                    or choose a video from your computer.
                  </p>
                  <button
                    className="secondary"
                    disabled={uploading !== null || !connected}
                    onClick={() => input.current?.click()}
                  >
                    Choose video <ArrowUpRight size={15} />
                  </button>
                  <span className="file-hint">
                    MP4 · UP TO{" "}
                    {Math.round(
                      (health?.max_upload_bytes ?? 2 * 1024 ** 3) / 1024 ** 2,
                    )}{" "}
                    MB
                  </span>
                </div>
              )}
              <div className="processing-block">
                <div className="section-label">
                  <Activity size={15} /> PROCESSING PIPELINE{" "}
                  <span>
                    {project ? labels[project.status] : "Waiting for a video"}
                  </span>
                </div>
                <div className="stages">
                  {["In queue", "Prepare", "Transcribe", "Ready"].map(
                    (name, index) => (
                      <div
                        key={name}
                        className={stage >= index ? "reached" : ""}
                      >
                        <span>
                          {stage > index || project?.status === "completed" ? (
                            <Check size={12} />
                          ) : (
                            index + 1
                          )}
                        </span>
                        {name}
                      </div>
                    ),
                  )}
                </div>
                {project && busy(project) && (
                  <div
                    className="indeterminate"
                    role="status"
                    aria-label={labels[project.status]}
                  >
                    <span />
                  </div>
                )}
                {project && <ProcessingStatus project={project} connected={connected} onCancel={async () => { try { await api(`/projects/${project.id}/cancel`, {method: "POST"}); } catch (reason) { setError(reason instanceof Error ? reason.message : "Cancellation failed."); } }} />}
                {project?.warning && (
                  <p className="warning-text">{project.warning}</p>
                )}
                {project?.error && (
                  <div className="job-error" role="alert">
                    <p>{project.error}</p>
                    {project.status !== "deletion_failed" &&
                      project.status !== "deleting" && (
                        <button
                          className="secondary"
                          onClick={() => void retry()}
                          disabled={!connected}
                        >
                          Retry processing
                        </button>
                      )}
                  </div>
                )}
              </div>
            </section>

            <section className="panel transcript-panel">
              <div className="panel-heading">
                <span>
                  <Activity size={16} className="dialogue-color" /> Transcript
                </span>
                <span className="micro-label">
                  {transcript
                    ? `${transcript.language.toUpperCase()} / ${transcript.segments.length} SEGMENTS`
                    : "02 / REVIEW"}
                </span>
              </div>
              {transcript ? (
                <>
                  {!!transcript.uncertain_ranges?.length && (
                    <div className="notice">
                      <CircleAlert size={16} />
                      <span>
                        {transcript.uncertain_ranges.length} uncertain spans
                        excluded from the sentence view and clip discovery.
                        Review the original audio; no replacement words were
                        added.
                      </span>
                    </div>
                  )}
                  <label className="search">
                    <Search size={15} />
                    <input
                      aria-label="Search transcript"
                      placeholder="Find in transcript…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <div className="transcript-list">
                    {segments.length ? (
                      segments.map((segment) => (
                        <button
                          key={segment.id}
                          className={`segment ${currentTime >= segment.start && currentTime < segment.end ? "playing" : ""}`}
                          onClick={() => {
                            clipPreview.stop();
                            if (video.current) {
                              video.current.currentTime = segment.start;
                              setCurrentTime(segment.start);
                            }
                          }}
                          aria-label={`Seek to ${timestamp(segment.start)}: ${segment.text}`}
                        >
                          <code>
                            {timestamp(segment.start)}
                            <span>{timestamp(segment.end)}</span>
                          </code>
                          <span>{segment.text}</span>
                        </button>
                      ))
                    ) : (
                      <div className="transcript-empty">
                        <p>
                          {query
                            ? "No matching segments."
                            : "No speech was detected in this video."}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="transcript-footer">
                    <ShieldCheck size={14} /> Saved locally{" "}
                    <span>
                      {transcript.device.toUpperCase()} · WORD TIMESTAMPS
                    </span>
                  </div>
                </>
              ) : (
                <div className="transcript-empty">
                  <div className="transcript-illustration">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <h3>
                    {transcriptError
                      ? "Transcript unavailable"
                      : project && busy(project)
                        ? "Listening to your footage."
                        : "Every word, in its place."}
                  </h3>
                  <p>
                    {transcriptError ||
                      (project && busy(project)
                        ? "Your local engine is processing this video. Timestamped segments will appear here when complete."
                        : "Your transcript will appear here after processing. Click any segment to find that moment in your video.")}
                  </p>
                  {transcriptError && (
                    <button className="secondary" onClick={() => void retry()}>
                      Retry processing
                    </button>
                  )}
                  <div className="empty-tag">
                    <span className="dialogue-dot" /> TIMESTAMPED DIALOGUE
                  </div>
                </div>
              )}
            </section>
          </div>
          {project && project.status === "completed" && (
            <CategoryDisplay
              projectId={project.id}
              detectedCategory={project.detected_category}
              userCategory={project.user_category}
              confidence={project.category_confidence ? parseFloat(project.category_confidence) : undefined}
              contentProfile={project.content_profile}
              onCategoryChange={async () => {
                // Refresh project list to get updated category
                const nextProjects = await api<Project[]>("/projects");
                setProjects(nextProjects);
              }}
            />
          )}
          {project && (
            <DiscoveryPanel
              key={`${project.id}:${project.status}`}
              projectId={project.id}
              ready={project.status === "completed"}
              duration={project.metadata?.duration ?? 0}
              connected={connected}
              previewing={!!clipPreview.range}
              onStop={clipPreview.stop}
              onPreview={previewClip}
              onSeek={seekClip}
            />
          )}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={14} /> Your footage stays yours. Processing
              happens entirely on this device.
            </span>
            <span>
              CLIPFORGE CORE <span className="footer-divider">/</span> PHASE 02
            </span>
          </footer>
        </div>
      </main>
      {deleteTarget && (
        <DeleteProjectDialog
          project={deleteTarget}
          deleting={deleting}
          error={deleteError}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void deleteProject()}
        />
      )}
    </div>
  );
}


function ProcessingStatus({project, connected, onCancel}: {project: Project; connected: boolean; onCancel: () => Promise<void>}) {
  const [now, setNow] = useState(Date.now());
  const [requesting, setRequesting] = useState(false);
  const active = busy(project), info = project.processing;
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const elapsed = active && info?.started_at ? Math.max(0, now / 1000 - info.started_at) : info?.elapsed_seconds;
  return <div className="processing-detail">
    {elapsed !== undefined && <p>{Math.floor(elapsed)}s elapsed{info?.model ? ` · ${info.model}` : ""}{info?.device ? ` · ${info.device.toUpperCase()} / ${info.compute_type ?? ""}` : ""}</p>}
    {active && info?.total_seconds && <p>Timed speech processed: {Math.floor(info.processed_seconds ?? 0)} / {Math.ceil(info.total_seconds)}s of source video</p>}
    {active && !connected && <p role="alert">Connection interrupted. Reconnecting to retrieve job status; processing may still be running.</p>}
    {active && connected && info?.heartbeat_at && now/1000-info.heartbeat_at > 15 && <p role="alert">Job updates are delayed. The engine may be busy or interrupted; no completion is assumed.</p>}
    {active && <button className="secondary" disabled={!connected || requesting || info?.cancel_requested || project.status === "saving"} onClick={async () => { setRequesting(true); try { await onCancel(); } finally { setRequesting(false); } }}>{info?.cancel_requested ? "Cancel requested — waiting for current operation" : "Cancel processing"}</button>}
    {project.status === "cancelled" && <p>Processing cancelled. The uploaded video is retained; use Re-transcribe to try again.</p>}
  </div>;
}
