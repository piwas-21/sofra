"use client";

/**
 * Anchor to the waitlist form that also preselects the request type.
 * Decoupled via a window event so ShowcaseSection can stay a server
 * component and the form doesn't need URL state (which would force a
 * Suspense boundary around useSearchParams on an SSG page).
 */
export default function IntentLink({
  intent,
  className,
  children,
}: {
  intent: "waitlist" | "demo" | "call" | "quote";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href="#waitlist"
      className={className}
      onClick={() =>
        window.dispatchEvent(new CustomEvent("sofra:intent", { detail: intent }))
      }
    >
      {children}
    </a>
  );
}
