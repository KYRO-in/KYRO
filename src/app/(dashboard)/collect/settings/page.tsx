"use client";

import { useAuth } from "@/components/auth-provider";
import { CollectShell, CollectTabs, LockedPreview, useCollectLang } from "@/components/collect/collect-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingBlock, PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useCollectSettings, useCollectMutations } from "@/hooks/use-collect";
import { useOrgAccess } from "@/hooks/use-org-access";
import { isDemoMode } from "@/lib/demo/mode";
import { stepLabel } from "@/lib/collect/i18n";
import type { CollectSettings, ReminderStep } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Phone, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// Gulf first; the rest cover businesses set up before Kayyro became GCC-only
const TIME_ZONES = [
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Bahrain",
  "Asia/Qatar",
  "Asia/Kuwait",
  "Asia/Muscat",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
];

type StepDraft = Pick<ReminderStep, "offset_days" | "action" | "step_key" | "active">;
const STEP_KEYS = ["before_due", "due_today", "polite", "firm", "final"] as const;

export default function CollectSettingsPage() {
  return (
    <CollectShell>
      <SettingsScreen />
    </CollectShell>
  );
}

function hhmm(v: string | null | undefined) {
  return (v ?? "").slice(0, 5);
}

function SettingsScreen() {
  const { t } = useCollectLang();
  const { isAdmin } = useAuth();
  const { can } = useOrgAccess();
  const { toast } = useToast();
  const { data, isLoading } = useCollectSettings();
  const { saveSettings, saveSteps } = useCollectMutations();
  const [form, setForm] = useState<CollectSettings | null>(null);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
    if (data?.steps) setSteps(data.steps.map(({ offset_days, action, step_key, active }) => ({ offset_days, action, step_key, active })));
  }, [data]);

  const auto = can("collectAuto");
  const insights = can("collectInsights");
  const locked = !auto || !isAdmin;
  const sorted = useMemo(() => [...steps].sort((a, b) => a.offset_days - b.offset_days), [steps]);

  if (isLoading) return <LoadingBlock />;
  if (!data || !form) {
    return (
      <div>
        <PageHeader eyebrow={t.eyebrow} title={t.settingsTitle} accent="sage" />
        <p className="text-sm text-slate">Kayyro Collect needs the latest database update (migration 049).</p>
      </div>
    );
  }

  const set = <K extends keyof CollectSettings>(k: K, v: CollectSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const days = form.working_days ?? null;
  const toggleDay = (d: number) => {
    const cur = days ?? [1, 2, 3, 4, 5];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    if (next.length) set("working_days", next);
  };

  const save = async () => {
    try {
      const dupes = new Set(sorted.map((s) => `${s.offset_days}:${s.action}`)).size !== sorted.length;
      if (dupes) throw new Error("Two steps can't be on the same day.");
      await saveSettings.mutateAsync({
        organization_id: form.organization_id,
        enabled: form.enabled,
        channel_email: form.channel_email,
        channel_whatsapp: form.channel_whatsapp,
        tone: form.tone,
        language: form.language,
        send_start: hhmm(form.send_start),
        send_end: hhmm(form.send_end),
        working_days: form.working_days,
        time_zone: form.time_zone || null,
        ramadan_enabled: form.ramadan_enabled,
        ramadan_start: form.ramadan_start || null,
        ramadan_end: form.ramadan_end || null,
        ramadan_send_start: hhmm(form.ramadan_send_start),
        ramadan_send_end: hhmm(form.ramadan_send_end),
        approval_mode: form.approval_mode,
        default_terms_days: form.default_terms_days,
        include_existing: form.include_existing,
        // Only once migration 050 added the column
        ...(form.ai_replies !== undefined ? { ai_replies: form.ai_replies } : {}),
        // Only once migration 051 added the daily summary
        ...(form.summary_enabled !== undefined
          ? {
              summary_enabled: form.summary_enabled,
              summary_channel: form.summary_channel,
              summary_to: form.summary_to?.trim() || null,
              summary_time: hhmm(form.summary_time),
            }
          : {}),
      });
      await saveSteps.mutateAsync({ organizationId: form.organization_id, current: data.steps, next: sorted });
      toast(t.saved);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    }
  };

  const testSummary = async () => {
    if (!(await save())) return;
    if (isDemoMode()) return toast("Demo mode: no message is sent.");
    setTesting(true);
    try {
      const res = await fetch("/api/collect/summary/test", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; to?: string };
      if (!res.ok) throw new Error(json.error || "Could not send the summary.");
      toast(`${t.summaryTestSent} ${json.to ?? ""}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setTesting(false);
    }
  };

  // Timeline: -30 .. +60 days around the due date
  const min = Math.min(-7, ...sorted.map((s) => s.offset_days));
  const max = Math.max(35, ...sorted.map((s) => s.offset_days));
  const pos = (d: number) => `${((d - min) / (max - min)) * 100}%`;

  return (
    <div>
      <PageHeader eyebrow={t.eyebrow} title={t.settingsTitle} description={t.settingsSubtitle} accent="sage" />
      <CollectTabs />
      {!auto && <LockedPreview />}

      <fieldset disabled={locked} className="space-y-5 disabled:opacity-70">
        <section className="panel space-y-4 p-5">
          <Toggle label={t.enabled} checked={form.enabled} onChange={(v) => set("enabled", v)} />
          <div>
            <p className="field-label mb-2">{t.channels}</p>
            <div className="flex flex-wrap gap-4">
              <Check label={t.email} checked={form.channel_email} onChange={(v) => set("channel_email", v)} />
              <Check label={t.whatsapp} checked={form.channel_whatsapp} onChange={(v) => set("channel_whatsapp", v)} />
            </div>
            <p className="mt-2 text-xs text-slate">
              {t.whatsappConnect}: {data.whatsappConnected ? "✓" : t.notConnected}. {data.whatsappConnected ? "" : t.whatsappConnectHint}
            </p>
          </div>
          <div>
            <p className="field-label mb-2">{t.tone}</p>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate">{t.friendly}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={form.tone}
                onChange={(e) => set("tone", Number(e.target.value))}
                className="h-2 flex-1 accent-[var(--color-primary,#7c1cf0)]"
                aria-label={t.tone}
              />
              <span className="text-xs text-slate">{t.firm}</span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t.msgLanguage}
              value={form.language}
              onChange={(e) => set("language", e.target.value as CollectSettings["language"])}
              options={[
                { value: "auto", label: t.langAuto },
                { value: "en", label: "English" },
                { value: "ar", label: "العربية" },
              ]}
            />
            <Input
              label={t.terms}
              type="number"
              min={0}
              max={365}
              value={form.default_terms_days}
              onChange={(e) => set("default_terms_days", Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
            />
          </div>
        </section>

        <section className="panel space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label={`${t.hours} · ${t.from}`} type="time" value={hhmm(form.send_start)} onChange={(e) => set("send_start", e.target.value)} />
            <Input label={t.until} type="time" value={hhmm(form.send_end)} onChange={(e) => set("send_end", e.target.value)} />
            <Select
              label={t.timeZone}
              value={form.time_zone ?? ""}
              onChange={(e) => set("time_zone", e.target.value || null)}
              options={[{ value: "", label: t.countryDefault }, ...TIME_ZONES.map((z) => ({ value: z, label: z }))]}
            />
          </div>
          <div>
            <p className="field-label mb-2">{t.workingDays}</p>
            <Check label={t.countryDefault} checked={days === null} onChange={(v) => set("working_days", v ? null : [1, 2, 3, 4, 5])} />
            {days !== null && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.weekday.map((name, i) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleDay(i + 1)}
                    className={cn(
                      "min-h-[40px] rounded-[9px] border px-3 text-sm",
                      days.includes(i + 1) ? "border-primary bg-primary/10 text-primary" : "border-border text-slate"
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-[10px] border border-border bg-cloud/50 p-4">
            <Toggle label={t.ramadan} hint={t.ramadanHint} checked={form.ramadan_enabled} onChange={(v) => set("ramadan_enabled", v)} />
            {form.ramadan_enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <Input label={t.ramadanStart} type="date" value={form.ramadan_start ?? ""} onChange={(e) => set("ramadan_start", e.target.value || null)} />
                <Input label={t.ramadanEnd} type="date" value={form.ramadan_end ?? ""} onChange={(e) => set("ramadan_end", e.target.value || null)} />
                <Input label={t.from} type="time" value={hhmm(form.ramadan_send_start)} onChange={(e) => set("ramadan_send_start", e.target.value)} />
                <Input label={t.until} type="time" value={hhmm(form.ramadan_send_end)} onChange={(e) => set("ramadan_send_end", e.target.value)} />
              </div>
            )}
          </div>
        </section>

        <section className="panel space-y-3 p-5">
          <p className="field-label">{t.approval}</p>
          <Radio name="approval" label={t.approvalApprove} checked={form.approval_mode === "approve"} onChange={() => set("approval_mode", "approve")} />
          <Radio name="approval" label={t.approvalAuto} checked={form.approval_mode === "auto"} onChange={() => set("approval_mode", "auto")} />
          <p className="text-xs text-slate">{t.approvalAutoHint}</p>
          <Check label={t.includeExisting} checked={form.include_existing} onChange={(v) => set("include_existing", v)} />
        </section>

        {form.ai_replies !== undefined && (
          <section className="panel space-y-3 p-5">
            <Toggle label={t.aiReplies} hint={t.aiRepliesHint} checked={form.ai_replies} onChange={(v) => set("ai_replies", v)} />
            <div className="rounded-[10px] border border-border bg-cloud/50 p-3">
              <p className="text-xs font-semibold text-ink">{t.receiving}</p>
              <p className="mt-0.5 text-xs text-slate">{t.receivingHint}</p>
            </div>
          </section>
        )}

        {form.summary_enabled !== undefined && (
          <section className="panel space-y-3 p-5">
            <fieldset disabled={!insights} className="space-y-3 disabled:opacity-70">
              <Toggle label={t.summaryOn} hint={t.summaryHint} checked={form.summary_enabled} onChange={(v) => set("summary_enabled", v)} />
              {form.summary_enabled && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select
                    label={t.summaryChannel}
                    value={form.summary_channel ?? "email"}
                    onChange={(e) => set("summary_channel", e.target.value as "email" | "whatsapp")}
                    options={[
                      { value: "email", label: t.email },
                      { value: "whatsapp", label: t.whatsapp },
                    ]}
                  />
                  <Input
                    label={t.summaryTo}
                    value={form.summary_to ?? ""}
                    maxLength={200}
                    dir="ltr"
                    onChange={(e) => set("summary_to", e.target.value)}
                    placeholder={form.summary_channel === "whatsapp" ? "+971 …" : "owner@…"}
                  />
                  <Input label={t.summaryTime} type="time" value={hhmm(form.summary_time)} onChange={(e) => set("summary_time", e.target.value)} />
                  <p className="text-xs text-slate sm:col-span-3">
                    {t.summaryToHint} {form.summary_channel === "whatsapp" && !data.whatsappConnected ? t.summaryWaNote : ""}
                  </p>
                  <div className="sm:col-span-3">
                    <Button size="sm" variant="secondary" type="button" onClick={testSummary} loading={testing}>
                      {t.summaryTest}
                    </Button>
                  </div>
                </div>
              )}
            </fieldset>
            {!insights && <p className="text-xs text-slate">{t.insightsLocked}</p>}
          </section>
        )}

        <section className="panel p-5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <p className="font-display text-sm font-semibold text-ink">{t.schedule}</p>
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={steps.length >= 10}
              onClick={() => setSteps((s) => [...s, { offset_days: Math.max(...s.map((x) => x.offset_days), 0) + 7, action: "message", step_key: "firm", active: true }])}
            >
              <Plus className="h-3.5 w-3.5" /> {t.addStep}
            </Button>
          </div>
          <p className="mb-5 text-xs text-slate">{t.scheduleHint}</p>

          {/* The timeline (always left-to-right: days run forward) */}
          <div dir="ltr" className="relative mx-3 mb-8 mt-10 h-1.5 rounded-full bg-cloud">
            <span className="absolute -top-1 h-3.5 w-0.5 bg-ink" style={{ left: pos(0) }} />
            <span className="absolute top-4 -translate-x-1/2 text-[10px] font-semibold text-ink" style={{ left: pos(0) }}>
              {t.due}
            </span>
            {sorted.map((s) => (
              <span
                key={`${s.offset_days}:${s.action}`}
                className={cn(
                  "absolute -top-[7px] flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-surface text-[9px] font-bold text-white shadow",
                  !s.active ? "bg-slate/40" : s.action === "call_task" ? "bg-tangerine" : s.offset_days < 0 ? "bg-aqua-deep" : "bg-primary"
                )}
                style={{ left: pos(s.offset_days) }}
                title={`${s.offset_days > 0 ? "+" : ""}${s.offset_days}`}
              >
                {s.action === "call_task" ? <Phone className="h-2.5 w-2.5" /> : null}
              </span>
            ))}
            {sorted.map((s) => (
              <span
                key={`l${s.offset_days}:${s.action}`}
                className="absolute -top-7 -translate-x-1/2 font-mono text-[10px] text-slate"
                style={{ left: pos(s.offset_days) }}
              >
                {s.offset_days > 0 ? "+" : ""}
                {s.offset_days}
              </span>
            ))}
          </div>

          <ul className="space-y-2">
            {sorted.map((s) => {
              const idx = steps.indexOf(s);
              const update = (patch: Partial<StepDraft>) => setSteps((all) => all.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
              return (
                <li key={idx} className="flex flex-wrap items-end gap-2 rounded-[10px] border border-border bg-cloud/40 p-2.5">
                  <div className="w-24">
                    <Input
                      type="number"
                      min={-30}
                      max={120}
                      value={s.offset_days}
                      aria-label="Days"
                      onChange={(e) => update({ offset_days: Math.max(-30, Math.min(120, Math.round(Number(e.target.value) || 0))) })}
                    />
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <Select
                      value={s.action === "call_task" ? "call" : s.step_key}
                      aria-label={t.message}
                      onChange={(e) =>
                        update(
                          e.target.value === "call"
                            ? { action: "call_task", step_key: "call" }
                            : { action: "message", step_key: e.target.value as StepDraft["step_key"] }
                        )
                      }
                      options={[
                        ...STEP_KEYS.map((k) => ({ value: k, label: `${t.message}: ${stepLabel(t, k)}` })),
                        { value: "call", label: t.callTask },
                      ]}
                    />
                  </div>
                  <Check label={t.stepOn} checked={s.active} onChange={(v) => update({ active: v })} />
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    aria-label="Remove"
                    disabled={steps.length <= 1}
                    onClick={() => setSteps((all) => all.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex justify-end">
          <Button type="button" onClick={save} loading={saveSettings.isPending || saveSteps.isPending}>
            {t.save}
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-slate">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-4 peer-focus-visible:ring-primary/20",
          checked ? "bg-primary" : "bg-border"
        )}
      >
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "start-[22px]" : "start-0.5")} />
      </span>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-ink">
      <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary,#7c1cf0)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Radio({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm text-ink">
      <input type="radio" name={name} className="h-4 w-4 accent-[var(--color-primary,#7c1cf0)]" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
