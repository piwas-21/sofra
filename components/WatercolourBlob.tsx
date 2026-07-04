/**
 * Self-hosted watercolour wash — layered translucent organic shapes with a
 * turbulence-displaced edge, so it reads as pigment on paper. Uses craft
 * tokens, so it re-tints itself in dark mode (unlike domainio's hot-linked
 * PNG, which this deliberately replaces).
 */
export default function WatercolourBlob({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 600"
      className={className}
      aria-hidden
      role="presentation"
    >
      <defs>
        <filter id="wc" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012"
            numOctaves="3"
            seed="7"
            result="noise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="55" />
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>
      <g filter="url(#wc)">
        <path
          d="M300 90c95-28 200 20 222 110 21 86-38 160-104 205-70 48-172 60-238 4C110 350 90 245 132 168 168 102 222 113 300 90z"
          fill="hsl(var(--craft-terracotta) / 0.28)"
        />
        <path
          d="M330 150c70-14 150 30 160 100 11 72-40 128-100 158-64 32-140 30-186-18-48-50-46-130-6-182 36-47 74-44 132-58z"
          fill="hsl(var(--craft-saffron) / 0.22)"
        />
        <path
          d="M270 220c52-20 118 2 140 52 24 52-4 110-52 140-50 32-116 28-152-14-38-44-28-108 8-144 22-22 26-22 56-34z"
          fill="hsl(var(--craft-olive) / 0.20)"
        />
      </g>
    </svg>
  );
}
