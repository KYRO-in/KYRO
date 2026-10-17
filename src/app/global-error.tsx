"use client";

import { reportError } from "@/lib/error-report";
import { useEffect } from "react";

/** Last-resort screen when the root layout itself fails. Plain styles: CSS may not have loaded. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, "global-error");
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0b1023" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 20 }}>Kayyro couldn&apos;t load</h1>
            <p style={{ color: "#64748b", fontSize: 14 }}>Please try again in a moment. Your data is safe.</p>
            {error.digest && <p style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>Code: {error.digest}</p>}
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: 12, background: "#7c1cf0", color: "#fff", border: 0, borderRadius: 10, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
