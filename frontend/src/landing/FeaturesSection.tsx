import {
  AudioLines,
  Download,
  Layers2,
  Link2,
  Sparkles,
  Tag,
  Users,
  WandSparkles,
} from "lucide-react";

export default function FeaturesSection() {
  return (
    <section className="cf-section" id="features">
      <div className="cf-container">
        <div className="cf-section-header">
          <div>
            <div className="eyebrow">CORE CAPABILITIES</div>
            <h2>Built Around How Editors Actually Find Strong Clips.</h2>
          </div>
          <p className="cf-section-lead">
            Every feature traces back to inspectable signals—from sentence units
            and audio peaks to speaker turns and direct FFmpeg exports.
          </p>
        </div>

        {/* Lead asymmetric spotlight: Intelligent Clip Discovery */}
        <div className="cf-feature-lead panel">
          <div className="cf-feature-lead-copy">
            <div className="cf-feature-kicker">
              <Sparkles size={15} className="ai-color" />
              <span>INTELLIGENT CLIP DISCOVERY</span>
            </div>
            <h3>Ranked Top Picks With Transparent Scoring Criteria.</h3>
            <p>
              ClipForge groups natural sentence boundaries into candidate
              windows—configurable from 5 to 120 seconds—and ranks them across
              Hook, Information, Context, and Clarity alongside uniqueness and
              boundary quality checks.
            </p>
            <ul className="cf-feature-bullets">
              <li>Top Picks surfaced first with expandable More Discoveries</li>
              <li>Manual missed-moment markers alongside automated suggestions</li>
              <li>Clip rating & accept/reject feedback with evaluation stats</li>
            </ul>
          </div>

          <div className="cf-feature-lead-visual" aria-label="Clip scoring matrix preview">
            <div className="cf-matrix-row">
              <span>Hook Strength</span>
              <div className="cf-bar-track">
                <div className="cf-bar-fill w-94" />
              </div>
              <code>94</code>
            </div>
            <div className="cf-matrix-row">
              <span>Information Density</span>
              <div className="cf-bar-track">
                <div className="cf-bar-fill w-90" />
              </div>
              <code>90</code>
            </div>
            <div className="cf-matrix-row">
              <span>Standalone Context</span>
              <div className="cf-bar-track">
                <div className="cf-bar-fill w-88" />
              </div>
              <code>88</code>
            </div>
            <div className="cf-matrix-row">
              <span>Boundary Clarity</span>
              <div className="cf-bar-track">
                <div className="cf-bar-fill w-92" />
              </div>
              <code>92</code>
            </div>
            <div className="cf-matrix-footnote">
              <span>Preset durations: 15–30s · 30–60s · 60–90s · Custom</span>
              <code>1–10 CLIPS</code>
            </div>
          </div>
        </div>

        {/* Middle 3-column bento capabilities */}
        <div className="cf-feature-trio">
          <article className="cf-feature-card">
            <div className="cf-feature-icon footage-color">
              <AudioLines size={18} />
            </div>
            <h3>Multimodal Intelligence</h3>
            <p>
              Combines transcript sentence structure with FFmpeg audio energy
              peaks, silence gaps, and visual scene changes when media files are
              present.
            </p>
            <div className="cf-feature-meta">Speech · Audio Energy · Scene Cuts</div>
          </article>

          <article className="cf-feature-card">
            <div className="cf-feature-icon dialogue-color">
              <Tag size={18} />
            </div>
            <h3>Automatic Category Detection</h3>
            <p>
              Profiles recordings across Podcast, Educational, Gaming, Vlog,
              Documentary, Comedy, Music, and Sports with manual override at any
              time.
            </p>
            <div className="cf-feature-meta">Confidence readout · Manual override</div>
          </article>

          <article className="cf-feature-card">
            <div className="cf-feature-icon">
              <Link2 size={18} className="cf-amber" />
            </div>
            <h3>YouTube Link Intelligence</h3>
            <p>
              Validates watch, Shorts, live, and share URLs, retrieves video
              metadata, imports SRT/VTT or plain transcripts, and builds ?t=
              playback links.
            </p>
            <div className="cf-feature-meta">Metadata lookup · SRT / VTT import</div>
          </article>
        </div>

        {/* Bottom operational strip */}
        <div className="cf-feature-strip">
          <div className="cf-strip-item">
            <div className="cf-strip-head">
              <WandSparkles size={16} className="dialogue-color" />
              <h4>Smart Clip Enhancement</h4>
            </div>
            <p>
              Generate and cycle hook-typed titles, preview caption placement and
              9:16 / 16:9 / 1:1 framing guidance, review pacing notes, and export
              SRT subtitle files.
            </p>
          </div>

          <div className="cf-strip-item">
            <div className="cf-strip-head">
              <Users size={16} className="footage-color" />
              <h4>Speaker Intelligence</h4>
            </div>
            <p>
              Inspect color-coded speaker timelines, rename labels across the
              entire transcript, reassign individual segments, and flag overlapping
              speech.
            </p>
          </div>

          <div className="cf-strip-item">
            <div className="cf-strip-head">
              <Download size={16} className="cf-lime" />
              <h4>Direct MP4 & Batch Export</h4>
            </div>
            <p>
              Trim uploaded MP4 footage with FFmpeg in fast stream-copy or
              accurate re-encode mode—individually or bundled via batch ZIP
              export.
            </p>
          </div>

          <div className="cf-strip-item">
            <div className="cf-strip-head">
              <Layers2 size={16} className="ai-color" />
              <h4>Precise Boundary Control</h4>
            </div>
            <p>
              Preview discovered time ranges inside the player, adjust exact
              start/end seconds in place, and verify excerpt text before saving.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
