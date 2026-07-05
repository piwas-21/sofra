const STYLES: Record<string, string> = {
  LEAD: "border-border text-muted-foreground",
  CONTACTED: "border-craft-saffron-text text-craft-saffron-text dark:border-craft-saffron-dark dark:text-craft-saffron-dark",
  DEMO_SCHEDULED: "border-craft-saffron-text text-craft-saffron-text dark:border-craft-saffron-dark dark:text-craft-saffron-dark",
  AGREED: "border-craft-olive-text text-craft-olive-text dark:border-craft-olive-dark dark:text-craft-olive-dark",
  ONBOARDING: "border-primary text-primary",
  LIVE: "border-craft-success-text text-craft-success-text dark:border-craft-success dark:text-craft-success",
  CHURNED: "border-destructive text-destructive",
};

const LABELS: Record<string, string> = {
  LEAD: "Lead",
  CONTACTED: "Contacted",
  DEMO_SCHEDULED: "Demo scheduled",
  AGREED: "Agreed",
  ONBOARDING: "Onboarding",
  LIVE: "Live",
  CHURNED: "Churned",
};

export default function ClientStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-craft border-2 px-2.5 py-0.5 font-label text-sm ${STYLES[status] ?? STYLES.LEAD}`}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
