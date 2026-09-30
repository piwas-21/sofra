"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { revealPrinterKey, renewPrinterKey } from "@/lib/actions/printer-access-actions";

type Props = { failed: boolean; slug: string; name: string; apiUrl: string; ready: boolean;
  pending: boolean; reported: boolean; fingerprint: string | null; syncedAt: string | null; enabled: boolean };
export default function PrinterAccessCard(props: Readonly<Props>) {
  const t = useTranslations("control.admin.printers");
  const router = useRouter();
  const [state, action, submitting] = useActionState(renewPrinterKey, {});
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [revealing, transition] = useTransition();
  const pending = props.pending || !!state.ok;
  useEffect(() => { setSecret(""); setCopied(false); }, [props.fingerprint, pending]);
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(() => setSecret(""), 60_000);
    const hide = () => { if (document.hidden) setSecret(""); };
    document.addEventListener("visibilitychange", hide);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", hide); };
  }, [secret]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [pending, router]);
  let status = "waiting";
  if (props.reported) status = "stale";
  if (props.ready) status = "ready";
  if (pending) status = "pending";
  if (pending && props.failed) status = "pendingFailed";
  async function copySetup() {
    try {
      await navigator.clipboard.writeText(`${t("apiUrl")}: ${props.apiUrl}\n${t("slug")}: ${props.slug}\n${t("token")}: ${secret}`);
      setCopied(true); setError("");
    } catch { setError("clipboard"); }
  }
  return (
    <li className="hand-drawn-border bg-card p-5 grid gap-4">
      <div><h2 className="font-hand text-3xl font-bold">{props.name}</h2>
        <p className="font-label text-muted-foreground">{props.slug}</p></div>
      <dl className="font-label grid gap-2">
        <div><dt className="text-muted-foreground">{t("apiUrl")}</dt><dd><code>{props.apiUrl}</code></dd></div>
        <div><dt className="text-muted-foreground">{t("slug")}</dt><dd><code>{props.slug}</code></dd></div>
        <div><dt className="text-muted-foreground">{t("token")}</dt><dd className="break-all"><code>{secret || "••••••••••••••••"}</code></dd></div>
      </dl>
      <output className="font-label text-sm">{t(status)}</output>
      {props.syncedAt && <p className="font-label text-sm text-muted-foreground">{t("lastSync")} <time dateTime={props.syncedAt}>{new Date(props.syncedAt).toLocaleString()}</time></p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" disabled={!props.ready || pending || revealing}
          onClick={() => secret ? setSecret("") : transition(async () => {
            const result = await revealPrinterKey(props.slug);
            if (result.key && !document.hidden) { setSecret(result.key); setError(""); }
            else if (!result.key) setError(result.error ?? "unavailable");
          })}>{t(secret ? "hide" : "reveal")}</button>
        {secret && <button type="button" className="btn-secondary" onClick={copySetup}>{t(copied ? "copied" : "copy")}</button>}
        <button type="button" className="underline font-label" onClick={() => router.refresh()}>{t("refresh")}</button>
      </div>
      {secret && <p className="font-label text-sm text-muted-foreground">{t("sharing")}</p>}
      <details className="border-t border-border pt-3">
        <summary className="font-label cursor-pointer">{t(props.fingerprint ? "renew" : "generate")}</summary>
        <p className="font-label mt-3">{t("renewWarning")}</p>
        <form action={action} className="grid gap-3 mt-3">
          <input type="hidden" name="tenantSlug" value={props.slug} />
          <label className="font-label">{t("confirm", { slug: props.slug })}
            <input name="confirmSlug" required autoComplete="off" className="block mt-1 border border-border bg-background rounded-md p-2 w-full" /></label>
          <button type="submit" className="btn-secondary justify-self-start" disabled={!props.enabled || !props.reported || pending || submitting}>{t("request")}</button>
        </form>
      </details>
      {(error || state.error) && <p role="alert" className="font-label text-craft-error-text">{t(`errors.${error || state.error}`)}</p>}
    </li>
  );
}
