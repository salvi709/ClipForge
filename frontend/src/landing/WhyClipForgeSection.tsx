import { Check, HardDrive, SlidersHorizontal, ShieldCheck } from "lucide-react";

export default function WhyClipForgeSection() {
  return (
    <section className="cf-section cf-section-alt" id="why-clipforge">
      <div className="cf-container cf-why-grid">
        <div className="cf-why-copy">
          <div className="eyebrow">WHY CLIPFORGE</div>
          <h2>Less Searching. More Creating.</h2>
          <p className="cf-why-lead">
            Hours of footage usually hide four or five moments worth sharing.
            ClipForge eliminates blind timeline scrubbing without turning your
            edit into an opaque black box.
          </p>

          <div className="cf-why-pillars">
            <div className="cf-pillar">
              <HardDrive size={17} className="cf-lime" />
              <div>
                <h3>Local Media Pipeline</h3>
                <p>
                  Uploaded MP4s are probed, analyzed, stored, and cut on your
                  local server. External requests only occur when resolving
                  YouTube metadata for pasted links.
                </p>
              </div>
            </div>

            <div className="cf-pillar">
              <SlidersHorizontal size={17} className="footage-color" />
              <div>
                <h3>Human-in-the-Loop Control</h3>
                <p>
                  Override detected categories, rename speaker tags, fine-tune
                  start and end seconds, log missed moments, and accept or reject
                  any recommendation.
                </p>
              </div>
            </div>

            <div className="cf-pillar">
              <ShieldCheck size={17} className="dialogue-color" />
              <div>
                <h3>Evidence Behind Every Score</h3>
                <p>
                  Instead of a single mysterious number, inspect Hook,
                  Information, Context, Clarity, audio signals, and visual
                  boundary notes side by side.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="cf-compare-panel panel">
          <div className="panel-heading">
            <span>WORKFLOW COMPARISON</span>
            <span className="micro-label">MANUAL VS. CLIPFORGE</span>
          </div>

          <div className="cf-compare-cols">
            <div className="cf-compare-col muted">
              <div className="cf-compare-label">Manual Timeline Scrubbing</div>
              <ul>
                <li>Re-watch entire 60–90 minute recordings at 2× speed</li>
                <li>Lose track of timestamps across separate notes files</li>
                <li>Manually write subtitles and clip title variations</li>
                <li>Re-render every candidate cut inside heavy NLE timelines</li>
              </ul>
            </div>

            <div className="cf-compare-col active">
              <div className="cf-compare-label">With ClipForge</div>
              <ul>
                <li>
                  <Check size={14} className="cf-lime" />
                  <span>Jump directly to ranked Top Picks in seconds</span>
                </li>
                <li>
                  <Check size={14} className="cf-lime" />
                  <span>Search dialogue & speaker turns with synced playback</span>
                </li>
                <li>
                  <Check size={14} className="cf-lime" />
                  <span>Generate hook titles, SRT files & platform framing cues</span>
                </li>
                <li>
                  <Check size={14} className="cf-lime" />
                  <span>Export clean MP4 clips via FFmpeg fast or accurate mode</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
