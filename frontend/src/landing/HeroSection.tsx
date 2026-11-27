import { useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  Film,
  Play,
  Sparkles,
  Tag,
} from "lucide-react";
import { LandingRoute, PREVIEW_TRANSCRIPT, SHOWCASE_CLIPS } from "./landingData";

interface HeroSectionProps {
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

export default function HeroSection({ onNavigate }: HeroSectionProps) {
  const [selectedClipId, setSelectedClipId] = useState(SHOWCASE_CLIPS[0].id);
  const activeClip =
    SHOWCASE_CLIPS.find((clip) => clip.id === selectedClipId) ?? SHOWCASE_CLIPS[0];

  return (
    <section className="cf-hero">
      <div className="cf-container cf-hero-grid">
        <div className="cf-hero-copy">
          <div className="eyebrow">
            TRANSCRIPTION · CLIP DISCOVERY · SMART ENHANCEMENT
          </div>
          <h1>Turn Long Videos Into Moments Worth Watching.</h1>
          <p className="cf-hero-subtitle">
            Discover the best moments in your videos with intelligent analysis,
            smarter clip discovery and powerful editing recommendations.
          </p>

          <div className="cf-hero-actions">
            <button
              type="button"
              className="primary cf-btn-lg"
              onClick={() => onNavigate("/app")}
            >
              Get Started <ArrowUpRight size={16} />
            </button>
            <button
              type="button"
              className="secondary cf-btn-lg"
              onClick={() => onNavigate("/", "#features")}
            >
              Explore Features <ChevronRight size={16} />
            </button>
          </div>

          <p className="cf-hero-note">
            Upload local MP4 footage or paste a YouTube link with transcript
            support. Inspect timestamps, verify evidence scores, and export
            individual MP4 clips and SRT captions from one workspace.
          </p>
        </div>

        <div
          className="cf-hero-mockup panel"
          aria-label="Interactive ClipForge workspace preview"
        >
          <div className="panel-heading">
            <span>
              <Film size={15} className="footage-color" />
              creator_roundtable_ep14.mp4
            </span>
            <span className="micro-label">INTERACTIVE WORKSPACE PREVIEW</span>
          </div>

          <div className="cf-mockup-stage">
            <div className="cf-mockup-video">
              <div className="cf-mockup-frame">
                <div className="cf-frame-meta">
                  <span className="cf-frame-indicator">
                    <Tag size={12} /> {activeClip.category}
                  </span>
                  <code className="cf-frame-time">
                    {activeClip.start} — {activeClip.end} ({activeClip.duration})
                  </code>
                </div>

                <div className="cf-frame-center">
                  <button
                    type="button"
                    className="cf-frame-play"
                    aria-label={`Select preview clip ${activeClip.title}`}
                    onClick={() => {
                      const idx = SHOWCASE_CLIPS.findIndex((c) => c.id === activeClip.id);
                      const next = SHOWCASE_CLIPS[(idx + 1) % SHOWCASE_CLIPS.length];
                      setSelectedClipId(next.id);
                    }}
                  >
                    <Play size={16} />
                  </button>
                  <div className="cf-frame-caption">
                    “{activeClip.excerpt[0].split(" — ")[1] ?? activeClip.title}”
                  </div>
                </div>

                <div className="cf-timeline-bar" aria-label="Video timeline preview">
                  <div className="cf-timeline-track">
                    <button
                      type="button"
                      className={`cf-timeline-marker m1 ${activeClip.id === "clip-1" ? "active" : ""}`}
                      onClick={() => setSelectedClipId("clip-1")}
                      title="Jump to 04:12"
                    >
                      01
                    </button>
                    <button
                      type="button"
                      className={`cf-timeline-marker m2 ${activeClip.id === "clip-2" ? "active" : ""}`}
                      onClick={() => setSelectedClipId("clip-2")}
                      title="Jump to 11:08"
                    >
                      02
                    </button>
                    <button
                      type="button"
                      className={`cf-timeline-marker m3 ${activeClip.id === "clip-3" ? "active" : ""}`}
                      onClick={() => setSelectedClipId("clip-3")}
                      title="Jump to 19:34"
                    >
                      03
                    </button>
                  </div>
                  <div className="cf-timeline-ticks">
                    <span>00:00</span>
                    <span>08:00</span>
                    <span>16:00</span>
                    <span>24:18</span>
                  </div>
                </div>
              </div>

              <div className="cf-mockup-transcript">
                <div className="cf-subpanel-label">
                  <span>TRANSCRIPT SNIPPET</span>
                  <span className="dialogue-color">SEARCHABLE · SPEAKER TAGGED</span>
                </div>
                <div className="cf-mockup-lines">
                  {PREVIEW_TRANSCRIPT.slice(0, 4).map((line) => {
                    const isHighlighted = line.clipId === activeClip.id;
                    return (
                      <button
                        key={line.time}
                        type="button"
                        className={`cf-transcript-line ${isHighlighted ? "active" : ""}`}
                        onClick={() => setSelectedClipId(line.clipId)}
                      >
                        <code>{line.time}</code>
                        <div>
                          <span className={`cf-speaker-name ${line.speakerColor}`}>
                            {line.speaker}
                          </span>
                          <p>{line.text}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="cf-mockup-discovery">
              <div className="cf-subpanel-label">
                <span>
                  <Sparkles size={12} className="ai-color" /> DISCOVERED CLIPS
                </span>
                <span>CLICK TO INSPECT</span>
              </div>

              <div className="cf-mockup-clips">
                {SHOWCASE_CLIPS.map((clip) => {
                  const selected = clip.id === activeClip.id;
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      className={`cf-mini-clip ${selected ? "selected" : ""}`}
                      onClick={() => setSelectedClipId(clip.id)}
                    >
                      <div className="cf-mini-clip-top">
                        <span className="clip-rank">{clip.rank}</span>
                        <strong>{clip.title}</strong>
                        <span className="cf-mini-score">{clip.score}</span>
                      </div>
                      <div className="cf-mini-clip-meta">
                        <code>
                          {clip.start}–{clip.end}
                        </code>
                        <span>{clip.duration}</span>
                        <span>Hook {clip.criteria.hook}</span>
                        <span>Clarity {clip.criteria.clarity}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <dl className="clip-criteria cf-mockup-criteria">
                <div>
                  <dt>Hook</dt>
                  <dd>{activeClip.criteria.hook}</dd>
                </div>
                <div>
                  <dt>Info</dt>
                  <dd>{activeClip.criteria.information}</dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>{activeClip.criteria.context}</dd>
                </div>
                <div>
                  <dt>Clarity</dt>
                  <dd>{activeClip.criteria.clarity}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
