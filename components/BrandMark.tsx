type BrandMarkProps = { className?: string };

/**
 * The SofraPiwas onion mark (piwas). Decorative in the brand lockup — the
 * adjacent "SofraPiwas" wordmark carries the accessible name — so it's
 * `aria-hidden` with an empty alt. A static SVG served from /public; next/image
 * would add no value (no optimization for inline vector) so a plain <img> is used.
 */
export default function BrandMark({ className }: BrandMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG logo, no next/image optimization
    <img
      src="/mark.svg"
      alt=""
      aria-hidden="true"
      width={452}
      height={501}
      className={className}
    />
  );
}
