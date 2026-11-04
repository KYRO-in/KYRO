"use client";

import { useAuth } from "@/components/auth-provider";
import { collectDemo } from "@/lib/collect/demo";
import { normaliseRisk, type CustomerRisk } from "@/lib/collect/insights";
import { renderEmail, renderWhatsApp, type CollectStepKey } from "@/lib/collect/templates";
import { oneTapLink } from "@/lib/collect/whatsapp";
import { addDaysIso, balanceDue, daysBetween } from "@/lib/collect/status";
import { isDemoMode } from "@/lib/demo/mode";
import { demoDb } from "@/lib/demo/store";
import { createClient } from "@/lib/supabase/client";
import type {
  CollectionMessage,
  CollectSettings,
  CollectTask,
  Dispute,
  PaymentClaim,
  PaymentPromise,
  ReplyIntentName,
  ReminderStep,
} from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Before migration 049 the Collect tables do not exist yet */
const MISSING = /collect_|collection_messages|reminder_steps|payment_promises|disputes|schema cache|does not exist/i;
const NEEDS_MIGRATION = "Kayyro Collect needs the latest database update (migration 049).";

function friendly(error: { message: string }): Error {
  return new Error(MISSING.test(error.message) && /does not exist|schema cache/i.test(error.message) ? NEEDS_MIGRATION : error.message);
}

export type CollectMessageRow = CollectionMessage & {
  invoice?: { id: string; invoice_number: string; grand_total: number; currency: string | null; due_date: string | null } | null;
  customer?: { id: string; name: string; phone: string | null; email: string | null; whatsapp_opt_in_at?: string | null } | null;
};

export function useCollectSettings() {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: ["collect", "settings"],
    enabled: !loading && !!user,
    queryFn: async (): Promise<{ settings: CollectSettings; steps: ReminderStep[]; whatsappConnected: boolean } | null> => {
      if (isDemoMode()) return { settings: collectDemo.settings(), steps: collectDemo.steps(), whatsappConnected: false };
      const supabase = createClient();
      const { data: settings, error } = await supabase.rpc("collect_ensure_settings");
      if (error) {
        if (MISSING.test(error.message)) return null;
        throw error;
      }
      const [{ data: steps, error: stepsError }, { data: connected }] = await Promise.all([
        supabase.from("reminder_steps").select("*").order("offset_days"),
        supabase.rpc("collect_whatsapp_connected"),
      ]);
      if (stepsError) throw stepsError;
      return {
        settings: settings as CollectSettings,
        steps: (steps ?? []) as ReminderStep[],
        whatsappConnected: connected === true,
      };
    },
  });
}

export function useCollectMessages(filter: { invoiceId?: string; customerId?: string } = {}) {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: ["collect", "messages", filter.invoiceId ?? null, filter.customerId ?? null],
    enabled: !loading && !!user,
    queryFn: async (): Promise<CollectMessageRow[]> => {
      if (isDemoMode()) {
        const invoices = demoDb.getInvoices();
        return collectDemo
          .messages()
          .filter((m) => (!filter.invoiceId || m.invoice_id === filter.invoiceId) && (!filter.customerId || m.customer_id === filter.customerId))
          .map((m) => {
            const inv = invoices.find((i) => i.id === m.invoice_id);
            return {
              ...m,
              invoice: inv
                ? { id: inv.id, invoice_number: inv.invoice_number, grand_total: inv.grand_total, currency: inv.currency ?? null, due_date: inv.due_date ?? null }
                : null,
              customer: inv?.customer
                ? { id: inv.customer.id, name: inv.customer.name, phone: inv.customer.phone ?? null, email: inv.customer.email ?? null, whatsapp_opt_in_at: inv.customer.whatsapp_opt_in_at ?? null }
                : null,
            };
          });
      }
      let query = createClient()
        .from("collection_messages")
        .select(
          "*, invoice:invoices(id, invoice_number, grand_total, currency, due_date), customer:customers(id, name, phone, email, whatsapp_opt_in_at)"
        )
        .order("created_at", { ascending: false })
        .limit(300);
      if (filter.invoiceId) query = query.eq("invoice_id", filter.invoiceId);
      if (filter.customerId) query = query.eq("customer_id", filter.customerId);
      const { data, error } = await query;
      if (error) {
        if (MISSING.test(error.message)) return [];
        throw error;
      }
      return (data ?? []) as CollectMessageRow[];
    },
  });
}

/** Open call tasks, promises and disputes (what the Get Paid page needs to decide each invoice's status). */
export function useCollectOpenItems() {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: ["collect", "open"],
    enabled: !loading && !!user,
    queryFn: async (): Promise<{ tasks: CollectTask[]; promises: PaymentPromise[]; disputes: Dispute[]; claims: PaymentClaim[] }> => {
      if (isDemoMode()) {
        return { tasks: collectDemo.tasks(), promises: collectDemo.promises(), disputes: collectDemo.disputes(), claims: collectDemo.claims() };
      }
      const supabase = createClient();
      const [t, p, d, c] = await Promise.all([
        supabase.from("collect_tasks").select("*").eq("status", "open").order("due_date"),
        supabase.from("payment_promises").select("*").eq("status", "open"),
        supabase.from("disputes").select("*").eq("status", "open"),
        supabase.from("payment_claims").select("*").eq("status", "pending"),
      ]);
      for (const r of [t, p, d]) {
        if (r.error) {
          if (MISSING.test(r.error.message)) return { tasks: [], promises: [], disputes: [], claims: [] };
          throw r.error;
        }
      }
      return {
        tasks: (t.data ?? []) as CollectTask[],
        promises: (p.data ?? []) as PaymentPromise[],
        disputes: (d.data ?? []) as Dispute[],
        // Before migration 050 there are no claims yet
        claims: c.error ? [] : ((c.data ?? []) as PaymentClaim[]),
      };
    },
  });
}

export type ReminderDraft = {
  id: string;
  channel: "email" | "whatsapp";
  to: string | null;
  subject: string | null;
  body: string;
  link: string | null;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}

function rpcError(error: { message: string } | null) {
  if (error) throw friendly(error);
}

export function useCollectMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["collect"] });

  const saveSettings = useMutation({
    mutationFn: async (patch: Partial<CollectSettings>) => {
      if (isDemoMode()) return collectDemo.saveSettings(patch);
      const { organization_id, updated_at, enabled_at, ...rest } = patch;
      void updated_at;
      void enabled_at;
      if (!organization_id) throw new Error("Missing business");
      const { data, error } = await createClient()
        .from("collect_settings")
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq("organization_id", organization_id)
        .select()
        .single();
      if (error) throw friendly(error);
      return data as CollectSettings;
    },
    onSuccess: invalidate,
  });

  /** Replace the schedule with the edited list (admins only, enforced by the database). */
  const saveSteps = useMutation({
    mutationFn: async (input: { organizationId: string; current: ReminderStep[]; next: Pick<ReminderStep, "offset_days" | "action" | "step_key" | "active">[] }) => {
      if (isDemoMode()) return collectDemo.saveSteps(input.next);
      const supabase = createClient();
      const key = (s: { offset_days: number; action: string }) => `${s.offset_days}:${s.action}`;
      const keep = new Set(input.next.map(key));
      const removed = input.current.filter((s) => !keep.has(key(s)));
      if (removed.length) {
        const { error } = await supabase.from("reminder_steps").delete().in("id", removed.map((s) => s.id));
        if (error) throw friendly(error);
      }
      for (const s of input.next) {
        const existing = input.current.find((c) => key(c) === key(s));
        const { error } = existing
          ? await supabase.from("reminder_steps").update({ step_key: s.step_key, active: s.active }).eq("id", existing.id)
          : await supabase.from("reminder_steps").insert({ ...s, organization_id: input.organizationId });
        if (error) throw friendly(error);
      }
    },
    onSuccess: invalidate,
  });

  /** Approve a queued message (optionally edited). Email goes out now, or at the next sending window. */
  const approve = useMutation({
    mutationFn: async (input: { id: string; subject?: string; body?: string }) => {
      if (isDemoMode()) return { status: collectDemo.setStatus(input.id, "sent", { subject: input.subject ?? undefined, body: input.body ?? undefined }) };
      return postJson<{ status: string }>("/api/collect/send-now", input);
    },
    onSuccess: invalidate,
  });

  /** The owner tapped Send in their own WhatsApp: log it. */
  const markSentByHand = useMutation({
    mutationFn: async (id: string) => {
      if (isDemoMode()) return collectDemo.setStatus(id, "sent", { provider: "one_tap" });
      const { data, error } = await createClient().rpc("collect_mark_sent_by_hand", { p_id: id });
      rpcError(error);
      return data as string;
    },
    onSuccess: invalidate,
  });

  const skip = useMutation({
    mutationFn: async (id: string) => {
      if (isDemoMode()) return collectDemo.setStatus(id, "skipped");
      const { error } = await createClient().rpc("collect_skip", { p_id: id });
      rpcError(error);
    },
    onSuccess: invalidate,
  });

  const retry = useMutation({
    mutationFn: async (id: string) => {
      if (isDemoMode()) return collectDemo.setStatus(id, "ready");
      const { error } = await createClient().rpc("collect_retry", { p_id: id });
      rpcError(error);
    },
    onSuccess: invalidate,
  });

  /** "Remind now": a drafted reminder for one invoice, worded by the server from the fixed templates. */
  const remind = useMutation({
    mutationFn: async (input: { invoiceId: string; channel: "email" | "whatsapp" }): Promise<ReminderDraft> => {
      if (isDemoMode()) return demoRemind(input.invoiceId, input.channel);
      return postJson<ReminderDraft>("/api/collect/remind", input);
    },
    onSuccess: invalidate,
  });

  const addPromise = useMutation({
    mutationFn: async (input: { invoiceId: string; customerId: string | null; date: string }) => {
      if (isDemoMode()) return collectDemo.addPromise(input.invoiceId, input.customerId, input.date);
      const { error } = await createClient().rpc("collect_add_promise", { p_invoice: input.invoiceId, p_date: input.date });
      rpcError(error);
    },
    onSuccess: invalidate,
  });

  const openDispute = useMutation({
    mutationFn: async (input: { invoiceId: string; customerId: string | null; reason: string }) => {
      if (isDemoMode()) return collectDemo.openDispute(input.invoiceId, input.customerId, input.reason);
      const { error } = await createClient().rpc("collect_open_dispute", { p_invoice: input.invoiceId, p_reason: input.reason });
      rpcError(error);
    },
    onSuccess: invalidate,
  });

  const resolveDispute = useMutation({
    mutationFn: async (id: string) => {
      if (isDemoMode()) return collectDemo.resolveDispute(id);
      const { error } = await createClient().rpc("collect_resolve_dispute", { p_dispute: id });
      rpcError(error);
    },
    onSuccess: invalidate,
  });

  const resolveTask = useMutation({
    mutationFn: async (input: { id: string; status: "done" | "dismissed" }) => {
      if (isDemoMode()) return collectDemo.resolveTask(input.id, input.status);
      const { error } = await createClient().rpc("collect_resolve_task", { p_task: input.id, p_status: input.status });
      rpcError(error);
    },
    onSuccess: invalidate,
  });

  /** Confirm (records the payment) or reject a customer's "I already paid". */
  const resolveClaim = useMutation({
    mutationFn: async (input: { id: string; status: "confirmed" | "rejected" }) => {
      if (isDemoMode()) return collectDemo.resolveClaim(input.id, input.status);
      const { data, error } = await createClient().rpc("collect_resolve_claim", { p_claim: input.id, p_status: input.status });
      rpcError(error);
      return data as string;
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
    },
  });

  /** "Log a reply" the customer sent to the owner's own phone or inbox; Kayyro reads it. */
  const logReply = useMutation({
    mutationFn: async (input: { invoiceId: string; channel: "email" | "whatsapp"; text: string }): Promise<ReplyReading> => {
      if (isDemoMode()) return collectDemo.logReply(input.invoiceId, input.channel, input.text);
      return postJson<ReplyReading>("/api/collect/reply", input);
    },
    onSuccess: invalidate,
  });

  return {
    saveSettings,
    saveSteps,
    approve,
    markSentByHand,
    skip,
    retry,
    remind,
    addPromise,
    openDispute,
    resolveDispute,
    resolveTask,
    resolveClaim,
    logReply,
  };
}

export type ReplyReading = {
  action: string;
  intent: ReplyIntentName;
  confidence: number;
  summary: string;
  promiseDate: string | null;
  answer: { id: string; channel: "email" | "whatsapp"; status: string; to: string | null; subject: string | null; body: string | null; link: string | null } | null;
};

/** A short-lived private link to a customer's proof of payment. */
export async function proofUrl(path: string): Promise<string | null> {
  if (isDemoMode()) return null;
  const { data } = await createClient().storage.from("collect-proofs").createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/** Demo mode: the same templates, filled in from the sample invoice. */
function demoRemind(invoiceId: string, channel: "email" | "whatsapp"): ReminderDraft {
  const inv = demoDb.getInvoices().find((i) => i.id === invoiceId);
  if (!inv) throw new Error("Invoice not found");
  const company = demoDb.getCompany();
  const today = new Date().toISOString().slice(0, 10);
  const due = inv.due_date ?? addDaysIso(inv.invoice_date, 30);
  const late = daysBetween(due, today);
  const step: CollectStepKey = late < 0 ? "before_due" : late === 0 ? "due_today" : late < 7 ? "polite" : late < 30 ? "firm" : "final";
  const vars = {
    customer: inv.customer?.name ?? "Customer",
    business: company.brand_name || company.company_name || "Demo Trading LLC",
    invoiceNumber: inv.invoice_number,
    amount: balanceDue({ ...inv, amount_paid: Number(inv.amount_paid ?? 0), due_date: inv.due_date ?? null }),
    currency: inv.currency || "AED",
    dueDate: due,
    invoiceUrl: "https://example.com/i/demo",
    payUrl: null,
    optOutUrl: "https://example.com/u/demo",
  };
  const base = {
    invoice_id: inv.id,
    customer_id: inv.customer_id,
    step_id: null,
    step_key: step,
    direction: "out" as const,
    local_date: today,
    sent_on: null,
    auto_send: false,
    manual: true,
    language: "en" as const,
    provider: null,
    error: null,
    sent_at: null,
  };
  if (channel === "email") {
    const e = renderEmail(step, "en", 30, vars);
    const to = inv.customer?.email || "accounts@example.com";
    const row = collectDemo.addMessage({ ...base, channel, status: "awaiting_approval", subject: e.subject, body: e.text, to_address: to, wa_template: null, wa_variables: null });
    return { id: row.id, channel, to, subject: e.subject, body: e.text, link: null };
  }
  const w = renderWhatsApp(step, "en", vars);
  const to = inv.customer?.phone || "+971500000000";
  const row = collectDemo.addMessage({ ...base, channel, status: "awaiting_approval", subject: null, body: w.text, to_address: to, wa_template: w.template, wa_variables: w.params });
  return { id: row.id, channel, to, subject: null, body: w.text, link: oneTapLink(to, w.text) };
}

/** Late-payer risk per customer (Business plan; migration 051). */
export function useCustomerRisk(enabled: boolean) {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: ["collect", "risk"],
    enabled: enabled && !loading && !!user,
    queryFn: async (): Promise<Map<string, CustomerRisk>> => {
      if (isDemoMode()) return new Map(collectDemo.risk().map((r) => [r.customer_id, r]));
      const { data, error } = await createClient().rpc("collect_customer_risk");
      if (error) {
        if (MISSING.test(error.message)) return new Map();
        throw error;
      }
      return new Map(((data ?? []) as Record<string, unknown>[]).map((r) => [String(r.customer_id), normaliseRisk(r)]));
    },
  });
}
