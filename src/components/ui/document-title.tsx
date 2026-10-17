"use client";

import { APP_NAME } from "@/lib/brand";
import { useEffect } from "react";

/** Sets the browser tab title for client pages ("Invoices · Kayyro"). */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return null;
}
