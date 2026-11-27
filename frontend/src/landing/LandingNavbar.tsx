import { useEffect, useState } from "react";
import { ArrowUpRight, Layers2, Menu, X } from "lucide-react";
import { LandingRoute } from "./landingData";

interface LandingNavbarProps {
  currentRoute: LandingRoute;
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

const NAV_LINKS = [
  { label: "Inside", hash: "#interlude" },
  { label: "Experience", hash: "#experience" },
  { label: "Use Cases", hash: "#use-cases" },
];

export default function LandingNavbar({
  onNavigate,
}: LandingNavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSectionLink = (hash: string) => {
    setMobileOpen(false);
    onNavigate("/", hash);
  };

  return (
    <header className={`cf-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="cf-nav-inner">
        <a
          href="/"
          className="cf-nav-brand"
          onClick={(event) => {
            event.preventDefault();
            setMobileOpen(false);
            onNavigate("/");
          }}
          aria-label="ClipForge home"
        >
          <span className="brand-icon cf-nav-icon">
            <Layers2 size={18} />
          </span>
          <span>
            ClipForge<span className="brand-dot">.</span>
          </span>
        </a>

        <nav className="cf-nav-links" aria-label="Primary navigation">
          {NAV_LINKS.map((item) => (
            <a
              key={item.hash}
              href={`/${item.hash}`}
              className="cf-nav-link"
              onClick={(event) => {
                event.preventDefault();
                handleSectionLink(item.hash);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="cf-nav-actions">
          <button
            type="button"
            className="primary cf-nav-cta"
            onClick={() => onNavigate("/app")}
          >
            Explore ClipForge <ArrowUpRight size={15} />
          </button>
          <button
            type="button"
            className="cf-mobile-toggle"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="cf-mobile-drawer">
          <nav className="cf-mobile-links" aria-label="Mobile navigation">
            {NAV_LINKS.map((item) => (
              <a
                key={item.hash}
                href={`/${item.hash}`}
                className="cf-mobile-link"
                onClick={(event) => {
                  event.preventDefault();
                  handleSectionLink(item.hash);
                }}
              >
                {item.label}
              </a>
            ))}
            <div className="cf-mobile-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setMobileOpen(false);
                  onNavigate("/app");
                }}
              >
                Explore ClipForge <ArrowUpRight size={15} />
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
