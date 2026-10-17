"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-company";
import { LEGAL_SUPPORT_EMAIL } from "@/lib/brand";
import { downloadAllData } from "@/lib/data-export";
import { formatDate } from "@/lib/utils";
import { Database, Download } from "lucide-react";
import { useState } from "react";

/** Download everything, and ask for the account to be closed. Admins only. */
export function DataSection() {
  const { data: org } = useOrganization();
  const update = useUpdateOrganization();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  if (!org) return null;
  const businessName = org.brand_name || org.name;

  const exportAll = async () => {
    setBusy("Starting…");
    try {
      const r = await downloadAllData(businessName, (label) => setBusy(`Collecting ${label.toLowerCase()}…`));
      toast(`Downloaded ${r.rows.toLocaleString()} records in ${r.sheets} sheets`);
    } catch (e) {
      toast((e as Error).message || "Download failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const setRequested = (value: string | null) =>
    update.mutate(
      { id: org.id, deletion_requested_at: value },
      {
        onSuccess: () => {
          toast(value ? "Closure requested. We'll email you before anything is deleted." : "Closure request cancelled");
          setCloseOpen(false);
          setConfirmName("");
        },
        onError: (e) =>
          toast(
            /column|schema cache/i.test((e as Error).message)
              ? "This needs the latest database update (migration 041)."
              : (e as Error).message,
            "error"
          ),
      }
    );

  return (
    <section id="data" className="panel mt-6 max-w-2xl scroll-mt-24 space-y-5 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
          <Database className="h-4 w-4 text-primary" /> Your data
        </h2>
        <p className="mt-1 text-sm text-slate">
          Everything you keep in Kayyro belongs to you. Download a full copy any time, for your records or your accountant.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => void exportAll()} loading={!!busy}>
          <Download className="h-4 w-4" /> Download all data (Excel)
        </Button>
        {busy && <span className="text-xs text-slate">{busy}</span>}
      </div>

      <div className="rounded-[12px] border border-border p-4">
        <h3 className="text-sm font-semibold text-ink">Close your account</h3>
        {org.deletion_requested_at ? (
          <div className="mt-2 space-y-3 text-sm text-slate">
            <p>
              You asked us to close this account on <strong className="text-ink">{formatDate(org.deletion_requested_at)}</strong>.
              We&apos;ll email {org.email || "you"} before deleting anything.
            </p>
            <Button type="button" variant="outline" loading={update.isPending} onClick={() => setRequested(null)}>
              Keep my account
            </Button>
          </div>
        ) : (
          <div className="mt-2 space-y-3 text-sm text-slate">
            <p>
              UAE law asks businesses to keep tax records for at least 5 years, so download your data first. After you ask, we
              confirm by email and then permanently delete your business and all its records.
            </p>
            <Button type="button" variant="outline" onClick={() => setCloseOpen(true)}>
              Request account closure
            </Button>
          </div>
        )}
      </div>

      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title="Close your Kayyro account?">
        <div className="space-y-4 text-sm">
          <p className="text-slate">
            Type <strong className="text-ink">{businessName}</strong> to confirm. You can cancel the request until we&apos;ve
            deleted the account. Questions? Email{" "}
            <a className="font-medium text-primary underline" href={`mailto:${LEGAL_SUPPORT_EMAIL}`}>
              {LEGAL_SUPPORT_EMAIL}
            </a>
            .
          </p>
          <Input id="confirm_name" label="Business name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={update.isPending}
              disabled={confirmName.trim().toLowerCase() !== businessName.trim().toLowerCase()}
              onClick={() => setRequested(new Date().toISOString())}
            >
              Request closure
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
