import { setRequestLocale } from "next-intl/server";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import FeatureCards from "@/components/FeatureCards";
import HowItWorks from "@/components/HowItWorks";
import MenuBoard from "@/components/MenuBoard";
import WaitlistSection from "@/components/WaitlistSection";
import Footer from "@/components/Footer";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Header />
      <main>
        <Hero />
        <FeatureCards />
        <HowItWorks />
        <MenuBoard />
        <WaitlistSection />
      </main>
      <Footer />
    </>
  );
}
