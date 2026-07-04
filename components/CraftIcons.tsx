/**
 * Hand-drawn style icons — deliberately wobbly strokes, no icon library.
 * All inherit currentColor so they recolour with the text they sit in.
 */
type IconProps = { className?: string };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function QrIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...base}>
      <path d="M8 8.6c3.1-.4 6.2-.3 9.3-.1.3 3 .2 6 .1 9.1-3.2.3-6.3.2-9.5 0-.2-3-.1-6 .1-9z" />
      <path d="M12.4 12.8h.9v.8h-.9z" strokeWidth={3} />
      <path d="M30.6 8.4c3.2-.2 6.3-.1 9.4.2.2 2.9.1 5.9-.2 8.9-3 .3-6.1.2-9.2 0-.2-3-.1-6 0-9.1z" />
      <path d="M35 12.8h.9v.8H35z" strokeWidth={3} />
      <path d="M8.2 30.8c3.1-.3 6.2-.2 9.3 0 .2 3 .1 6-.1 9-3.1.2-6.2.1-9.2-.2-.2-2.9-.1-5.8 0-8.8z" />
      <path d="M12.6 35.1h.9v.8h-.9z" strokeWidth={3} />
      <path d="M30.5 30.6l4.6.2M39.8 30.8v4.4M30.7 35.3l4.4 4.5M39.9 39.6l-.2.2" />
      <path d="M24 8.5v6.8M24 22.4c-5.2.4-10.4.3-15.7.1M24 22.4c5.1-.3 10.3-.2 15.6 0M24 30.9v8.6" />
    </svg>
  );
}

export function BoardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...base}>
      <path d="M7.8 10.6c10.8-.7 21.6-.6 32.5-.1.4 8.7.3 17.3-.2 26-10.7.5-21.4.4-32.1-.1-.5-8.6-.4-17.2-.2-25.8z" />
      <path d="M13.4 18.2c4.1-.3 8.2-.2 12.3 0M13.5 24.1l8.6.2M13.3 30l10.4-.1" />
      <path d="M31.5 21.9c1.9-2 3.9-2 5.5-.1 1.4 1.8 1 3.9-.8 5.4l-2.4 2-2.5-2.2c-1.6-1.6-1.7-3.4.2-5.1z" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...base}>
      <path d="M8.4 12.8c10.4-.6 20.9-.5 31.4-.1.4 8.1.3 16.2-.2 24.4-10.3.5-20.7.4-31-.1-.4-8-.3-16.1-.2-24.2z" />
      <path d="M15.2 8.3v7.2M32.9 8.5l-.2 7M8.7 20.4c10.3-.4 20.6-.3 30.9 0" />
      <path d="M15 27.2l3.2 3.3c2.4-3 4.9-5.8 7.7-8.4" />
      <path d="M28.8 30.4l5.4.1M28.9 25.8h5.2" />
    </svg>
  );
}

export function HeartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...base}>
      <path d="M24 39.2C16.9 34 11 28.9 8.6 23.4c-2.3-5.4.2-10.6 5.2-11.9 3.6-.9 7.1.6 10.1 4.3 3.1-3.8 6.7-5.3 10.3-4.2 5 1.5 7.3 6.7 4.8 12.1C36.6 29.2 30.9 34.2 24 39.2z" />
      <path d="M18.9 20.1c1.6 1.1 3 2.4 4.2 3.9" />
    </svg>
  );
}

export function PrinterIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...base}>
      <path d="M14.2 16.4c-.2-2.9-.1-5.7.1-8.5 6.4-.4 12.8-.3 19.3.1.2 2.7.2 5.4 0 8.2" />
      <path d="M9.1 16.6c9.9-.5 19.9-.4 29.9-.1 2 .1 3 1.1 3 3.1.1 3.6 0 7.2-.3 10.8-4 .3-8 .4-12 .4M18.4 30.8c-4.1 0-8.2-.1-12.3-.4-.3-3.5-.4-7-.3-10.5 0-1.9 1-2.9 3.3-3.3" />
      <path d="M14.4 26.2c.4 4.7.4 9.3.1 14 6.3.4 12.6.4 19 0 .3-4.6.2-9.2-.2-13.8-6.2-.4-12.5-.4-18.9-.2z" />
      <path d="M19 31.4c3.3-.2 6.6-.2 10 0M19.1 35.6l9.8.1" />
      <path d="M34.6 21.1h.8" strokeWidth={3} />
    </svg>
  );
}

export function GlobeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...base}>
      <path d="M24 8.3c8.8-.2 15.6 6.6 15.7 15.5.1 8.9-6.7 15.9-15.5 16-8.8 0-15.8-6.9-15.9-15.7C8.2 15.3 15.1 8.5 24 8.3z" />
      <path d="M24 8.5c-4.3 4.8-6.4 10-6.3 15.6.1 5.6 2.3 10.7 6.5 15.5 4.1-4.9 6.1-10.1 6-15.7-.1-5.6-2.2-10.7-6.2-15.4z" />
      <path d="M9.3 19.4c9.8-.6 19.6-.5 29.4.1M9.5 29.2c9.7.5 19.4.5 29-.1" />
    </svg>
  );
}
