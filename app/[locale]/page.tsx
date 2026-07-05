import { setRequestLocale } from "next-intl/server";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import FeatureCards from "@/components/FeatureCards";
import HowItWorks from "@/components/HowItWorks";
import ShowcaseSection from "@/components/ShowcaseSection";
import MenuBoard from "@/components/MenuBoard";
import FaqSection from "@/components/FaqSection";
import WaitlistSection from "@/components/WaitlistSection";
import PartnerSection from "@/components/PartnerSection";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <JsonLd locale={locale} />
      <Header />
      <main>
        <Hero />
        <FeatureCards />
        <HowItWorks />
        <ShowcaseSection />
        <MenuBoard />
        <FaqSection />
        <WaitlistSection />
        <PartnerSection />
      </main>
      <Footer />
    </>
  );
}
