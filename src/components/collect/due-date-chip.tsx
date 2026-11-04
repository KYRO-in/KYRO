"use client";

import { useToast } from "@/components/ui/toast";
import { addDaysIso, daysBetween } from "@/lib/collect/status";
import { isDemoMode } from "@/lib/demo/mode";
import { createClient } from "@/lib/supabase/client";
import type { Invoice } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useState } from "react";

/** Invoice page: the due date (Kayyro Collect plans reminders from it), editable while unpaid. */
export function DueDateChip({ invoice, editable }: { invoice: Invoice; editable: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const due = invoice.due_date ?? addDaysIso(invoice.invoice_date, 30);
  const open = invoice.status === "issued" || invoice.status === "partially_paid";
  const late = open ? daysBetween(due, new Date().toLocaleDateString("en-CA")) : 0;
  const canEdit = editable && open && !isDemoMode();

  const save = async (value: string) => {
    if (!value || value === invoice.due_date) return setEditing(false);
    setSaving(true);
    const { error } = await createClient().from("invoices").update({ due_date: value }).eq("id", invoice.id);
    setSaving(false);
    if (error) return toast(error.message, "error");
    setEditing(false);
    toast("Due date updated");
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        disabled={saving}
        defaultValue={due}
        min={invoice.invoice_date}
        aria-label="Due date"
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save((e.target as HTMLInputElement).value);
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-8 rounded-full border border-primary/40 bg-surface px-3 text-xs text-ink"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => setEditing(true)}
      title={canEdit ? "Change the due date" : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        late > 0 ? "bg-rose/10 text-rose" : "bg-cloud text-slate",
        canEdit && "hover:ring-1 hover:ring-primary/30"
      )}
    >
      <CalendarClock className="h-3 w-3" /> Due {formatDate(due)}
      {late > 0 ? ` · ${late} day${late === 1 ? "" : "s"} late` : ""}
    </button>
  );
}
