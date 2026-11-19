import { useEffect, useState } from "react";
import { Users, Edit3, Save, X, Loader, AlertCircle, CheckCircle } from "lucide-react";
import {
  getSpeakerStatus,
  analyzeSpeakers,
  getSpeakers,
  updateSpeakerLabel,
  correctSpeakerSegment,
  timestamp,
  SpeakerAnalysis,
  SpeakerStatus,
} from "./api";

type SpeakerTimelinePanelProps = {
  projectId: string;
  duration: number;
};

export default function SpeakerTimelinePanel({ projectId, duration }: SpeakerTimelinePanelProps) {
  const [status, setStatus] = useState<SpeakerStatus | null>(null);
  const [analysis, setAnalysis] = useState<SpeakerAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [editingSegment, setEditingSegment] = useState<number | null>(null);
  const [segmentSpeakerInput, setSegmentSpeakerInput] = useState("");

  useEffect(() => {
    void checkStatus();
    void loadAnalysis();
  }, [projectId]);

  async function checkStatus() {
    try {
      const statusData = await getSpeakerStatus(projectId);
      setStatus(statusData);
    } catch (err) {
      console.error("Failed to check speaker status:", err);
    }
  }

  async function loadAnalysis() {
    setLoading(true);
    setError("");
    try {
      const data = await getSpeakers(projectId);
      setAnalysis(data);
    } catch (err) {
      // No analysis yet, that's okay
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis() {
    setAnalyzing(true);
    setError("");
    try {
      const data = await analyzeSpeakers(projectId);
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speaker analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveLabel(speakerId: string) {
    if (!labelInput.trim()) {
      setEditingLabel(null);
      return;
    }
    
    try {
      await updateSpeakerLabel(projectId, speakerId, labelInput.trim());
      await loadAnalysis(); // Reload to get updated labels
      setEditingLabel(null);
      setLabelInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save label");
    }
  }

  async function saveSegmentCorrection(segmentIndex: number) {
    if (!segmentSpeakerInput.trim()) {
      setEditingSegment(null);
      return;
    }
    
    try {
      await correctSpeakerSegment(projectId, segmentIndex, segmentSpeakerInput.trim());
      await loadAnalysis(); // Reload to get updated segments
      setEditingSegment(null);
      setSegmentSpeakerInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to correct segment");
    }
  }

  function getSpeakerLabel(speakerId: string): string {
    return analysis?.user_labels?.[speakerId] || speakerId;
  }

  const getSpeakerColor = (speakerId: string): string => {
    const colors = [
      '#709fd0', // blue
      '#8bc490', // green
      '#f0ad4e', // orange
      '#c9a1d9', // purple
      '#f87171', // red
      '#fbbf24', // yellow
    ];
    const index = analysis?.speakers.indexOf(speakerId) || 0;
    return colors[index % colors.length];
  };

  if (!status) {
    return (
      <div className="speaker-panel">
        <div className="speaker-panel-header">
          <h3><Users size={16} /> Speaker Intelligence</h3>
        </div>
        <div className="loading-state">
          <Loader size={20} className="spin" />
          <span>Checking availability...</span>
        </div>
      </div>
    );
  }

  if (!status.available) {
    return (
      <div className="speaker-panel">
        <div className="speaker-panel-header">
          <h3><Users size={16} /> Speaker Intelligence</h3>
        </div>
        <div className="notice error">
          <AlertCircle size={16} />
          <div>
            <strong>Speaker diarization unavailable</strong>
            <p>{status.error_message}</p>
            {status.requires_installation && (
              <p style={{ marginTop: 8 }}>
                Install: <code>pip install torch torchaudio pyannote.audio</code>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="speaker-panel">
      <div className="speaker-panel-header">
        <h3><Users size={16} /> Speaker Intelligence</h3>
        {!analysis && !analyzing && (
          <button className="primary" onClick={() => void runAnalysis()}>
            Analyze Speakers
          </button>
        )}
        {analysis && !analyzing && (
          <button className="secondary" onClick={() => void runAnalysis()}>
            Re-analyze
          </button>
        )}
      </div>

      {analyzing && (
        <div className="loading-state">
          <Loader size={20} className="spin" />
          <span>Analyzing speakers (this may take 1-2x real-time)...</span>
        </div>
      )}

      {error && (
        <div className="notice error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {!analyzing && !analysis && !loading && (
        <div className="speaker-empty-state">
          <Users size={32} style={{ opacity: 0.5 }} />
          <p>No speaker analysis yet</p>
          <p className="speaker-hint">
            Click "Analyze Speakers" to identify different voices in this video.
          </p>
        </div>
      )}

      {loading && !analysis && (
        <div className="loading-state">
          <Loader size={20} className="spin" />
          <span>Loading analysis...</span>
        </div>
      )}

      {analysis && !analysis.error && (
        <>
          <div className="speaker-summary">
            <div className="speaker-stat">
              <span className="stat-value">{analysis.speaker_count}</span>
              <span className="stat-label">Speakers</span>
            </div>
            <div className="speaker-stat">
              <span className="stat-value">{analysis.segments.length}</span>
              <span className="stat-label">Segments</span>
            </div>
            <div className="speaker-stat">
              <span className="stat-value">{analysis.overlapping_speech.length}</span>
              <span className="stat-label">Overlaps</span>
            </div>
            <div className="speaker-stat">
              <span className="stat-value">{analysis.processing_time}s</span>
              <span className="stat-label">Processing</span>
            </div>
          </div>

          {/* Speaker Labels */}
          <div className="speaker-labels-section">
            <h4>Speakers</h4>
            <div className="speaker-labels-list">
              {analysis.speakers.map((speakerId) => {
                const label = getSpeakerLabel(speakerId);
                const isEditing = editingLabel === speakerId;
                const color = getSpeakerColor(speakerId);
                
                return (
                  <div key={speakerId} className="speaker-label-item" style={{ borderLeftColor: color }}>
                    <div className="speaker-badge" style={{ backgroundColor: color }}>
                      {label.charAt(0)}
                    </div>
                    {isEditing ? (
                      <div className="speaker-label-edit">
                        <input
                          type="text"
                          value={labelInput}
                          onChange={(e) => setLabelInput(e.target.value)}
                          placeholder="Enter speaker name"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveLabel(speakerId);
                            if (e.key === 'Escape') {
                              setEditingLabel(null);
                              setLabelInput("");
                            }
                          }}
                        />
                        <button
                          className="icon-button"
                          onClick={() => void saveLabel(speakerId)}
                          title="Save"
                        >
                          <Save size={14} />
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => {
                            setEditingLabel(null);
                            setLabelInput("");
                          }}
                          title="Cancel"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="speaker-label-text">{label}</span>
                        <button
                          className="icon-button"
                          onClick={() => {
                            setEditingLabel(speakerId);
                            setLabelInput(label === speakerId ? "" : label);
                          }}
                          title="Rename speaker"
                        >
                          <Edit3 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Timeline */}
          <div className="speaker-timeline-section">
            <h4>Timeline</h4>
            <div className="speaker-timeline-visual">
              {analysis.segments.map((segment, index) => {
                const left = (segment.start / duration) * 100;
                const width = ((segment.end - segment.start) / duration) * 100;
                const color = getSpeakerColor(segment.speaker);
                const isEditing = editingSegment === index;
                
                return (
                  <div
                    key={index}
                    className={`timeline-segment ${isEditing ? 'editing' : ''}`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: color,
                    }}
                    title={`${getSpeakerLabel(segment.speaker)}: ${timestamp(segment.start)} - ${timestamp(segment.end)}`}
                    onClick={() => {
                      setEditingSegment(index);
                      setSegmentSpeakerInput(segment.speaker);
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Segment List */}
          <div className="speaker-segments-section">
            <h4>Segments</h4>
            <div className="speaker-segments-list">
              {analysis.segments.map((segment, index) => {
                const label = getSpeakerLabel(segment.speaker);
                const color = getSpeakerColor(segment.speaker);
                const isEditing = editingSegment === index;
                
                return (
                  <div key={index} className="speaker-segment-item">
                    <div className="segment-time">{timestamp(segment.start)} – {timestamp(segment.end)}</div>
                    <div className="segment-speaker-badge" style={{ backgroundColor: color }}>
                      {isEditing ? (
                        <select
                          value={segmentSpeakerInput}
                          onChange={(e) => setSegmentSpeakerInput(e.target.value)}
                          autoFocus
                          onBlur={() => void saveSegmentCorrection(index)}
                        >
                          {analysis.speakers.map((spk) => (
                            <option key={spk} value={spk}>
                              {getSpeakerLabel(spk)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span onClick={() => {
                          setEditingSegment(index);
                          setSegmentSpeakerInput(segment.speaker);
                        }}>
                          {label}
                          {segment.manually_corrected && <CheckCircle size={12} style={{ marginLeft: 4 }} />}
                        </span>
                      )}
                    </div>
                    <div className="segment-duration">{(segment.end - segment.start).toFixed(1)}s</div>
                  </div>
                );
              })}
            </div>
          </div>

          {analysis.overlapping_speech.length > 0 && (
            <div className="speaker-overlaps-section">
              <h4>Overlapping Speech ({analysis.overlapping_speech.length})</h4>
              <div className="overlaps-list">
                {analysis.overlapping_speech.map((overlap, index) => (
                  <div key={index} className="overlap-item">
                    <span className="overlap-time">{timestamp(overlap.start)} – {timestamp(overlap.end)}</span>
                    <span className="overlap-speakers">
                      {overlap.speakers.map(getSpeakerLabel).join(" & ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="speaker-info">
            <small>
              Model: {analysis.model_version} • Device: {analysis.device}
            </small>
          </div>
        </>
      )}

      {analysis && analysis.error && (
        <div className="notice error">
          <AlertCircle size={16} />
          <span>Analysis failed: {analysis.error}</span>
        </div>
      )}
    </div>
  );
}
