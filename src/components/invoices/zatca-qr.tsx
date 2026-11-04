"use client";

import { zatcaQrDataUrl, zatcaTimestamp } from "@/lib/vat/zatca";
import { useEffect, useState } from "react";

/** Saudi invoices: the ZATCA QR code customers and inspectors scan. */
export function ZatcaQr({
  sellerName,
  vatNumber,
  invoiceDate,
  createdAt,
  total,
  vatTotal,
  size = 112,
}: {
  sellerName: string;
  vatNumber: string;
  invoiceDate: string;
  createdAt?: string | null;
  total: number;
  vatTotal: number;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    zatcaQrDataUrl({
      sellerName,
      vatNumber,
      timestamp: zatcaTimestamp(invoiceDate, createdAt),
      total,
      vatTotal,
    })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [sellerName, vatNumber, invoiceDate, createdAt, total, vatTotal]);

  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="ZATCA QR code" width={size} height={size} className="rounded-[6px] bg-white p-1" />
  );
}
