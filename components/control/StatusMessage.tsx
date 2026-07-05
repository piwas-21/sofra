export function ErrorMessage({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="font-label text-destructive">
      {children}
    </p>
  );
}

export function SuccessMessage({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="hand-drawn-border bg-card px-5 py-4 font-hand text-2xl text-craft-olive-text dark:text-craft-olive-dark"
    >
      {children}
    </p>
  );
}
