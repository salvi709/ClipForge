import { COMPACT_USE_CASES, LandingRoute } from "./landingData";

interface UseCasesSectionProps {
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

export default function UseCasesSection({ onNavigate }: UseCasesSectionProps) {
  return (
    <section className="cf-section cf-section-alt cf-usecases-compact" id="use-cases">
      <div className="cf-container">
        <div className="cf-compact-head">
          <h2>Built for every format worth cutting.</h2>
          <p>Select a category or open your own footage.</p>
        </div>

        <div className="cf-category-grid">
          {COMPACT_USE_CASES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`cf-cat-card cat-${item.id}`}
              onClick={() => onNavigate("/app")}
            >
              <div className="cf-cat-visual" aria-hidden="true">
                {item.id === "gaming" && (
                  <div className="cf-vis-gaming">
                    <span className="b1" />
                    <span className="b2" />
                    <span className="b3 peak" />
                    <span className="b4 peak" />
                    <span className="b5" />
                    <span className="b6 peak" />
                    <span className="b7" />
                  </div>
                )}
                {item.id === "podcasts" && (
                  <div className="cf-vis-podcasts">
                    <span className="turn t1" />
                    <span className="turn t2" />
                    <span className="turn t1 short" />
                  </div>
                )}
                {item.id === "education" && (
                  <div className="cf-vis-education">
                    <span className="chapter" />
                    <span className="line" />
                    <span className="line short" />
                  </div>
                )}
                {item.id === "vlogs" && (
                  <div className="cf-vis-vlogs">
                    <span className="vlog-frame" />
                  </div>
                )}
                {item.id === "entertainment" && (
                  <div className="cf-vis-entertainment">
                    <span className="cut c1" />
                    <span className="cut c2" />
                    <span className="cut c3" />
                  </div>
                )}
              </div>

              <div className="cf-cat-meta">
                <code>{item.timecode}</code>
                <span>{item.duration}</span>
              </div>
              <h3>{item.name}</h3>
              <p>{item.hint}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
