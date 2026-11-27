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
        <section className="cf-cta-section">
          <div className="cf-container cf-cta-box">
            <div>
              <div className="eyebrow">READY IN YOUR WORKSPACE</div>
              <h2>Your Next Great Clip Starts Here.</h2>
              <p>
                Open ClipForge to upload an MP4 recording or inspect a YouTube
                transcript—with transparent scoring, timeline previewing, and
                export tools ready immediately.
              </p>
            </div>
            <div className="cf-cta-actions">
              <button
                type="button"
                className="primary cf-btn-lg"
                onClick={() => onNavigate("/app")}
              >
                Get Started <ArrowUpRight size={16} />
              </button>
              <button
                type="button"
                className="secondary cf-btn-lg"
                onClick={() => onNavigate("/app")}
              >
                Explore the Platform
              </button>
            </div>
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
              Intelligent video analysis and clip discovery for modern creators.
            </p>
          </div>

          <div className="cf-footer-col">
            <h3>Product</h3>
            <ul>
              <li>
                <a
                  href="/#features"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/", "#features");
                  }}
                >
                  Features
                </a>
              </li>
              <li>
                <a
                  href="/#how-it-works"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/", "#how-it-works");
                  }}
                >
                  How It Works
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
                  Explore the App
                </a>
              </li>
            </ul>
          </div>

          <div className="cf-footer-col">
            <h3>Resources</h3>
            <ul>
              <li>
                <a
                  href="/#showcase"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/", "#showcase");
                  }}
                >
                  Interactive Preview
                </a>
              </li>
              <li>
                <a
                  href="/#faq"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/", "#faq");
                  }}
                >
                  FAQ
                </a>
              </li>
              <li>
                <a
                  href="/contact"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate("/contact");
                  }}
                >
                  Contact & Setup Info
                </a>
              </li>
            </ul>
          </div>

          <div className="cf-footer-col">
            <h3>Legal</h3>
            <ul>
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
          <span>ClipForge · Local transcription &amp; clip discovery workspace</span>
          <span>No user accounts required · MP4 &amp; YouTube transcript workflows</span>
        </div>
      </footer>
    </>
  );
}
