/**
 * Server-only email sending. Provider: Resend (https://resend.com) over its REST API,
 * so no extra dependency. Configure in the environment:
 *   RESEND_API_KEY = re_...
 *   EMAIL_FROM     = "Kayyro <invoices@your-domain.com>"   (a domain verified in Resend)
 */

export type EmailAttachment = { filename: string; content: Buffer };

export type OutgoingEmail = {
  /** Display name shown to the customer, e.g. the shop's name */
  fromName: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Extra headers, e.g. List-Unsubscribe on payment reminders */
  headers?: Record<string, string>;
};

export type EmailStatus = {
  configured: boolean;
  provider: "resend" | null;
  /** Sending address (no display name) */
  fromAddress: string | null;
};

function fromAddress(): string | null {
  const raw = process.env.EMAIL_FROM?.trim();
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  return (angle ? angle[1] : raw).trim() || null;
}

export function getEmailStatus(): EmailStatus {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = fromAddress();
  if (key && from) return { configured: true, provider: "resend", fromAddress: from };
  return { configured: false, provider: null, fromAddress: from };
}

/** Quotes a display name safely for the From header. */
function displayName(name: string): string {
  return `"${name.replace(/["\\\r\n]/g, "").slice(0, 70)}"`;
}

export async function sendEmail(email: OutgoingEmail): Promise<{ id: string | null }> {
  const status = getEmailStatus();
  if (!status.configured || !status.fromAddress) {
    throw new Error("Email sending is not configured (RESEND_API_KEY / EMAIL_FROM).");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${displayName(email.fromName)} <${status.fromAddress}>`,
      to: email.to,
      cc: email.cc?.length ? email.cc : undefined,
      bcc: email.bcc?.length ? email.bcc : undefined,
      reply_to: email.replyTo || undefined,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: email.headers && Object.keys(email.headers).length ? email.headers : undefined,
      attachments: email.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      })),
    }),
  });

  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok) {
    throw new Error(body.message || `Email provider error (${res.status})`);
  }
  return { id: body.id ?? null };
}
