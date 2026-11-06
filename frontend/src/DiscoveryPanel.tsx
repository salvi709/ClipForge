import { Fragment, memo, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Download,
  LoaderCircle,
  Play,
  ScanText,
  StopCircle,
} from "lucide-react";
import { api, Clip, DiscoveryHealth, DiscoveryResult, DiscoveryOptions, timestamp, exportClip, downloadExport } from "./api";

const stages: Record<string, string> = {
  queued: "Waiting for local engine",
  preparing_transcript: "Preparing transcript",
  analyzing_topics: "Analyzing transcript",
  generating_candidates: "Generating candidate clips",
  validating_timestamps: "Validating timestamps",
  evaluating_candidates: "Assessing candidates with local AI",
  ranking_clips: "Ranking suggestions",
  saving_results: "Saving results",
};
const presets = { short: [15, 30], standard: [30, 60], long: [60, 90] } as const;
type Preset = keyof typeof presets | "custom";
const presetFor = (options: DiscoveryOptions): Preset => (Object.keys(presets) as (keyof typeof presets)[]).find(key => presets[key][0] === options.min_seconds && presets[key][1] === options.max_seconds) ?? "custom";
type Props = {
  projectId: string;
  ready: boolean;
  duration: number;
  connected: boolean;
  previewing: boolean;
  onPreview: (start: number, end: number) => Promise<void>;
  onStop: () => void;
  onSeek: (start: number) => void;
};

function DiscoveryPanel({
  projectId,
  ready,
  duration,
  connected,
  previewing,
  onPreview,
  onStop,
  onSeek,
}: Props) {
  const [result, setResult] = useState<DiscoveryResult>({
    status: "idle",
    clips: [],
  });
  const [health, setHealth] = useState<DiscoveryHealth | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestLock = useRef(false);
  const revision = useRef(0);
  const hydrated = useRef(false);
  const [options, setOptions] = useState<DiscoveryOptions>({ clip_count: 5, min_seconds: 30, max_seconds: 60 });
  const [preset, setPreset] = useState<Preset>("standard");
  const [range, setRange] = useState({ min: "30", max: "60" });
  const [pollError, setPollError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const effective = { ...options, min_seconds: Number(range.min), max_seconds: Number(range.max) };
  const validation = !range.min.trim() || !range.max.trim() || !Number.isFinite(effective.min_seconds) || !Number.isFinite(effective.max_seconds) || effective.min_seconds < 5 || effective.max_seconds > 120 || effective.min_seconds >= effective.max_seconds
    ? "Choose durations from 5 to 120 seconds, with minimum smaller than maximum."
    : ready && duration < effective.min_seconds ? `This video is ${duration.toFixed(1)}s long, shorter than the ${effective.min_seconds}s minimum. Choose a shorter duration.` : "";
  const active = !!stages[result.status];

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      const version = revision.current;
      let delay = 10000;
      try {
        const saved = await api<DiscoveryResult>(
          `/projects/${projectId}/discovery`,
          { signal: controller.signal },
        );
        if (alive && version === revision.current && !requestLock.current) {
          setResult(previous => JSON.stringify(previous) === JSON.stringify(saved) ? previous : saved);
          setPollError("");
          if (saved.settings && (!hydrated.current || !!stages[saved.status])) {
            const settings = saved.settings;
            setOptions(previous => JSON.stringify(previous) === JSON.stringify(settings) ? previous : settings);
            setPreset(presetFor(settings));
            setRange(previous => previous.min === String(settings.min_seconds) && previous.max === String(settings.max_seconds) ? previous : { min: String(settings.min_seconds), max: String(settings.max_seconds) });
          }
          hydrated.current = true;
        }
        if (stages[saved.status]) delay = 1500;
      } catch (reason) {
        if (alive)
          setPollError(
            reason instanceof Error
              ? reason.message
              : "Could not load clip suggestions.",
          );
        delay = 3000;
      }
      if (alive) timer = setTimeout(refresh, delay);
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, ready, active]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const next = await api<DiscoveryHealth>("/discovery/health");
        if (alive) setHealth(next);
      } catch {
        if (alive) setHealth(null);
      }
      if (alive) timer = setTimeout(check, 10000);
    }
    void check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  async function findClips() {
    if (requestLock.current || validation || active) return;
    requestLock.current = true;
    revision.current += 1;
    hydrated.current = true;
    setSubmitting(true);
    setError("");
    onStop();
    try {
      const next = await api<DiscoveryResult>(
        `/projects/${projectId}/discovery`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(effective) },
      );
      setResult(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not start discovery.",
      );
    } finally {
      requestLock.current = false;
      setSubmitting(false);
    }
  }

  async function save(clip: Clip, start: number, end: number) {
    revision.current += 1;
    onStop();
    const next = await api<DiscoveryResult>(
      `/projects/${projectId}/clips/${clip.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end }),
      },
    );
    setResult(next);
  }

  async function cancel() {
    setCancelling(true); setError(""); revision.current += 1;
    try { setResult(await api<DiscoveryResult>(`/projects/${projectId}/discovery/cancel`, { method: "POST" })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel discovery."); }
    finally { setCancelling(false); }
  }

  return (
    <section className="panel discovery-panel" aria-label="Best clips">
      <div className="discovery-heading">
        <div>
          <h2>
            <ScanText size={19} className="ai-color" /> Best moments
          </h2>
          <p>
            Useful explanations. Complete thoughts. Selected from your
            transcript.
          </p>
        </div>
        <button
          className="primary"
          disabled={!ready || !connected || active || submitting || !!validation}
          onClick={() => void findClips()}
        >
          {active || submitting ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <ScanText size={16} />
          )}{" "}
          Find Best Clips
        </button>
      </div>
      <fieldset className="discovery-options" disabled={active || submitting || !ready}>
        <legend>Discovery settings</legend>
        <label className="clip-count">Number of clips <output htmlFor="clip-count">{options.clip_count}</output>
          <input id="clip-count" aria-label="Number of clips" type="range" min="1" max="10" value={options.clip_count}
            onChange={event => { hydrated.current = true; setOptions({ ...options, clip_count: Number(event.target.value) }); }} />
          <span className="range-labels"><span>1</span><span>10</span></span>
        </label>
        <label>Clip duration
          <select aria-label="Clip duration" value={preset} onChange={event => {
            hydrated.current = true; const next = event.target.value as Preset; setPreset(next);
            if (next !== "custom") setRange({ min: String(presets[next][0]), max: String(presets[next][1]) });
          }}>
            <option value="short">Short · 15–30 seconds</option><option value="standard">Standard · 30–60 seconds</option>
            <option value="long">Long · 60–90 seconds</option><option value="custom">Custom duration</option>
          </select>
        </label>
        {preset === "custom" && <div className="custom-duration">
          <label>Minimum (seconds)<input aria-label="Minimum clip duration" type="number" min="5" max="120" step="0.1" value={range.min} onChange={e => { hydrated.current = true; setRange({ ...range, min: e.target.value }); }} /></label>
          <label>Maximum (seconds)<input aria-label="Maximum clip duration" type="number" min="5" max="120" step="0.1" value={range.max} onChange={e => { hydrated.current = true; setRange({ ...range, max: e.target.value }); }} /></label>
        </div>}
        <p>Quality over quantity. We’ll return up to {options.clip_count} distinct, useful moments within your duration range.</p>
      </fieldset>
      {validation && ready && <p role="alert" className="warning-text">{validation}</p>}
      {ready && !validation && effective.max_seconds > duration && <p className="ranking-note">The video ends at {duration.toFixed(1)}s; every suggestion will stay within it.</p>}
      <div className="discovery-meta">
        <span className="ai-color">{health?.model ?? result.model ?? "Local Ollama"}</span>
        <span>
          Scores are heuristic estimates, not guaranteed audience performance.
        </span>
      </div>
      {!ready && (
        <p className="discovery-message">
          Complete transcription to discover moments from this video.
        </p>
      )}
      {ready &&
        health &&
        health.status !== "ready" &&
        result.status !== "completed" && (
          <div className="notice">
            <CircleAlert size={16} />
            <span>
              {health.message} No model downloads happen automatically.
            </span>
          </div>
        )}
      {(error || result.error) && (
        <div role="alert" className="notice error">
          <CircleAlert size={16} />
          <span>{error || result.error}</span>
        </div>
      )}
      {pollError && <p role="alert" className="warning-text">Connection interrupted. Retrying job status; processing may still be running. {pollError}</p>}
      {result.status !== "idle" && <DiscoveryProgress result={result} active={active} connected={connected && !pollError} cancelling={cancelling} onCancel={cancel} />}
      {result.message && <p className="discovery-message">{result.message}</p>}
      {!!result.clips?.length && (
        <>
          <div className="results-heading"><h3>{result.previous_result ? "Previous completed suggestions" : "Ranked suggestions"}</h3>
            {result.result_settings && <span>{result.clips.length} / {result.result_settings.clip_count} requested · {result.result_settings.min_seconds}–{result.result_settings.max_seconds}s</span>}
          </div>
          {result.previous_result && <p className="ranking-note">These are saved results from the previous completed analysis. They have not been replaced by this attempt.</p>}
          <div className="ranking-note">
            Score = 40% information + 35% completeness + {Math.round((result.score_weights?.clarity ?? .10) * 100)}% clarity + {Math.round((result.score_weights?.hook_strength ?? .15) * 100)}% hook. Each criterion is rated 0–5. New educational analyses do not require exciting hooks.
          </div>
          <div className="clip-grid">
            {result.clips.map((clip, index) => (
              <Fragment key={clip.id}>
              {clip.confidence === "lower" && (index === 0 || result.clips[index - 1].confidence !== "lower") && <div className="confidence-heading"><h3>Lower-confidence suggestions</h3><p>These passed timing validation but not the strong-clip criteria. Review the transcript, completeness and model explanation before using them.</p></div>}
              <ClipCard
                key={clip.id}
                clip={clip}
                projectId={projectId}
                editable={!active && result.status === "completed"}
                duration={duration}
                selected={selected === clip.id}
                onSelect={() => {
                  setSelected(clip.id);
                  onSeek(clip.start);
                }}
                onPreview={async () => {
                  setSelected(clip.id);
                  setError("");
                  try {
                    await onPreview(clip.start, clip.end);
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Preview failed.",
                    );
                  }
                }}
                onSave={(start, end) => save(clip, start, end)}
              />
              </Fragment>
            ))}
          </div>
        </>
      )}
      {previewing && (
        <button className="secondary preview-stop" onClick={onStop}>
          <StopCircle size={15} /> Stop range preview
        </button>
      )}
    </section>
  );
}

function DiscoveryProgress({ result, active, connected, cancelling, onCancel }: { result: DiscoveryResult; active: boolean; connected: boolean; cancelling: boolean; onCancel: () => Promise<void> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const info = result.progress;
  const start = info?.started_at ?? info?.queued_at;
  const elapsed = active && start ? Math.max(0, now / 1000 - start) : info?.elapsed_seconds;
  const measured = result.status === "evaluating_candidates" && !!result.total;
  return <div className="discovery-progress" aria-label="Discovery progress">
    <div className="progress-heading" role="status"><span>{active && <LoaderCircle size={14} className="spin" />} {stages[result.status] ?? ({ completed: "Analysis completed", failed: "Analysis failed", cancelled: "Analysis cancelled", stale: "Analysis needs updating" }[result.status] ?? result.status)}</span>
      {elapsed !== undefined && <span>{Math.floor(elapsed)}s elapsed</span>}
    </div>
    {active && <>
      <ol className="discovery-stage-list">{Object.entries(stages).filter(([key]) => key !== "queued").map(([key, label]) => <li key={key} className={info?.completed_stages?.includes(key) ? "done" : result.status === key ? "current" : ""} aria-current={result.status === key ? "step" : undefined}>{label}</li>)}</ol>
      {measured ? <><p>{result.evaluated ?? 0} of {result.total} candidates assessed · {Math.floor((result.evaluated ?? 0) / result.total! * 100)}% of assessment stage</p><progress aria-label="Candidates assessed" max={result.total} value={result.evaluated ?? 0} /></> : <div className="indeterminate"><span /></div>}
      {info?.heartbeat_at && connected && now / 1000 - info.heartbeat_at > 15 && <p role="alert">Engine updates are delayed. Waiting for confirmed job status.</p>}
      {info?.cancel_requested && <p>Cancellation requested. Waiting for the current local AI request to return or time out; new results will not be saved.</p>}
      <button className="secondary" disabled={!connected || cancelling || info?.cancel_requested || result.status === "saving_results"} onClick={() => void onCancel()}>Cancel discovery</button>
    </>}
    {result.status === "cancelled" && <p>No new suggestions were saved. Adjust settings and try again when ready.</p>}
  </div>;
}

export default memo(DiscoveryPanel);

function ClipCard({
  clip,
  projectId,
  duration,
  selected,
  onSelect,
  onPreview,
  onSave,
  editable,
}: {
  clip: Clip;
  projectId: string;
  duration: number;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => Promise<void>;
  onSave: (start: number, end: number) => Promise<void>;
  editable: boolean;
}) {
  const [start, setStart] = useState(String(clip.start));
  const [end, setEnd] = useState(String(clip.end));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  
  useEffect(() => {
    setStart(String(clip.start));
    setEnd(String(clip.end));
  }, [clip.start, clip.end]);
  
  async function handleDownload() {
    if (exporting) return;
    
    setExporting(true);
    setError("");
    setExportSuccess(false);
    
    try {
      // Use accurate strategy for adjusted clips, fast for originals
      const strategy = clip.adjusted ? "accurate" : "fast";
      const result = await exportClip(projectId, clip.id, strategy);
      
      // Trigger browser download
      downloadExport(projectId, result.export_id, result.filename);
      
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Export failed. Check that FFmpeg is available."
      );
    } finally {
      setExporting(false);
    }
  }
  
  async function persist(reset = false) {
    const a = reset ? clip.original_start : Number(start),
      b = reset ? clip.original_end : Number(end);
    if (
      !start.trim() ||
      !end.trim() ||
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a < 0 ||
      b - a < 1 ||
      b > duration
    ) {
      setError("Choose a range of at least one second within the video.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(a, b);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save range.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className={`clip-card ${clip.rank === 1 && clip.confidence !== "lower" ? "strongest" : ""} ${selected ? "selected" : ""}`}>
      <div className="clip-card-heading">
        <span className="clip-rank">{String(clip.rank).padStart(2, "0")}</span>
        <button className="clip-title" onClick={onSelect}>
          {clip.title}
          {clip.rank === 1 && clip.confidence !== "lower" && <small className="top-pick">Top ranked</small>}
        </button>
        <div className="clip-score">
          {clip.score}
          <small>/ 100</small>
        </div>
      </div>
      <div className="clip-time">
        <code>
          {timestamp(clip.start)} – {timestamp(clip.end)}
        </code>
        <span>
          {clip.duration.toFixed(1)} sec
          {clip.duration_exception ? " · sentence-length exception" : ""}
        </span>
      </div>
      <p className="clip-reason">{clip.reason}</p>
      {clip.confidence === "lower" && <p className="ranking-note">Lower confidence · {clip.quality_rejections?.map(reason => reason.replaceAll("_", " ")).join("; ")}</p>}
      <dl className="clip-criteria">
        <div>
          <dt>Hook</dt>
          <dd>{clip.criteria.hook_strength}/5</dd>
        </div>
        <div>
          <dt>Information</dt>
          <dd>{clip.criteria.informational_value}/5</dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>{clip.criteria.context_completeness}/5</dd>
        </div>
        <div>
          <dt>Clarity</dt>
          <dd>{clip.criteria.clarity}/5</dd>
        </div>
      </dl>
      <div className="clip-actions">
        <button className="secondary" onClick={() => void onPreview()}>
          <Play size={14} /> Preview clip {clip.rank}
        </button>
        <button 
          className="primary" 
          onClick={() => void handleDownload()}
          disabled={exporting}
          title={clip.adjusted ? "Download (re-encoded for accuracy)" : "Download (fast stream copy)"}
        >
          {exporting ? (
            <><LoaderCircle size={14} className="spin" /> Exporting...</>
          ) : exportSuccess ? (
            <><Download size={14} /> Downloaded!</>
          ) : (
            <><Download size={14} /> Download MP4</>
          )}
        </button>
        <button className="text-button" onClick={onSelect}>
          Transcript & timing
        </button>
      </div>
      {selected && (
        <div className="clip-details">
          <p className="clip-excerpt">{clip.excerpt}</p>
          <p className="clip-evidence">Selection evidence: “{clip.evidence}”</p>
          <div className="clip-edit">
            <label>
              Start (seconds)
              <input
                aria-label={`Clip ${clip.rank} start seconds`}
                type="number"
                min={0}
                max={duration}
                step="0.01"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              End (seconds)
              <input
                aria-label={`Clip ${clip.rank} end seconds`}
                type="number"
                min={0}
                max={duration}
                step="0.01"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <button
              className="secondary"
              disabled={saving || !editable}
              onClick={() => void persist()}
            >
              Save range
            </button>
            <button
              className="text-button"
              disabled={saving || !editable}
              onClick={() => void persist(true)}
            >
              Reset
            </button>
          </div>
          {error && (
            <p role="alert" className="warning-text">
              {error}
            </p>
          )}
          {clip.adjusted && (
            <p className="ranking-note">
              Timing adjusted. The score, reason and evidence refer to the
              original suggested range.
            </p>
          )}
        </div>
      )}
    </article>
  );
}
