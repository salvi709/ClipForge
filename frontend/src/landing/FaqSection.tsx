import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FAQ_ITEMS } from "./landingData";

export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="cf-section" id="faq">
      <div className="cf-container cf-faq-layout">
        <div className="cf-faq-intro">
          <div className="eyebrow">FREQUENTLY ASKED QUESTIONS</div>
          <h2>Straight Answers About ClipForge.</h2>
          <p>
            Details on how transcription, clip scoring, YouTube link workflows,
            and local exports work in the current workspace.
          </p>
        </div>

        <div className="cf-faq-list">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openIndex === idx;
            const panelId = `faq-panel-${idx}`;
            return (
              <div
                key={item.question}
                className={`cf-faq-item ${isOpen ? "open" : ""}`}
              >
                <button
                  type="button"
                  className="cf-faq-trigger"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                >
                  <span>{item.question}</span>
                  <ChevronDown size={16} className="cf-faq-chevron" />
                </button>
                <div id={panelId} className="cf-faq-answer" hidden={!isOpen}>
                  <p>{item.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
