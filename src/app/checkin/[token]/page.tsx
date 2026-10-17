"use client";

import { PunchPad, type PunchResult } from "@/components/attendance/punch-pad";
import { browserTimeZone } from "@/lib/attendance";
import { APP_NAME } from "@/lib/brand";
import { isDemoMode } from "@/lib/demo/mode";
import { MapPin } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Info = { name: string; business: string; hasPin: boolean };
type Spot = { latitude: number; longitude: number; accuracy: number } | null;

function locate(): Promise<Spot> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

/** An employee's private check-in page on their own phone. No login needed. */
export default function PhoneCheckinPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [spot, setSpot] = useState<Spot | undefined>(undefined);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (isDemoMode()) {
      setError("Phone check-in links work on your live account. In the demo, use the kiosk on the Attendance page.");
      return;
    }
    fetch(`/api/attendance/link?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(json.error ?? "This check-in link is not valid.");
        setInfo(json as Info);
      })
      .catch((e: Error) => setError(e.message));
    void locate().then(setSpot);
  }, [token]);

  const submit = useCallback(
    async (pin: string, photo: string): Promise<PunchResult> => {
      const where = spot ?? (await locate());
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "phone",
          token,
          pin,
          photo,
          timeZone: browserTimeZone(),
          ...(where ?? {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not record that. Please try again.");
      return json as PunchResult;
    },
    [spot, token]
  );

  return (
    <main className="flex min-h-dvh flex-col items-center bg-[radial-gradient(ellipse_at_top,#2a1650,#0d0a1a_60%)] px-4 py-8 text-white">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">{APP_NAME} attendance</p>
      <h1 className="mt-1 text-center font-display text-2xl font-bold">{info?.business || "Check in"}</h1>

      <div className="mt-6 w-full max-w-sm">
        {error ? (
          <p className="rounded-2xl bg-rose-500/15 p-4 text-center text-rose-200">{error}</p>
        ) : !info ? (
          <p className="text-center text-white/50">Loading…</p>
        ) : !info.hasPin ? (
          <p className="rounded-2xl bg-white/10 p-4 text-center">
            Hi {info.name}, your manager hasn&apos;t set your PIN yet. Ask them to set it in Kayyro → Staff.
          </p>
        ) : (
          <>
            <PunchPad key={round} name={info.name} onSubmit={submit} onDone={() => setRound((r) => r + 1)} doneAfterMs={8000} />
            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-white/45">
              <MapPin className="h-3.5 w-3.5" />
              {spot === undefined
                ? "Finding your location…"
                : spot
                  ? `Your location is shared with your manager (±${Math.round(spot.accuracy)} m).`
                  : "Location is off. You can still check in; your manager will see it was from your phone."}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
