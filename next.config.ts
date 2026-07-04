import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Standalone output for the Docker image (same pattern as the RUMI frontend).
  output: "standalone",
};

export default withNextIntl(nextConfig);
