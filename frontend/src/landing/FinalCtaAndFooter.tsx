import { ArrowUpRight, Layers2 } from "lucide-react";
import { LandingRoute } from "./landingData";

interface FinalCtaAndFooterProps {
  onNavigate: (route: LandingRoute, hash?: string) => void;
  showCtaBand?: boolean;
}

export default function FinalCtaAndFooter({
  onNavigate,
  showCtaBand = true,
}: FinalCtaAndFooterProps) {
  return (
    <>
      {showCtaBand && (
        <section className="cf-final-cta">
          <div className="cf-cta-ambient" aria-hidden="true" />

          {/* Subtle cropped edge UI fragments framing the closing CTA */}
          <div className="cf-cta-edge-frag left" aria-hidden="true">
            <code>04:12 — 04:58</code>
            <span>“Until you watch an editor hesitate...”</span>
          </div>
          <div className="cf-cta-edge-frag right" aria-hidden="true">
            <span>Boundary aligned</span>
            <code>00:46</code>
          </div>

          <div className="cf-container cf-final-inner">
            <h2>Your Next Great Clip Is Waiting.</h2>
            <p>
              Step inside the workspace and see what your footage holds.
            </p>
            <button
              type="button"
              className="primary cf-btn-lg"
              onClick={() => onNavigate("/app")}
            >
              Start Exploring <ArrowUpRight size={16} />
            </button>
          </div>
        </section>
      )}

      <footer className="cf-footer">
        <div className="cf-container cf-footer-grid">
          <div className="cf-footer-brand">
            <a
              href="/"
              className="cf-nav-brand"
              onClick={(event) => {
                event.preventDefault();
                onNavigate("/");
              }}
            >
              <span className="brand-icon cf-nav-icon">
                <Layers2 size={18} />
              </span>
              <span>
                ClipForge<span className="brand-dot">.</span>
              </span>
            </a>
            <p>
              Intelligent moment discovery for long-form video.
            </p>
          </div>

          <div className="cf-footer-col">
            <h3>Product</h3>
            <ul>
              <li>
                <a
                  href="/#interlude"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/", "#interlude");
                  }}
                >
                  Inside
                </a>
              </li>
              <li>
                <a
                  href="/#experience"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/", "#experience");
                  }}
                >
                  Experience
                </a>
              </li>
              <li>
                <a
                  href="/#use-cases"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/", "#use-cases");
                  }}
                >
                  Use Cases
                </a>
              </li>
              <li>
                <a
                  href="/app"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/app");
                  }}
                >
                  Explore ClipForge
                </a>
              </li>
            </ul>
          </div>

          <div className="cf-footer-col">
            <h3>Links</h3>
            <ul>
              <li>
                <a
                  href="/contact"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/contact");
                  }}
                >
                  Workspace Info
                </a>
              </li>
              <li>
                <a
                  href="/privacy"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/privacy");
                  }}
                >
                  Privacy Policy
                </a>
              </li>
              <li>
                <a
                  href="/terms"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/terms");
                  }}
                >
                  Terms of Service
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="cf-container cf-footer-bottom">
          <span>© 2026 ClipForge. Built for creators.</span>
          <span>Local workspace · Port 3000</span>
        </div>
      </footer>
    </>
  );
}
