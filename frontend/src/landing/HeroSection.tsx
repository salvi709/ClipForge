import { useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Captions,
  Pause,
  Play,
  Scissors,
  Sparkles,
} from "lucide-react";
import { HERO_MOMENTS, LandingRoute } from "./landingData";

interface HeroSectionProps {
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

const WAVE_BARS = [
  "h-1", "h-2", "h-4", "h-3", "h-6", "h-8", "h-5", "h-9", "h-7", "h-4",
  "h-6", "h-10", "h-8", "h-5", "h-7", "h-4", "h-3", "h-6", "h-8", "h-5",
  "h-3", "h-2", "h-4", "h-2",
];

export default function HeroSection({ onNavigate }: HeroSectionProps) {
  const [activeId, setActiveId] = useState(HERO_MOMENTS[0].id);
  const [playing, setPlaying] = useState(true);

  const active =
    HERO_MOMENTS.find((item) => item.id === activeId) ?? HERO_MOMENTS[0];

  const cycleMoment = () => {
    const idx = HERO_MOMENTS.findIndex((item) => item.id === active.id);
    const next = HERO_MOMENTS[(idx + 1) % HERO_MOMENTS.length];
    setActiveId(next.id);
  };

  return (
    <section className="cf-hero">
      <div className="cf-hero-ambient" aria-hidden="true" />

      <div className="cf-container cf-hero-split">
        <div className="cf-hero-copy">
          <h1>Every Long Video Has Its Moments.</h1>
          <p className="cf-hero-subtitle">
            Hours of raw footage hide a handful of seconds worth keeping.
            ClipForge surfaces them before you ever scrub a timeline.
          </p>

          <div className="cf-hero-actions">
            <button
              type="button"
              className="primary cf-btn-lg"
              onClick={() => onNavigate("/app")}
            >
              Explore ClipForge <ArrowUpRight size={16} />
            </button>
            <button
              type="button"
              className="secondary cf-btn-lg"
              onClick={() => onNavigate("/", "#interlude")}
            >
              See What’s Inside <ArrowDown size={15} />
            </button>
          </div>

          <div className="cf-hero-selector" role="group" aria-label="Preview moment switcher">
            {HERO_MOMENTS.map((moment) => (
              <button
                key={moment.id}
                type="button"
                className={`cf-moment-switch ${moment.id === active.id ? "active" : ""}`}
                onClick={() => setActiveId(moment.id)}
              >
                <code>{moment.start}</code>
                <span>{moment.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Layered floating UI fragment stage */}
        <div
          className="cf-fragment-stage"
          aria-label="Layered ClipForge visual fragments"
        >
          {/* Floating Fragment 1: Edge-cropped subtle analysis toast (top right back layer) */}
          <div className="cf-float-card cf-frag-status">
            <Sparkles size={13} className="cf-lime" />
            <span>Moment surfaced</span>
            <span className="cf-sep">·</span>
            <code>{active.category}</code>
          </div>

          {/* Floating Fragment 2: Centerpiece Video Frame + Vertical 9:16 Selection Reticle */}
          <div className="cf-float-card cf-frag-video">
            <div className="cf-frag-video-head">
              <span className="cf-frag-timecode">
                {active.start} → {active.end}
              </span>
              <span className="cf-frag-duration">{active.duration}</span>
            </div>

            <div className="cf-frag-cinema">
              <div className="cf-cinema-grid" aria-hidden="true" />
              {/* Vertical 9:16 crop bounding box inside 16:9 frame */}
              <div className="cf-crop-reticle">
                <span className="cf-crop-label">{active.framing}</span>
                <button
                  type="button"
                  className="cf-frag-play-btn"
                  aria-label={playing ? "Pause preview pulse" : "Play preview pulse"}
                  onClick={() => setPlaying((prev) => !prev)}
                >
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <span className="cf-crop-speaker">{active.speaker}</span>
              </div>

              {/* Miniature floating frame thumbs along edge */}
              <div className="cf-thumb-strip" aria-hidden="true">
                <span className="cf-thumb active" />
                <span className="cf-thumb" />
                <span className="cf-thumb" />
              </div>
            </div>
          </div>

          {/* Floating Fragment 3: Transcription Snippet Card (bottom-left overlapping) */}
          <button
            type="button"
            className="cf-float-card cf-frag-transcript"
            onClick={cycleMoment}
            title="Click to cycle surfaced moment"
          >
            <div className="cf-frag-kicker">
              <span className="dialogue-color">{active.speaker}</span>
              <span className="cf-sep">·</span>
              <code>{active.start}</code>
            </div>
            <p>“{active.quote}”</p>
          </button>

          {/* Floating Fragment 4: Audio Waveform + SVG Readiness Ring (mid-right) */}
          <div className="cf-float-card cf-frag-audio">
            <div className="cf-ring-wrap">
              <svg viewBox="0 0 40 40" className="cf-progress-ring" aria-hidden="true">
                <circle className="cf-ring-bg" cx="20" cy="20" r="16" />
                <circle className="cf-ring-fg" cx="20" cy="20" r="16" />
              </svg>
              <span className="cf-ring-label">Peak</span>
            </div>
            <div className="cf-wave-bars" aria-hidden="true">
              {WAVE_BARS.map((heightClass, index) => (
                <span
                  key={`${heightClass}-${index}`}
                  className={`cf-wave-bar ${heightClass} ${playing ? "animated" : ""}`}
                />
              ))}
            </div>
          </div>

          {/* Floating Fragment 5: Caption Cut Marker Card (lower-right cropped edge) */}
          <div className="cf-float-card cf-frag-caption">
            <div className="cf-frag-kicker">
              <Captions size={13} className="footage-color" />
              <span>Caption preview</span>
            </div>
            <div className="cf-caption-line">
              <span>{active.quote.split(",")[0]}</span>
            </div>
          </div>

          {/* Floating Fragment 6: Miniature Timeline Slice (bottom spanning layer) */}
          <div className="cf-float-card cf-frag-timeline">
            <div className="cf-mini-tl-head">
              <span>
                <Scissors size={12} className="cf-lime" /> {active.title}
              </span>
              <code>{active.duration}</code>
            </div>
            <div className="cf-mini-tl-rail">
              <div className={`cf-mini-tl-window ${active.timelineOffsetClass}`}>
                <span className="cf-tl-handle left" />
                <span className="cf-tl-sweep" />
                <span className="cf-tl-handle right" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
