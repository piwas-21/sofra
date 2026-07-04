/** Masking-tape section label — small strip of tape with handwritten text. */
export default function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="masking-tape inline-block font-label text-sm tracking-wide px-4 py-1 text-muted-foreground">
      {children}
    </span>
  );
}
