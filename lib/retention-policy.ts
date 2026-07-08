// Pure retention policy — config parsing + cutoff math, no DB import so it stays
// fully unit-testable (the DB sweep lives in lib/retention.ts). GDPR
// storage-limitation (Art. 5(1)(e)); DATA-LOSS class, so it is DISABLED unless
// RETENTION_ENABLED=true. Windows default to the privacy pack's recommendations
// and can be overridden per env on the box.

export interface RetentionConfig {
  enabled: boolean;
  inviteTokenDays: number;
  auditLogMonths: number;
  rejectedApplicationMonths: number;
}

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function retentionConfig(): RetentionConfig {
  return {
    enabled: process.env.RETENTION_ENABLED === "true",
    inviteTokenDays: positiveInt(process.env.RETENTION_INVITE_TOKEN_DAYS, 30),
    auditLogMonths: positiveInt(process.env.RETENTION_AUDIT_LOG_MONTHS, 18),
    rejectedApplicationMonths: positiveInt(process.env.RETENTION_REJECTED_APPLICATION_MONTHS, 12),
  };
}

export interface RetentionCutoffs {
  inviteTokenBefore: Date;
  auditLogBefore: Date;
  rejectedApplicationBefore: Date;
}

/** The instant before which each record type becomes eligible for purge. */
export function retentionCutoffs(now: Date, config: RetentionConfig): RetentionCutoffs {
  const minusDays = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const minusMonths = (months: number) => {
    const d = new Date(now.getTime());
    const expectedMonth = (((d.getUTCMonth() - months) % 12) + 12) % 12;
    d.setUTCMonth(d.getUTCMonth() - months);
    // Month-end guard: e.g. Mar 31 − 1mo overflows to "Feb 31" → Mar 3, which would
    // shift the cutoff FORWARD and purge records younger than the window. If the
    // month overflowed, clamp back to the last day of the intended month.
    if (d.getUTCMonth() !== expectedMonth) {
      d.setUTCDate(0);
    }
    return d;
  };
  return {
    inviteTokenBefore: minusDays(config.inviteTokenDays),
    auditLogBefore: minusMonths(config.auditLogMonths),
    rejectedApplicationBefore: minusMonths(config.rejectedApplicationMonths),
  };
}
