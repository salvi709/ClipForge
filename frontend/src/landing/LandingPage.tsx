import LandingNavbar from "./LandingNavbar";
import HeroSection from "./HeroSection";
import ProductShowcase from "./ProductShowcase";
import FeaturesSection from "./FeaturesSection";
import HowItWorksSection from "./HowItWorksSection";
import UseCasesSection from "./UseCasesSection";
import WhyClipForgeSection from "./WhyClipForgeSection";
import FaqSection from "./FaqSection";
import FinalCtaAndFooter from "./FinalCtaAndFooter";
import { LandingRoute } from "./landingData";

interface LandingPageProps {
  onNavigate: (route: LandingRoute, hash?: string) => void;
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="cf-landing-root">
      <LandingNavbar currentRoute="/" onNavigate={onNavigate} />
      <main>
        <HeroSection onNavigate={onNavigate} />
        <ProductShowcase onNavigate={onNavigate} />
        <FeaturesSection />
        <HowItWorksSection />
        <UseCasesSection />
        <WhyClipForgeSection />
        <FaqSection />
      </main>
      <FinalCtaAndFooter onNavigate={onNavigate} />
    </div>
  );
}
