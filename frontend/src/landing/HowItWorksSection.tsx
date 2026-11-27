import { HOW_IT_WORKS_STEPS } from "./landingData";

export default function HowItWorksSection() {
  return (
    <section className="cf-section cf-section-alt" id="how-it-works">
      <div className="cf-container">
        <div className="cf-section-header">
          <div>
            <div className="eyebrow">WORKFLOW</div>
            <h2>Four Clear Steps From Raw Footage to Ready Clips.</h2>
          </div>
          <p className="cf-section-lead">
            No complex node graphs or bloated timelines—just a straight line from
            source footage to verified cuts.
          </p>
        </div>

        <ol className="cf-steps-grid">
          {HOW_IT_WORKS_STEPS.map((item) => (
            <li key={item.step} className="cf-step-card">
              <div className="cf-step-top">
                <span className="cf-step-num">{item.step}</span>
                <span className="cf-step-line" aria-hidden="true" />
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <div className="cf-step-detail">{item.detail}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
