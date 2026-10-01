import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const raw = process.env.PRINTER_CREDENTIAL_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error("Printer credential encryption unavailable");
  return Buffer.from(raw, "hex");
}
export function printerCredentialsConfigured(): boolean {
  return /^[a-f0-9]{64}$/i.test(process.env.PRINTER_CREDENTIAL_ENCRYPTION_KEY ?? "");
}
export function fingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
export function newPrinterKey(): string { return randomBytes(32).toString("hex"); }
// Bind ciphertext to the tenant AND purpose: copying a row cannot transplant a key.
export function encryptPrinterKey(key: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}
export function decryptPrinterKey(value: string, context: string): string {
  const [version, iv, tag, data] = value.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Invalid printer ciphertext");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "hex"), { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([cipher.update(Buffer.from(data, "hex")), cipher.final()]).toString("utf8");
}
