/**
 * Kayyro Collect WhatsApp connector.
 *
 * - One-tap (today): the owner sends the message from their own WhatsApp
 *   (a wa.me link). Kayyro never sends WhatsApp messages by itself here.
 * - 360dialog (when the business's WhatsApp Business number is connected
 *   through Meta): pre-approved templates are sent through the 360dialog
 *   Cloud API. Only used for customers who opted in to WhatsApp. Answers to a
 *   customer's message go out as plain text inside WhatsApp's 24-hour reply window.
 */
import { whatsappUrl } from "@/lib/whatsapp";

export type WhatsAppTemplateMessage = {
  to: string;
  template: string;
  language: "en" | "ar";
  params: string[];
};

export interface WhatsAppSender {
  readonly provider: "360dialog";
  sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ id: string | null }>;
  /** Plain text, only inside the 24 hours after the customer last wrote */
  sendText(to: string, text: string): Promise<{ id: string | null }>;
}

/** The owner's own WhatsApp: a link that opens the chat with the text filled in. */
export function oneTapLink(phone: string | null | undefined, text: string): string | null {
  return whatsappUrl(phone, text);
}

/** International number with digits only, as the WhatsApp API expects (e.g. 971501234567). */
export function apiPhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^00/, "");
}

export class Dialog360Sender implements WhatsAppSender {
  readonly provider = "360dialog" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.D360_BASE_URL || "https://waba-v2.360dialog.io",
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ id: string | null }> {
    return this.post({
      to: apiPhone(msg.to),
      type: "template",
      template: {
        name: msg.template,
        language: { code: msg.language },
        components: [{ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) }],
      },
    });
  }

  sendText(to: string, text: string): Promise<{ id: string | null }> {
    return this.post({ to: apiPhone(to), type: "text", text: { preview_url: false, body: text } });
  }

  private async post(message: Record<string, unknown>): Promise<{ id: string | null }> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "D360-API-KEY": this.apiKey },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...message }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message || `WhatsApp provider returned ${res.status}`);
    return { id: body.messages?.[0]?.id ?? null };
  }
}
