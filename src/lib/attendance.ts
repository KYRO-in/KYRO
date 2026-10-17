/**
 * Attendance maths shared by the Attendance pages, the punch API and Ask Kayyro.
 * Punches are stored as instants (UTC); everything a person reads - "today",
 * "checked in at 09:04", "late" - is worked out in the shop's local time zone.
 */

export type PunchKind = "in" | "out";

export interface PunchLike {
  employee_id: string;
  kind: PunchKind | string;
  at: string;
}

export interface EmployeeLike {
  id: string;
  full_name: string;
  job_title?: string | null;
  shift_start?: string | null;
  active?: boolean;
}

/** Minutes after the shift starts before a check-in counts as late. */
export const LATE_GRACE_MINUTES = 10;

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(date: Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)) {
    out[p.type] = p.value;
  }
  return out;
}

/** Local calendar date (YYYY-MM-DD) of an instant. */
export function localDate(at: string | Date, timeZone: string): string {
  const p = parts(new Date(at), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local wall-clock time (HH:MM, 24h) of an instant. */
export function localTime(at: string | Date, timeZone: string): string {
  const p = parts(new Date(at), timeZone);
  return `${p.hour}:${p.minute}`;
}

/** How far the zone is ahead of UTC at that instant, in minutes. */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = parts(at, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant local midnight starts on a given local date. */
export function localDayStart(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let start = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  // Correct once more in case the offset changed between the guess and midnight (DST)
  start = guess - offsetMinutes(new Date(start), timeZone) * 60000;
  return new Date(start);
}

export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "09:00:00" or "09:00" → minutes after midnight */
export function minutesOf(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isLate(firstIn: string | null, shiftStart: string | null | undefined, grace = LATE_GRACE_MINUTES) {
  const a = minutesOf(firstIn);
  const s = minutesOf(shiftStart);
  if (a == null || s == null) return false;
  return a > s + grace;
}

export interface AttendanceDay {
  date: string;
  firstIn: string | null;
  lastOut: string | null;
  /** Worked minutes from completed in → out pairs */
  minutes: number;
  /** Checked in and not yet out (for today: still at work) */
  open: boolean;
  /** Time of the open check-in, as an instant */
  openSince: string | null;
  late: boolean;
  punches: number;
}

/**
 * Turn one employee's punches into days. A check-in followed by a check-out is
 * one stretch of work; a check-in with no check-out stays open.
 */
export function attendanceDays(
  punches: PunchLike[],
  timeZone: string,
  shiftStart?: string | null
): Map<string, AttendanceDay> {
  const days = new Map<string, AttendanceDay>();
  const sorted = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  const openIn = new Map<string, string>();
  for (const p of sorted) {
    const date = localDate(p.at, timeZone);
    const day =
      days.get(date) ??
      ({ date, firstIn: null, lastOut: null, minutes: 0, open: false, openSince: null, late: false, punches: 0 } as AttendanceDay);
    day.punches += 1;
    if (p.kind === "in") {
      if (!day.firstIn) day.firstIn = localTime(p.at, timeZone);
      if (!openIn.has(date)) openIn.set(date, p.at);
    } else {
      day.lastOut = localTime(p.at, timeZone);
      const since = openIn.get(date);
      if (since) {
        day.minutes += Math.max(0, Math.round((Date.parse(p.at) - Date.parse(since)) / 60000));
        openIn.delete(date);
      }
    }
    days.set(date, day);
  }
  Array.from(openIn).forEach(([date, since]) => {
    const day = days.get(date)!;
    day.open = true;
    day.openSince = since;
  });
  days.forEach((day) => {
    day.late = isLate(day.firstIn, shiftStart);
  });
  return days;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Per-employee totals for a date range, for reports and Ask Kayyro. */
export function summariseAttendance(
  employees: EmployeeLike[],
  punches: PunchLike[],
  opts: { from: string; to: string; timeZone: string }
) {
  const byEmployee = new Map<string, PunchLike[]>();
  for (const p of punches) {
    const list = byEmployee.get(p.employee_id) ?? [];
    list.push(p);
    byEmployee.set(p.employee_id, list);
  }
  const span = datesBetween(opts.from, opts.to);
  return employees
    .filter((e) => e.active !== false || byEmployee.has(e.id))
    .map((e) => {
      const days = Array.from(attendanceDays(byEmployee.get(e.id) ?? [], opts.timeZone, e.shift_start).values()).filter(
        (d) => d.date >= opts.from && d.date <= opts.to && d.firstIn
      );
      const minutes = days.reduce((s, d) => s + d.minutes, 0);
      return {
        employee: e.full_name,
        job_title: e.job_title ?? null,
        shift_starts: e.shift_start ? e.shift_start.slice(0, 5) : null,
        days_present: days.length,
        days_absent: Math.max(0, span.length - days.length),
        late_days: days.filter((d) => d.late).length,
        hours_worked: Math.round((minutes / 60) * 10) / 10,
        still_checked_in: days.some((d) => d.open && d.date === opts.to),
        days:
          span.length <= 14
            ? days.map((d) => ({ date: d.date, in: d.firstIn, out: d.lastOut, late: d.late, worked: formatMinutes(d.minutes) }))
            : undefined,
      };
    });
}
