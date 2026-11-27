import { useEffect, useRef } from "react";
import LandingNavbar from "./LandingNavbar";
import HeroSection from "./HeroSection";
import VisualInterlude from "./VisualInterlude";
import CreativeExperienceSection from "./CreativeExperienceSection";
import UseCasesSection from "./UseCasesSection";
import FinalCtaAndFooter from "./FinalCtaAndFooter";
import { LandingRoute } from "./landingData";

interface LandingPageProps {
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const prefersReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const targets = Array.from(
      root.querySelectorAll<HTMLElement>(".cf-reveal"),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="cf-landing-root">
      <LandingNavbar currentRoute="/" onNavigate={onNavigate} />
      <main>
        <HeroSection onNavigate={onNavigate} />
        <div className="cf-reveal">
          <VisualInterlude />
        </div>
        <div className="cf-reveal">
          <CreativeExperienceSection onNavigate={onNavigate} />
        </div>
        <div className="cf-reveal">
          <UseCasesSection onNavigate={onNavigate} />
        </div>
      </main>
      <div className="cf-reveal">
        <FinalCtaAndFooter onNavigate={onNavigate} />
      </div>
    </div>
  );
}
