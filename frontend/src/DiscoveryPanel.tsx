import { Fragment, memo, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bookmark,
  Check,
  CircleAlert,
  Download,
  LoaderCircle,
  Play,
  PlusCircle,
  ScanText,
  Sparkles,
  StopCircle,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  Clip,
  ClipFeedbackRating,
  ClipFeedbackAction,
  DiscoveryHealth,
  DiscoveryResult,
  DiscoveryOptions,
  FeedbackStats,
  ManualClip,
  timestamp,
  exportClip,
  downloadExport,
  submitClipFeedback,
  createManualClip,
  getManualClips,
  deleteManualClip,
  getFeedbackStats,
} from "./api";

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

  // Discovery V2 state
  const [showMore, setShowMore] = useState(false);
  const [manualClips, setManualClips] = useState<ManualClip[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualError, setManualError] = useState("");
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);

  const effective = { ...options, min_seconds: Number(range.min), max_seconds: Number(range.max) };
  const validation = !range.min.trim() || !range.max.trim() || !Number.isFinite(effective.min_seconds) || !Number.isFinite(effective.max_seconds) || effective.min_seconds < 5 || effective.max_seconds > 120 || effective.min_seconds >= effective.max_seconds
    ? "Choose durations from 5 to 120 seconds, with minimum smaller than maximum."
    : ready && duration < effective.min_seconds ? `This video is ${duration.toFixed(1)}s long, shorter than the ${effective.min_seconds}s minimum. Choose a shorter duration.` : "";
  const active = !!stages[result.status];

  async function loadFeedbackAndManual() {
    if (!ready || !projectId) return;
    try {
      const [mClips, stats] = await Promise.all([
        getManualClips(projectId).catch(() => []),
        getFeedbackStats(projectId).catch(() => null),
      ]);
      if (Array.isArray(mClips)) {
        setManualClips(mClips.filter(m => m && typeof m.start === "number" && typeof m.end === "number"));
      }
      if (stats && stats.user_feedback_metrics) setFeedbackStats(stats);
    } catch {
      // non-blocking
    }
  }

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
    void loadFeedbackAndManual();
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
      void loadFeedbackAndManual();
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
    void loadFeedbackAndManual();
  }

  async function cancel() {
    setCancelling(true); setError(""); revision.current += 1;
    try { setResult(await api<DiscoveryResult>(`/projects/${projectId}/discovery/cancel`, { method: "POST" })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel discovery."); }
    finally { setCancelling(false); }
  }

  async function handleAddManualClip() {
    setManualError("");
    const s = Number(manualStart);
    const e = Number(manualEnd);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s || e > duration || e - s < 1) {
      setManualError(`Enter a valid range between 0 and ${duration.toFixed(1)}s (min 1 second).`);
      return;
    }
    try {
      const created = await createManualClip(projectId, {
        start: s,
        end: e,
        title: manualTitle.trim() || 'Manual Moment',
        notes: manualNotes.trim() || undefined,
      });
      setManualClips(prev => [...prev, created]);
      setManualStart("");
      setManualEnd("");
      setManualTitle("");
      setManualNotes("");
      setShowManualForm(false);
      void loadFeedbackAndManual();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Could not save manual moment.');
    }
  }

  const topPicks = (result.top_picks && result.top_picks.length > 0) ? result.top_picks : (result.clips || []);
  const moreDiscoveries = result.more_discoveries || [];

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
      {!!topPicks.length && (
        <>
          <div className="results-heading"><h3>{result.previous_result ? "Previous completed suggestions" : "Top Picks"}</h3>
            {result.result_settings && <span>{topPicks.length} / {result.result_settings.clip_count} requested · {result.result_settings.min_seconds}–{result.result_settings.max_seconds}s</span>}
          </div>
          {result.previous_result && <p className="ranking-note">These are saved results from the previous completed analysis. They have not been replaced by this attempt.</p>}
          <div className="ranking-note">
            Score = 40% information + 35% completeness + {Math.round((result.score_weights?.clarity ?? .10) * 100)}% clarity + {Math.round((result.score_weights?.hook_strength ?? .15) * 100)}% hook. Each criterion is rated 0–5.
          </div>
          <div className="clip-grid">
            {topPicks.map((clip, index) => (
              <Fragment key={clip.id}>
              {clip.confidence === "lower" && (index === 0 || topPicks[index - 1].confidence !== "lower") && <div className="confidence-heading"><h3>Lower-confidence suggestions</h3><p>These passed timing validation but not the strong-clip criteria. Review the transcript, completeness and model explanation before using them.</p></div>}
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
                onFeedbackSubmitted={() => void loadFeedbackAndManual()}
              />
              </Fragment>
            ))}
          </div>

          {moreDiscoveries.length > 0 && (
            <div className="more-discoveries-container">
              <button
                type="button"
                className="more-discoveries-toggle"
                onClick={() => setShowMore(prev => !prev)}
                aria-expanded={showMore}
              >
                <span><Sparkles size={16} /> More Discoveries ({moreDiscoveries.length} candidate moments)</span>
                <span>{showMore ? "▲ Hide secondary" : "▼ Explore more"}</span>
              </button>
              {showMore && (
                <div className="clip-grid" style={{ marginTop: 14 }}>
                  {moreDiscoveries.map(clip => (
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
                      onFeedbackSubmitted={() => void loadFeedbackAndManual()}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {ready && (
        <div className="manual-moments-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4><Bookmark size={15} /> Manually Marked Moments ({manualClips.length})</h4>
            <button
              type="button"
              className="secondary"
              style={{ padding: "4px 10px", fontSize: 11 }}
              onClick={() => setShowManualForm(prev => !prev)}
            >
              <PlusCircle size={13} /> {showManualForm ? "Cancel" : "Mark Missed Moment"}
            </button>
          </div>
          {showManualForm && (
            <div className="manual-moment-form">
              <label>Title
                <input
                  type="text"
                  placeholder="e.g. Critical Explanation"
                  value={manualTitle}
                  onChange={e => setManualTitle(e.target.value)}
                />
              </label>
              <label>Start (sec)
                <input
                  type="number"
                  min={0}
                  max={duration}
                  step="0.1"
                  value={manualStart}
                  onChange={e => setManualStart(e.target.value)}
                />
              </label>
              <label>End (sec)
                <input
                  type="number"
                  min={0}
                  max={duration}
                  step="0.1"
                  value={manualEnd}
                  onChange={e => setManualEnd(e.target.value)}
                />
              </label>
              <label style={{ flex: 1 }}>Notes (optional)
                <input
                  type="text"
                  placeholder="Why this was missed or valuable"
                  value={manualNotes}
                  onChange={e => setManualNotes(e.target.value)}
                />
              </label>
              <button type="button" className="primary" onClick={() => void handleAddManualClip()}>
                Save Moment
              </button>
              {manualError && <p role="alert" className="warning-text" style={{ flexBasis: "100%", margin: 0 }}>{manualError}</p>}
            </div>
          )}
          {manualClips.length > 0 && (
            <div className="manual-clips-list">
              {manualClips.map(m => (
                <div key={m.id} className="manual-clip-item">
                  <div>
                    <strong>{m.title}</strong>
                    <span style={{ color: "#709fd0", marginLeft: 10, fontFamily: "JetBrains Mono" }}>
                      {timestamp(m.start ?? 0)} – {timestamp(m.end ?? 0)} ({((m.duration ?? ((m.end ?? 0) - (m.start ?? 0))) || 0).toFixed(1)}s)
                    </span>
                    {m.notes && <span style={{ color: "#92979e", marginLeft: 8 }}>· {m.notes}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="secondary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => void onPreview(m.start, m.end)}>
                      <Play size={12} /> Preview
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      style={{ color: "#f87171" }}
                      onClick={async () => {
                        await deleteManualClip(projectId, m.id);
                        setManualClips(prev => prev.filter(x => x.id !== m.id));
                        void loadFeedbackAndManual();
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {feedbackStats?.user_feedback_metrics && (
        <details className="evaluation-drawer">
          <summary><BarChart3 size={15} /> Discovery Evaluation & Quality Metrics</summary>
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-label">Top-3 Acceptance</div>
              <div className="metric-value">
                {feedbackStats.user_feedback_metrics.human_evaluation
                  ? `${Math.round(feedbackStats.user_feedback_metrics.human_evaluation.top_3_acceptance_rate * 100)}%`
                  : "No rating"}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Precision@3</div>
              <div className="metric-value">
                {feedbackStats.user_feedback_metrics.human_evaluation
                  ? `${Math.round(feedbackStats.user_feedback_metrics.human_evaluation.precision_at_3 * 100)}%`
                  : "No rating"}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Human Quality</div>
              <div className="metric-value">
                {feedbackStats.user_feedback_metrics.human_evaluation
                  ? `${feedbackStats.user_feedback_metrics.human_evaluation.human_rated_quality}/100`
                  : "Unrated"}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Boundary Accuracy</div>
              <div className="metric-value">
                {feedbackStats.user_feedback_metrics.human_evaluation?.boundary_accuracy_percent !== undefined && feedbackStats.user_feedback_metrics.human_evaluation.boundary_accuracy_percent !== null
                  ? `${Math.round(feedbackStats.user_feedback_metrics.human_evaluation.boundary_accuracy_percent)}%`
                  : "Exact"}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Timeline Coverage</div>
              <div className="metric-value">
                {feedbackStats.user_feedback_metrics.heuristic_estimates?.candidate_timeline_coverage_ratio !== undefined
                  ? `${Math.round(feedbackStats.user_feedback_metrics.heuristic_estimates.candidate_timeline_coverage_ratio * 100)}%`
                  : "—"}
              </div>
            </div>
            {feedbackStats.reference_comparison?.has_reference && (
              <div className="metric-box">
                <div className="metric-label">Reference Recall / F1</div>
                <div className="metric-value">
                  {`${Math.round((feedbackStats.reference_comparison.f1_score || 0) * 100)}%`}
                </div>
              </div>
            )}
          </div>
          <p className="metric-disclaimer">
            {feedbackStats.user_feedback_metrics.human_evaluation
              ? "Human metrics reflect verified user ratings and acceptance. Internal scores are heuristic estimates."
              : feedbackStats.user_feedback_metrics.heuristic_estimates?.disclaimer}
          </p>
        </details>
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
  onFeedbackSubmitted,
}: {
  clip: Clip;
  projectId: string;
  duration: number;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => Promise<void>;
  onSave: (start: number, end: number) => Promise<void>;
  editable: boolean;
  onFeedbackSubmitted?: () => void;
}) {
  const [start, setStart] = useState(String(clip.start));
  const [end, setEnd] = useState(String(clip.end));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Human feedback state
  const [userRating, setUserRating] = useState<ClipFeedbackRating | null>(null);
  const [userAction, setUserAction] = useState<ClipFeedbackAction | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  
  useEffect(() => {
    setStart(String(clip.start));
    setEnd(String(clip.end));
  }, [clip.start, clip.end]);

  async function handleFeedback(rating?: ClipFeedbackRating, action?: ClipFeedbackAction) {
    if (feedbackLoading) return;
    setFeedbackLoading(true);
    try {
      await submitClipFeedback(projectId, clip.id, {
        rating: rating || userRating || undefined,
        action: action || userAction || undefined,
        original_start: clip.original_start,
        original_end: clip.original_end,
        adjusted_start: clip.adjusted ? clip.start : undefined,
        adjusted_end: clip.adjusted ? clip.end : undefined,
        scoring_factors: clip.scoring_factors,
      });
      if (rating) setUserRating(rating);
      if (action) setUserAction(action);
      setFeedbackStatus("Saved ✓");
      setTimeout(() => setFeedbackStatus(""), 2500);
      onFeedbackSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save feedback.");
    } finally {
      setFeedbackLoading(false);
    }
  }
  
  async function handleDownload() {
    if (exporting) return;
    
    setExporting(true);
    setError("");
    setExportSuccess(false);
    
    try {
      const strategy = clip.adjusted ? "accurate" : "fast";
      const result = await exportClip(projectId, clip.id, strategy);
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

      {/* Human Feedback Controls (Phase 5) */}
      <div className="clip-feedback-controls">
        <div className="feedback-group">
          <span className="feedback-label">Rating:</span>
          {(['excellent', 'good', 'average', 'bad'] as ClipFeedbackRating[]).map((r) => (
            <button
              key={r}
              type="button"
              className={`feedback-btn rating-btn ${userRating === r ? "active" : ""}`}
              onClick={() => void handleFeedback(r, userAction || undefined)}
              title={`Rate as ${r}`}
              disabled={feedbackLoading}
            >
              {r === 'excellent' ? '⭐ Excellent' : r === 'good' ? '👍 Good' : r === 'average' ? '👌 Average' : '👎 Bad'}
            </button>
          ))}
        </div>
        <div className="feedback-group">
          <span className="feedback-label">Decision:</span>
          <button
            type="button"
            className={`feedback-btn action-btn accept ${userAction === "accept" ? "active" : ""}`}
            onClick={() => void handleFeedback(userRating || undefined, "accept")}
            title="Accept this clip"
            disabled={feedbackLoading}
          >
            <Check size={12} /> Accept
          </button>
          <button
            type="button"
            className={`feedback-btn action-btn reject ${userAction === "reject" ? "active" : ""}`}
            onClick={() => void handleFeedback(userRating || undefined, "reject")}
            title="Reject this clip"
            disabled={feedbackLoading}
          >
            <X size={12} /> Reject
          </button>
          {feedbackStatus && <span className="feedback-status-badge">{feedbackStatus}</span>}
        </div>
      </div>

      {/* Multimodal Evidence Summary */}
      {clip.scoring_factors && (
        <details className="evidence-summary">
          <summary className="evidence-summary-header">
            <Sparkles size={14} /> Multimodal Evidence Factors
          </summary>
          <div className="evidence-grid">
            <div className="evidence-section">
              <h5>Core Criteria</h5>
              <div className="factor-row">
                <span>Hook Strength</span>
                <div className="factor-bar">
                  <div className="factor-fill" style={{ width: `${clip.scoring_factors.hook_strength}%` }}></div>
                </div>
                <span className="factor-value">{clip.scoring_factors.hook_strength.toFixed(0)}</span>
              </div>
              <div className="factor-row">
                <span>Informational Value</span>
                <div className="factor-bar">
                  <div className="factor-fill" style={{ width: `${clip.scoring_factors.informational_value}%` }}></div>
                </div>
                <span className="factor-value">{clip.scoring_factors.informational_value.toFixed(0)}</span>
              </div>
              <div className="factor-row">
                <span>Context Completeness</span>
                <div className="factor-bar">
                  <div className="factor-fill" style={{ width: `${clip.scoring_factors.context_completeness}%` }}></div>
                </div>
                <span className="factor-value">{clip.scoring_factors.context_completeness.toFixed(0)}</span>
              </div>
              <div className="factor-row">
                <span>Clarity</span>
                <div className="factor-bar">
                  <div className="factor-fill" style={{ width: `${clip.scoring_factors.clarity}%` }}></div>
                </div>
                <span className="factor-value">{clip.scoring_factors.clarity.toFixed(0)}</span>
              </div>
            </div>
            <div className="evidence-section">
              <h5>Audio & Visual Signals</h5>
              <div className="factor-row">
                <span title="Speech clarity and audio quality">🔊 Audio Relevance</span>
                <div className="factor-bar">
                  <div className="factor-fill audio" style={{ width: `${clip.scoring_factors.audio_relevance || 80}%` }}></div>
                </div>
                <span className="factor-value">{(clip.scoring_factors.audio_relevance || 80).toFixed(0)}</span>
              </div>
              <div className="factor-row">
                <span title="Scene composition and visual interest">🎬 Visual Relevance</span>
                <div className="factor-bar">
                  <div className="factor-fill visual" style={{ width: `${clip.scoring_factors.visual_relevance || 75}%` }}></div>
                </div>
                <span className="factor-value">{(clip.scoring_factors.visual_relevance || 75).toFixed(0)}</span>
              </div>
              <div className="factor-row">
                <span title="Clean beginning and ending points">✂️ Boundary Quality</span>
                <div className="factor-bar">
                  <div className="factor-fill" style={{ width: `${clip.scoring_factors.boundary_quality}%` }}></div>
                </div>
                <span className="factor-value">{clip.scoring_factors.boundary_quality.toFixed(0)}</span>
              </div>
            </div>
            <div className="evidence-section">
              <h5>Quality Indicators</h5>
              <div className="factor-row">
                <span>Standalone Usefulness</span>
                <div className="factor-bar">
                  <div className="factor-fill" style={{ width: `${clip.scoring_factors.standalone_usefulness}%` }}></div>
                </div>
                <span className="factor-value">{clip.scoring_factors.standalone_usefulness.toFixed(0)}</span>
              </div>
              <div className="factor-row">
                <span>Evidence Strength</span>
                <div className="factor-bar">
                  <div className="factor-fill" style={{ width: `${clip.scoring_factors.evidence_strength}%` }}></div>
                </div>
                <span className="factor-value">{clip.scoring_factors.evidence_strength.toFixed(0)}</span>
              </div>
              <div className="factor-row">
                <span>Content Uniqueness</span>
                <div className="factor-bar">
                  <div className="factor-fill" style={{ width: `${clip.scoring_factors.uniqueness}%` }}></div>
                </div>
                <span className="factor-value">{clip.scoring_factors.uniqueness.toFixed(0)}</span>
              </div>
            </div>
          </div>
          <div className="evidence-note">
            <small>These factors combine to produce the composite score. Audio and visual signals are detected from the video's audio track and scene changes.</small>
          </div>
        </details>
      )}

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
