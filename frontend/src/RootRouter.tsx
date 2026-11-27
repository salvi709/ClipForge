import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App";
import LandingPage from "./landing/LandingPage";
import LegalAndInfoPage from "./landing/LegalAndInfoPage";
import { LandingRoute } from "./landing/landingData";

function normalizeRoute(pathname: string): LandingRoute {
  if (pathname === "/app" || pathname.startsWith("/app/")) return "/app";
  if (pathname === "/workspace") return "/app";
  if (pathname === "/privacy") return "/privacy";
  if (pathname === "/terms") return "/terms";
  if (pathname === "/contact") return "/contact";
  return "/";
}

function scrollToTarget(hash?: string) {
  if (!hash) {
    try {
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch {
      // Ignore in environments where scrollTo is unimplemented
    }
    return;
  }
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  const element = document.getElementById(id);
  if (element && typeof element.scrollIntoView === "function") {
    const prefersReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({
      behavior: prefersReduced ? "auto" : "smooth",
      block: "start",
    });
  }
}

export default function RootRouter() {
  const [route, setRoute] = useState<LandingRoute>(() =>
    normalizeRoute(window.location.pathname),
  );
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const onPopState = () => {
      setRoute(normalizeRoute(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (route === "/" && window.location.hash) {
      const hash = window.location.hash;
      rafRef.current = requestAnimationFrame(() => scrollToTarget(hash));
    }
  }, [route]);

  const navigate = useCallback((nextRoute: LandingRoute, hash?: string) => {
    const targetUrl = hash ? `${nextRoute}${hash}` : nextRoute;
    if (window.location.pathname + window.location.hash !== targetUrl) {
      window.history.pushState({}, "", targetUrl);
    }
    setRoute(nextRoute);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => scrollToTarget(hash));
  }, []);

  if (route === "/app") {
    return <App onNavigateHome={() => navigate("/")} />;
  }

  if (route === "/privacy" || route === "/terms" || route === "/contact") {
    return <LegalAndInfoPage route={route} onNavigate={navigate} />;
  }

  return <LandingPage onNavigate={navigate} />;
}
