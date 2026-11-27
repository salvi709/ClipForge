import { useState } from "react";
import {
  AudioLines,
  Captions,
  Check,
  Download,
  FileVideo,
  Link2,
  Scissors,
  Search,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import {
  LandingRoute,
  PREVIEW_TRANSCRIPT,
  SHOWCASE_CLIPS,
} from "./landingData";

interface ProductShowcaseProps {
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

type InputMode = "mp4" | "youtube";
type InspectorTab = "discovery" | "transcript" | "enhancement";

export default function ProductShowcase({ onNavigate }: ProductShowcaseProps) {
  const [inputMode, setInputMode] = useState<InputMode>("mp4");
  const [activeTab, setActiveTab] = useState<InspectorTab>("discovery");
  const [selectedClipId, setSelectedClipId] = useState(SHOWCASE_CLIPS[0].id);
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [titleIndex, setTitleIndex] = useState(0);

  const selectedClip =
    SHOWCASE_CLIPS.find((item) => item.id === selectedClipId) ?? SHOWCASE_CLIPS[0];

  const filteredLines = PREVIEW_TRANSCRIPT.filter(
    (line) =>
      line.text.toLowerCase().includes(transcriptQuery.toLowerCase()) ||
      line.speaker.toLowerCase().includes(transcriptQuery.toLowerCase()),
  );

  return (
    <section className="cf-section cf-showcase-section" id="showcase">
      <div className="cf-container">
        <div className="cf-section-header">
          <div>
            <div className="eyebrow">INTERACTIVE PRODUCT WALKTHROUGH</div>
            <h2>Your Video. Smarter Analysis. Better Clips.</h2>
          </div>
          <p className="cf-section-lead">
            Inspect how ClipForge moves from raw MP4 footage or a YouTube URL to
            scored candidates, searchable speech, and enhancement-ready exports.
          </p>
        </div>

        <div className="cf-workbench panel">
          <div className="cf-workbench-bar">
            <div className="tab-switcher" role="group" aria-label="Source input preview">
              <button
                type="button"
                className={`tab-button ${inputMode === "mp4" ? "active" : ""}`}
                onClick={() => setInputMode("mp4")}
              >
                <Upload size={14} /> Local MP4 Upload
              </button>
              <button
                type="button"
                className={`tab-button ${inputMode === "youtube" ? "active" : ""}`}
                onClick={() => setInputMode("youtube")}
              >
                <Link2 size={14} /> YouTube Link + Transcript
              </button>
            </div>

            <div className="tab-switcher" role="tablist" aria-label="Interactive product preview tabs">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "discovery"}
                className={`tab-button ${activeTab === "discovery" ? "active" : ""}`}
                onClick={() => setActiveTab("discovery")}
              >
                <Sparkles size={14} /> Discovery
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "transcript"}
                className={`tab-button ${activeTab === "transcript" ? "active" : ""}`}
                onClick={() => setActiveTab("transcript")}
              >
                <AudioLines size={14} /> Transcript
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "enhancement"}
                className={`tab-button ${activeTab === "enhancement" ? "active" : ""}`}
                onClick={() => setActiveTab("enhancement")}
              >
                <WandSparkles size={14} /> Enhancement
              </button>
            </div>
          </div>

          <div className="cf-workbench-source">
            {inputMode === "mp4" ? (
              <div className="cf-source-strip">
                <div className="cf-source-identity">
                  <FileVideo size={16} className="footage-color" />
                  <strong>founder_panel_keynote.mp4</strong>
                  <span className="cf-sep">·</span>
                  <span>24m 18s · 1920×1080 · H.264 MP4</span>
                </div>
                <div className="cf-source-signals">
                  <span>Audio peaks mapped</span>
                  <span className="cf-sep">·</span>
                  <span>Scene cuts indexed</span>
                  <span className="cf-sep">·</span>
                  <span>FFmpeg MP4 export ready</span>
                </div>
              </div>
            ) : (
              <div className="cf-source-strip">
                <div className="cf-source-identity">
                  <Link2 size={16} className="dialogue-color" />
                  <strong>youtube.com/watch?v=9xK4m2P_demo</strong>
                  <span className="cf-sep">·</span>
                  <span>Metadata verified · SRT / VTT / plain text import ready</span>
                </div>
                <div className="cf-source-signals">
                  <span>Transcript scored</span>
                  <span className="cf-sep">·</span>
                  <span>Timestamped ?t= links generated</span>
                </div>
              </div>
            )}
          </div>

          <div className="cf-workbench-body">
            {activeTab === "discovery" && (
              <div className="cf-showcase-discovery">
                <div className="cf-showcase-list">
                  <div className="cf-subpanel-label">
                    <span>RANKED CANDIDATES</span>
                    <span>TOP PICKS</span>
                  </div>
                  {SHOWCASE_CLIPS.map((clip) => (
                    <button
                      key={clip.id}
                      type="button"
                      className={`clip-card cf-selectable-card ${selectedClip.id === clip.id ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedClipId(clip.id);
                        setTitleIndex(0);
                      }}
                    >
                      <div className="clip-card-heading">
                        <span className="clip-rank">{clip.rank}</span>
                        <span className="clip-title">{clip.title}</span>
                        <div className="clip-score">
                          {clip.score}
                          <small>/100</small>
                        </div>
                      </div>
                      <div className="clip-time">
                        <code>
                          {clip.start} — {clip.end}
                        </code>
                        <span>{clip.duration}</span>
                        <span>{clip.category}</span>
                      </div>
                      <p className="clip-reason">{clip.reason}</p>
                    </button>
                  ))}
                </div>

                <div className="cf-showcase-detail">
                  <div className="cf-subpanel-label">
                    <span>EVIDENCE & BOUNDARY PREVIEW</span>
                    <span>CLIP {selectedClip.rank}</span>
                  </div>
                  <h3>{selectedClip.title}</h3>
                  <p className="cf-detail-summary">{selectedClip.reason}</p>

                  <dl className="clip-criteria">
                    <div>
                      <dt>Hook</dt>
                      <dd>{selectedClip.criteria.hook}</dd>
                    </div>
                    <div>
                      <dt>Information</dt>
                      <dd>{selectedClip.criteria.information}</dd>
                    </div>
                    <div>
                      <dt>Context</dt>
                      <dd>{selectedClip.criteria.context}</dd>
                    </div>
                    <div>
                      <dt>Clarity</dt>
                      <dd>{selectedClip.criteria.clarity}</dd>
                    </div>
                  </dl>

                  <div className="cf-evidence-list">
                    <div>
                      <strong>Audio evidence</strong>
                      <span>{selectedClip.multimodal.audio}</span>
                    </div>
                    <div>
                      <strong>Visual & pacing</strong>
                      <span>{selectedClip.multimodal.visual}</span>
                    </div>
                    <div>
                      <strong>Boundary fit</strong>
                      <span>{selectedClip.multimodal.boundary}</span>
                    </div>
                  </div>

                  <div className="cf-detail-actions">
                    <span className="cf-action-hint">
                      <Scissors size={14} /> Editable timestamps in workspace ·{" "}
                      {inputMode === "mp4"
                        ? "Exports MP4 + SRT"
                        : "Copies ?t= YouTube link + SRT"}
                    </span>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => onNavigate("/app")}
                    >
                      Try in Workspace
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "transcript" && (
              <div className="cf-showcase-transcript">
                <div className="cf-transcript-controls">
                  <div className="search cf-preview-search">
                    <Search size={14} />
                    <input
                      type="search"
                      aria-label="Filter preview transcript"
                      placeholder="Filter preview transcript by keyword or speaker..."
                      value={transcriptQuery}
                      onChange={(event) => setTranscriptQuery(event.target.value)}
                    />
                  </div>
                  <div className="cf-transcript-meta">
                    <span>Speakers identified: Maya Lin, Devon Cole</span>
                    <span className="cf-sep">·</span>
                    <span>Sentence-aligned segments</span>
                  </div>
                </div>

                <div className="cf-preview-segments">
                  {filteredLines.length === 0 ? (
                    <div className="cf-preview-empty">
                      No matching lines in preview transcript. Clear search to view all lines.
                    </div>
                  ) : (
                    filteredLines.map((line) => (
                      <button
                        key={line.time}
                        type="button"
                        className={`segment ${line.clipId === selectedClip.id ? "playing" : ""}`}
                        onClick={() => setSelectedClipId(line.clipId)}
                      >
                        <code>
                          {line.time}
                          <span>{line.speaker}</span>
                        </code>
                        <span>{line.text}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "enhancement" && (
              <div className="cf-showcase-enhancement">
                <div className="cf-enhancement-col">
                  <div className="cf-subpanel-label">
                    <span>GENERATED TITLE HOOKS</span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setTitleIndex((prev) => (prev + 1) % selectedClip.titles.length)
                      }
                    >
                      Cycle variation
                    </button>
                  </div>
                  <div className="cf-title-options">
                    {selectedClip.titles.map((title, index) => (
                      <button
                        key={title.text}
                        type="button"
                        className={`cf-title-card ${titleIndex === index ? "active" : ""}`}
                        onClick={() => setTitleIndex(index)}
                      >
                        <span className="cf-title-style">{title.style}</span>
                        <strong>{title.text}</strong>
                      </button>
                    ))}
                  </div>

                  <div className="cf-spec-grid">
                    <div className="cf-spec-box">
                      <span className="cf-spec-label">
                        <Captions size={13} /> Caption Style
                      </span>
                      <strong>{selectedClip.captionSpec.preset}</strong>
                      <p>{selectedClip.captionSpec.wordsPerLine}</p>
                    </div>
                    <div className="cf-spec-box">
                      <span className="cf-spec-label">
                        <Download size={13} /> Format & Crop
                      </span>
                      <strong>{selectedClip.cropRatio}</strong>
                      <p>{selectedClip.captionSpec.placement}</p>
                    </div>
                  </div>
                </div>

                <div className="cf-enhancement-col">
                  <div className="cf-subpanel-label">
                    <span>EDITING & AUDIO CUES</span>
                    <span>{selectedClip.duration}</span>
                  </div>
                  <ul className="cf-editing-list">
                    {selectedClip.editingNotes.map((note) => (
                      <li key={note}>
                        <Check size={14} className="dialogue-color" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="cf-music-note">
                    <span>AUDIO & SILENCE GUIDANCE</span>
                    <p>{selectedClip.musicCue}</p>
                  </div>
                  <div className="cf-platforms-row">
                    <span>EXPORT TARGETS</span>
                    <p>{selectedClip.platforms.join(" · ")}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
