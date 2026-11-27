import { USE_CASES } from "./landingData";

export default function UseCasesSection() {
  return (
    <section className="cf-section" id="use-cases">
      <div className="cf-container">
        <div className="cf-section-header">
          <div>
            <div className="eyebrow">WHO IT SERVES</div>
            <h2>Adaptable Discovery Across Long-Form Formats.</h2>
          </div>
          <p className="cf-section-lead">
            Because ClipForge classifies content profiles automatically, discovery
            criteria adjust whether your video is a dialogue podcast or an action
            stream.
          </p>
        </div>

        <div className="cf-usecases-grid">
          {USE_CASES.map((item, idx) => (
            <article
              key={item.audience}
              className={`cf-usecase-card ${idx === 0 ? "featured" : ""}`}
            >
              <div className="cf-usecase-tag">{item.tag}</div>
              <h3>{item.audience}</h3>
              <p>{item.summary}</p>
              <div className="cf-usecase-foot">{item.workflow}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
