"use client";

import { useAuth } from "@/components/auth-provider";
import { isDemoMode } from "@/lib/demo/mode";
import { demoDb } from "@/lib/demo/store";
import { requireOrganizationId } from "@/lib/org";
import { createClient } from "@/lib/supabase/client";
import type { Payment } from "@/lib/udhaar";
import type { PaymentMode } from "@/lib/constants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function usePayments(customerId?: string) {
  return useQuery({
    queryKey: ["payments", customerId ?? "all"],
    queryFn: async (): Promise<Payment[]> => {
      if (isDemoMode()) {
        const all = demoDb.getPayments();
        return customerId ? all.filter((p) => p.customer_id === customerId) : all;
      }
      const supabase = createClient();
      let q = supabase
        .from("payments")
        .select("*, invoice:invoices(invoice_number, grand_total), customer:customers(name, phone)")
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (customerId) q = q.eq("customer_id", customerId);
      const { data, error } = await q;
      if (error) {
        if (/relation|does not exist|schema cache|payments/i.test(error.message)) {
          console.warn("[payments]", error.message);
          return [];
        }
        throw error;
      }
      return (data ?? []).map((row) => ({
        ...row,
        amount: Number(row.amount),
      })) as Payment[];
    },
  });
}

export function usePaymentMutations() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const record = useMutation({
    mutationFn: async (input: {
      customer_id: string;
      invoice_id?: string | null;
      amount: number;
      payment_date: string;
      payment_mode: PaymentMode;
      notes?: string | null;
    }) => {
      if (isDemoMode()) {
        return demoDb.recordPayment({
          ...input,
          user_id: user?.id ?? "demo",
        });
      }

      const orgId = requireOrganizationId(user);
      const supabase = createClient();
      const payload = {
        customer_id: input.customer_id,
        invoice_id: input.invoice_id || null,
        amount: input.amount,
        payment_date: input.payment_date,
        payment_mode: input.payment_mode,
        notes: input.notes ?? null,
        created_by: user?.id ?? null,
        organization_id: orgId,
      };

      const { data: rpcData, error: rpcError } = await supabase.rpc("record_payment", {
        payload,
      });

      // Payments are only recorded by the database function (migration 048)
      if (rpcError) throw rpcError;
      return rpcData as Payment;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      if (vars.invoice_id) {
        qc.invalidateQueries({ queryKey: ["invoices", vars.invoice_id] });
      }
      qc.invalidateQueries({ queryKey: ["customer-ledger"] });
      qc.invalidateQueries({ queryKey: ["outstanding"] });
    },
  });

  return { record };
}
