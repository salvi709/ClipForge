import { useState } from "react";
import { Captions, Crop, Scissors } from "lucide-react";
import { LandingRoute } from "./landingData";

interface CreativeExperienceSectionProps {
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

export default function CreativeExperienceSection({
  onNavigate,
}: CreativeExperienceSectionProps) {
  const [framing, setFraming] = useState<"9:16" | "16:9">("9:16");

  return (
    <section className="cf-section cf-experience" id="experience">
      <div className="cf-container cf-exp-stack">
        {/* Story Row 1: Text left, collapsing footage-to-moments visual right */}
        <article className="cf-exp-row">
          <div className="cf-exp-copy">
            <span className="cf-exp-index">01</span>
            <h2>From hours of footage to moments that matter.</h2>
            <p>
              Long recordings move slowly until a single sentence shifts the
              room. ClipForge finds those turns automatically.
            </p>
          </div>

          <div className="cf-exp-visual cf-visual-compress">
            <div className="cf-float-card cf-comp-source">
              <div className="cf-comp-label">
                <span>Raw recording</span>
                <code>01:24:18</code>
              </div>
              <div className="cf-comp-bars" aria-hidden="true">
                <span className="cf-seg-dim" />
                <span className="cf-seg-lit s1" />
                <span className="cf-seg-dim wide" />
                <span className="cf-seg-lit s2" />
                <span className="cf-seg-dim" />
                <span className="cf-seg-lit s3" />
              </div>
            </div>

            <div className="cf-comp-extracts">
              <div className="cf-float-card cf-extract-chip active">
                <code>04:12</code>
                <span>Opening tension</span>
                <span className="cf-lime">00:46</span>
              </div>
              <div className="cf-float-card cf-extract-chip">
                <code>11:08</code>
                <span>Core shift</span>
                <span>00:41</span>
              </div>
              <div className="cf-float-card cf-extract-chip">
                <code>19:34</code>
                <span>Closing turn</span>
                <span>00:40</span>
              </div>
            </div>
          </div>
        </article>

        {/* Story Row 2: Visual left, text right */}
        <article className="cf-exp-row reverse">
          <div className="cf-exp-visual cf-visual-signals">
            <div className="cf-float-card cf-signal-quote">
              <div className="cf-frag-kicker">
                <span className="dialogue-color">Speaker turn</span>
                <span className="cf-sep">·</span>
                <code>11:08</code>
              </div>
              <p>
                “Move the opening cut four seconds forward—start right where
                the tension appears.”
              </p>
            </div>

            <div className="cf-float-card cf-signal-box">
              <div className="cf-signal-ring-row">
                <svg viewBox="0 0 44 44" className="cf-exp-ring" aria-hidden="true">
                  <circle className="cf-ring-bg" cx="22" cy="22" r="18" />
                  <circle className="cf-ring-fg exp" cx="22" cy="22" r="18" />
                </svg>
                <div>
                  <strong>Boundary locked</strong>
                  <span>Clean pause · Strong opening hook</span>
                </div>
              </div>
            </div>

            <div className="cf-float-card cf-signal-badge">
              <Scissors size={13} className="footage-color" />
              <code>[ 11:08 — 11:49 ]</code>
            </div>
          </div>

          <div className="cf-exp-copy">
            <span className="cf-exp-index">02</span>
            <h2>A smarter way to discover what stands out.</h2>
            <p>
              Dialogue cadence, vocal energy, and visual cuts come together
              quietly—leaving you clear timing instead of guesswork.
            </p>
          </div>
        </article>

        {/* Story Row 3: Text left, interactive framing & caption teaser right */}
        <article className="cf-exp-row">
          <div className="cf-exp-copy">
            <span className="cf-exp-index">03</span>
            <h2>Built for the people who create.</h2>
            <p>
              Adjust every boundary, preview captions and framing, and step out
              with clips that already belong on screen.
            </p>
            <button
              type="button"
              className="text-button cf-exp-link"
              onClick={() => onNavigate("/app")}
            >
              Open workspace →
            </button>
          </div>

          <div className="cf-exp-visual cf-visual-craft">
            <div className="cf-float-card cf-craft-stage">
              <div className="cf-craft-top">
                <span className="cf-craft-title">
                  <Crop size={14} className="cf-lime" /> Framing preview
                </span>
                <div className="tab-switcher" role="group" aria-label="Aspect ratio toggle">
                  <button
                    type="button"
                    className={`tab-button ${framing === "9:16" ? "active" : ""}`}
                    onClick={() => setFraming("9:16")}
                  >
                    9:16
                  </button>
                  <button
                    type="button"
                    className={`tab-button ${framing === "16:9" ? "active" : ""}`}
                    onClick={() => setFraming("16:9")}
                  >
                    16:9
                  </button>
                </div>
              </div>

              <div className="cf-craft-viewport">
                <div className={`cf-craft-frame ${framing === "9:16" ? "vertical" : "wide"}`}>
                  <span className="cf-craft-ratio">{framing}</span>
                  <div className="cf-craft-sub">
                    <Captions size={12} className="cf-lime" />
                    <span>“Start right where the tension appears.”</span>
                  </div>
                </div>
              </div>

              <div className="cf-craft-targets">
                <span>Shorts</span>
                <span className="cf-sep">·</span>
                <span>Reels</span>
                <span className="cf-sep">·</span>
                <span>MP4</span>
                <span className="cf-sep">·</span>
                <span>SRT</span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
