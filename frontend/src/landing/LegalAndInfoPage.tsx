import { ArrowLeft, ArrowUpRight, FileText, ShieldCheck } from "lucide-react";
import { LandingRoute } from "./landingData";
import LandingNavbar from "./LandingNavbar";
import FinalCtaAndFooter from "./FinalCtaAndFooter";

interface LegalAndInfoPageProps {
  route: "/privacy" | "/terms" | "/contact";
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

export default function LegalAndInfoPage({
  route,
  onNavigate,
}: LegalAndInfoPageProps) {
  return (
    <div className="cf-landing-root">
      <LandingNavbar currentRoute={route} onNavigate={onNavigate} />
      <main className="cf-legal-main">
        <div className="cf-container cf-legal-container">
          <button
            type="button"
            className="text-button cf-back-link"
            onClick={() => onNavigate("/")}
          >
            <ArrowLeft size={14} /> Back to ClipForge overview
          </button>

          {route === "/privacy" && (
            <article className="panel cf-legal-card">
              <div className="cf-legal-eyebrow">
                <ShieldCheck size={15} className="dialogue-color" /> PRIVACY NOTICE (TEMPLATE)
              </div>
              <h1>Privacy Policy</h1>
              <p className="cf-legal-notice">
                Informational draft notice describing how this ClipForge workspace
                handles data by default. Review and customize with counsel before
                hosting publicly for third-party users.
              </p>

              <section>
                <h2>1. Local-First Media &amp; Project Data</h2>
                <p>
                  Uploaded MP4 videos, transcripts, audio/visual analysis signals,
                  speaker labels, discovered clips, and exported MP4/SRT files are
                  stored in the configured workspace storage directory on the host
                  machine running the ClipForge server.
                </p>
              </section>

              <section>
                <h2>2. No User Account Tracking</h2>
                <p>
                  ClipForge does not create user profiles, collect login
                  credentials, or run third-party advertising trackers. Project
                  records exist solely to render your workspace and let you delete
                  projects cleanly from local storage.
                </p>
              </section>

              <section>
                <h2>3. YouTube Link Metadata Requests</h2>
                <p>
                  When you submit a YouTube URL inside the YouTube Link workflow,
                  the server initiates a network request to validate the link and
                  fetch public video metadata (title/author). Manual transcript
                  imports (.srt, .vtt, plain text) remain on your ClipForge host.
                </p>
              </section>
            </article>
          )}

          {route === "/terms" && (
            <article className="panel cf-legal-card">
              <div className="cf-legal-eyebrow">
                <FileText size={15} className="footage-color" /> TERMS OF USE (TEMPLATE)
              </div>
              <h1>Terms of Service</h1>
              <p className="cf-legal-notice">
                Informational draft template for self-hosted and workspace
                evaluation use. Customize before deploying ClipForge as a hosted
                commercial service.
              </p>

              <section>
                <h2>1. Content Rights &amp; Permissions</h2>
                <p>
                  You are responsible for ensuring you own or hold permission to
                  process uploaded MP4 recordings, imported transcripts, and
                  referenced YouTube links inside ClipForge.
                </p>
              </section>

              <section>
                <h2>2. Automated Analysis &amp; Editorial Review</h2>
                <p>
                  Clip discovery scores, category classifications, speaker labels,
                  and enhancement suggestions are decision-support recommendations.
                  Always review boundaries, captions, and final exports prior to
                  publishing.
                </p>
              </section>

              <section>
                <h2>3. Local Project Removal</h2>
                <p>
                  Deleting a project inside the ClipForge workspace removes its
                  stored video, transcript, and derived clip metadata from the host
                  workspace storage directory.
                </p>
              </section>
            </article>
          )}

          {route === "/contact" && (
            <article className="panel cf-legal-card">
              <div className="cf-legal-eyebrow">
                <FileText size={15} className="cf-lime" /> WORKSPACE SUPPORT &amp; SETUP
              </div>
              <h1>Contact &amp; Workspace Information</h1>
              <p className="cf-legal-notice">
                ClipForge runs directly against its local Express &amp; FFmpeg
                server on port 3000 without external cloud account dependencies.
              </p>

              <section>
                <h2>Local Engine &amp; Diagnostics</h2>
                <p>
                  Verify backend readiness anytime at <code>/api/health</code>. The
                  workspace displays live connection status, FFmpeg availability,
                  and maximum upload limits automatically inside the top bar.
                </p>
              </section>

              <section>
                <h2>Open the Workspace</h2>
                <p>
                  Ready to transcribe an MP4 file or analyze a YouTube transcript?
                  Launch the workspace directly below.
                </p>
                <button
                  type="button"
                  className="primary cf-legal-cta"
                  onClick={() => onNavigate("/app")}
                >
                  Open ClipForge Workspace <ArrowUpRight size={15} />
                </button>
              </section>
            </article>
          )}
        </div>
      </main>
      <FinalCtaAndFooter onNavigate={onNavigate} showCtaBand={false} />
    </div>
  );
}
