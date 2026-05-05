import { ComparisonSection } from '@/components/site/ComparisonSection';
import { DesktopDashboardSection } from '@/components/site/DesktopDashboardSection';
import { FaqSection } from '@/components/site/FaqSection';
import { FeaturesSection } from '@/components/site/FeaturesSection';
import { FinalCta } from '@/components/site/FinalCta';
import { Footer } from '@/components/site/Footer';
import { FullDemoSection } from '@/components/site/FullDemoSection';
import { Hero } from '@/components/site/Hero';
import { InstallSection } from '@/components/site/InstallSection';
import { LoopSection } from '@/components/site/LoopSection';
import { Nav } from '@/components/site/Nav';
import { RuntimeStrip } from '@/components/site/RuntimeStrip';
import { WhySection } from '@/components/site/WhySection';

/**
 * Landing page composition.
 *
 * Section order is tuned for two audiences read in opposite
 * directions:
 *
 *   - Top-down (visitor): Hero → DesktopDashboard → narrated demo →
 *     runtime strip → product loop → "why" → features → comparison
 *     → install → FAQ → CTA. The visitor sees the *product* first,
 *     then the proof, then the comparison, then the install.
 *
 *   - Crawler / SERP (Google, Bing, LLM): The same DOM order
 *     surfaces the high-SEO sections at decision points — the
 *     `<ComparisonSection />` lives between Features and Install
 *     so visitors landing from "Foreman alternative" queries hit
 *     the proof + the install CTA without scrolling back. The
 *     `<FaqSection />` lives below Install so visitors who
 *     converted skip it, and visitors who didn't get one more
 *     objection-handling pass before the FinalCta.
 */
export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <DesktopDashboardSection />
        <FullDemoSection />
        <RuntimeStrip />
        <LoopSection />
        <WhySection />
        <FeaturesSection />
        <ComparisonSection />
        <InstallSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
