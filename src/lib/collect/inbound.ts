/**
 * Kayyro Collect: reading customers' replies (server only).
 *
 *   WhatsApp  360dialog posts each incoming message to
 *             /api/collect/inbound/whatsapp?k={the business's webhook key}
 *   Email     reminders carry a reply address reply+{message id}@{COLLECT_INBOUND_DOMAIN};
 *             Resend's receiving webhook posts to /api/collect/inbound/email
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type InboundWhatsApp = { from: string; id: string; text: string };

type WaMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};

/** Incoming text messages from a WhatsApp Cloud API webhook (the format 360dialog forwards). Status updates are ignored. */
export function parseWhatsAppWebhook(payload: unknown): InboundWhatsApp[] {
  const out: InboundWhatsApp[] = [];
  const entries = (payload as { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] })?.entry ?? [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        const text =
          m.type === "text"
            ? m.text?.body
            : m.type === "button"
              ? m.button?.text
              : m.type === "interactive"
                ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title)
                : undefined;
        if (m.from && m.id && text?.trim()) out.push({ from: m.from, id: m.id, text: text.trim() });
      }
    }
  }
  return out;
}

const REPLY_PREFIX = "reply+";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address customers reply to, when receiving is set up (otherwise null: replies go to the business). */
export function replyAddress(messageId: string, domain = process.env.COLLECT_INBOUND_DOMAIN): string | null {
  const d = domain?.trim().toLowerCase();
  if (!d || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  return `${REPLY_PREFIX}${messageId}@${d}`;
}

/** The reminder a reply belongs to, from its recipient addresses. */
export function messageIdFromAddresses(addresses: string[]): string | null {
  for (const a of addresses) {
    const local = extractEmail(a).split("@")[0] ?? "";
    if (local.startsWith(REPLY_PREFIX)) {
      const id = local.slice(REPLY_PREFIX.length);
      if (UUID.test(id)) return id.toLowerCase();
    }
  }
  return null;
}

/** "Ahmed <ahmed@example.com>" -> "ahmed@example.com" */
export function extractEmail(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return (m ? m[1] : value).trim().toLowerCase();
}

/** Only the new part of an email reply (drops the quoted reminder and signatures' quoted history). */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (
      /^On .{3,200} wrote:$/i.test(t) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(t) ||
      /^_{5,}$/.test(t) ||
      /^From: .+/i.test(t) ||
      /^في .{3,200} كتب.*:$/.test(t) ||
      /^Sent from my /i.test(t)
    ) {
      break;
    }
    if (t.startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

/**
 * Resend webhooks are signed with Svix: HMAC-SHA256 over "{id}.{timestamp}.{body}"
 * with the base64 secret after "whsec_". Rejects anything older than 5 minutes.
 */
export function verifySvixSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now()
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
