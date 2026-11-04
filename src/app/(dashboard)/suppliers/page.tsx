"use client";

import { useAuth } from "@/components/auth-provider";
import { PlanUpgradeBanner } from "@/components/billing/plan-upgrade-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { partyCountryOptions, getCountryConfig, isValidTaxId } from "@/lib/vat/countries";
import { useCompanySettings } from "@/hooks/use-company";
import { useOrgAccess } from "@/hooks/use-org-access";
import { useSupplierMutations, useSuppliers } from "@/hooks/use-suppliers";
import type { Supplier } from "@/lib/types";
import { useToast } from "@/components/ui/toast";
import { Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";

const empty = {
  name: "",
  phone: "",
  email: "",
  tax_id: "",
  address: "",
  state: "",
  country: "",
  notes: "",
  is_active: true,
};

export default function SuppliersPage() {
  const { isAdmin } = useAuth();
  const { can, isLoading: accessLoading } = useOrgAccess();
  const { data: suppliers, isLoading } = useSuppliers();
  const { upsert, remove } = useSupplierMutations();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: company } = useCompanySettings();
  const orgCountry = getCountryConfig(company?.country);
  const formCountry = getCountryConfig(form.country || orgCountry.code);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (suppliers ?? []).filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.phone ?? "").includes(q) ||
        (s.tax_id ?? "").toLowerCase().includes(q)
    );
  }, [suppliers, search]);

  if (!accessLoading && !can("purchasesCreditNotes")) {
    return (
      <div>
        <PageHeader
          eyebrow="Purchases"
          title="Suppliers"
          description="Vendor directory for purchase bills"
        />
        <PlanUpgradeBanner
          requiredPlan="Pro"
          title="Suppliers are on Pro and Business"
          description="Manage supplier tax numbers for purchase bills. Upgrade to unlock purchases, suppliers, and credit notes."
        />
      </div>
    );
  }

  const openCreate = () => {
    setEditing(null);
    setForm({ ...empty, country: orgCountry.code });
    setOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name,
      phone: s.phone ?? "",
      email: s.email ?? "",
      tax_id: s.tax_id ?? "",
      address: s.address ?? "",
      state: s.state,
      country: s.country || orgCountry.code,
      notes: s.notes ?? "",
      is_active: s.is_active,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast("Name is required", "error");
      return;
    }
    if (!isValidTaxId(form.tax_id, formCountry.code)) {
      toast(`Enter a valid ${formCountry.taxIdLabel} (${formCountry.taxIdHint})`, "error");
      return;
    }
    try {
      await upsert.mutateAsync({
        id: editing?.id,
        name: form.name.trim(),
        phone: form.phone || null,
        email: form.email || null,
        tax_id: form.tax_id || null,
        address: form.address || null,
        state: form.state,
        country: formCountry.code,
        notes: form.notes || null,
        is_active: form.is_active,
      });
      toast(editing ? "Supplier updated" : "Supplier added");
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Purchasing"
        title="Suppliers"
        description="Vendor master for purchase bills & stock-in"
        accent="teal"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add supplier
          </Button>
        }
      />

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={`Search name, phone, ${orgCountry.taxIdLabel}…`}
        className="mb-4 sm:max-w-xs"
      />

      {isLoading ? (
        <LoadingBlock />
      ) : !filtered.length ? (
        <EmptyState
          title="No suppliers yet"
          description="Add the vendors you buy stock from, then record purchases against them."
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add your first supplier
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>{orgCountry.regionLabel}</th>
                <th>{orgCountry.taxIdLabel}</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="font-mono text-xs">{s.phone ?? "-"}</td>
                  <td>
                    {s.state}
                    {s.country && s.country !== orgCountry.code ? ` · ${getCountryConfig(s.country).name}` : ""}
                  </td>
                  <td className="font-mono text-xs">{s.tax_id ?? "-"}</td>
                  <td>
                    <Badge variant={s.is_active ? "success" : "default"}>
                      {s.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteId(s.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit supplier" : "Add supplier"}>
        <div className="space-y-3">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <Input
              label="Email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <Select
              label="Country"
              options={partyCountryOptions()}
              value={formCountry.code}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value, state: "" }))}
            />
            <Input
              label={formCountry.taxIdLabel}
              placeholder={formCountry.taxIdPlaceholder}
              value={form.tax_id}
              onChange={(e) => setForm((f) => ({ ...f, tax_id: e.target.value }))}
            />
            {formCountry.regions.length ? (
              <Select
                label={formCountry.regionLabel}
                placeholder={`Select ${formCountry.regionLabel.toLowerCase()}`}
                options={formCountry.regions.map((r) => ({ value: r, label: r }))}
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              />
            ) : (
              <Input
                label={formCountry.regionLabel}
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              />
            )}
          </div>
          <Input
            label="Address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
          <Input
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={upsert.isPending} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete this supplier?"
        message={`Are you sure you want to delete ${
          suppliers?.find((s) => s.id === deleteId)?.name ?? "this supplier"
        }? This cannot be undone.`}
        confirmLabel="Yes, delete"
        danger
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await remove.mutateAsync(deleteId);
            toast("Done - supplier removed.");
          } catch (e) {
            toast(
              (e as Error).message ||
                "We couldn't delete this supplier. They may be used on a purchase.",
              "error"
            );
          }
          setDeleteId(null);
        }}
      />
    </div>
  );
}
