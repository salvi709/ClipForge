import { useState } from "react";
import { INTERLUDE_FRAMES } from "./landingData";

export default function VisualInterlude() {
  const [focusedId, setFocusedId] = useState(INTERLUDE_FRAMES[1].id);
  const focused =
    INTERLUDE_FRAMES.find((frame) => frame.id === focusedId) ??
    INTERLUDE_FRAMES[1];

  return (
    <section className="cf-interlude" id="interlude">
      <div className="cf-container">
        <div className="cf-interlude-header">
          <h2>Some moments deserve more than a timestamp.</h2>
          <div className="cf-interlude-readout">
            <code>{focused.timecode}</code>
            <span className="cf-sep">·</span>
            <span>{focused.caption}</span>
          </div>
        </div>
      </div>

      <div className="cf-interlude-ribbon-wrap">
        <div className="cf-container">
          <div className="cf-filmstrip" role="group" aria-label="Video moments filmstrip">
            {INTERLUDE_FRAMES.map((frame) => {
              const active = frame.id === focused.id;
              return (
                <button
                  key={frame.id}
                  type="button"
                  className={`cf-film-frame ${frame.intensity} ${active ? "active" : ""}`}
                  onClick={() => setFocusedId(frame.id)}
                  onMouseEnter={() => setFocusedId(frame.id)}
                >
                  <div className="cf-film-preview" aria-hidden="true">
                    <span className="cf-film-scan" />
                    <span className="cf-film-marker" />
                  </div>
                  <div className="cf-film-meta">
                    <code>{frame.timecode}</code>
                    <span>{frame.note}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="cf-interlude-wave" aria-hidden="true">
            <div className="cf-wave-track">
              <span className="cf-wave-sweep" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
