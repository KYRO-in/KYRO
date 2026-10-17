import { localDate, localDayStart, browserTimeZone } from "@/lib/attendance";
import type { AttendancePunch, Employee } from "@/lib/types";

/**
 * Demo-mode staff and attendance. Lives in memory like the rest of the demo
 * store: a full page reload starts again from the sample team.
 */

type StaffStore = {
  employees: Employee[];
  punches: AttendancePunch[];
  pins: Map<string, string>;
};

const KEY = "__kayyro_demo_staff_v1__";

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function token() {
  return (uid() + uid()).replace(/-/g, "").slice(0, 64).padEnd(64, "0");
}

function seed(): StaffStore {
  const tz = browserTimeZone();
  const mk = (full_name: string, job_title: string, shift_start: string, shift_end: string): Employee => ({
    id: uid(),
    full_name,
    job_title,
    phone: null,
    shift_start,
    shift_end,
    allow_phone: true,
    checkin_token: token(),
    photo_path: null,
    has_pin: true,
    active: true,
    created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
  });
  const employees = [
    mk("Ravi Kumar", "Cashier", "09:00:00", "18:00:00"),
    mk("Sara Ahmed", "Sales", "10:00:00", "19:00:00"),
    mk("Joseph Mathew", "Store keeper", "08:00:00", "17:00:00"),
    mk("Fatima Noor", "Manager", "09:00:00", "18:00:00"),
  ];
  const pins = new Map(employees.map((e) => [e.id, "1234"]));

  // Two weeks of sample punches, some late, one person off on Fridays
  const punches: AttendancePunch[] = [];
  const today = localDate(new Date(), tz);
  const at = (date: string, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(localDayStart(date, tz).getTime() + (h * 60 + m) * 60000).toISOString();
  };
  const add = (e: Employee, kind: "in" | "out", iso: string) =>
    punches.push({
      id: uid(),
      employee_id: e.id,
      kind,
      at: iso,
      source: "kiosk",
      photo_path: null,
      latitude: null,
      longitude: null,
      accuracy_m: null,
      note: null,
      created_by: null,
      created_at: iso,
    });
  for (let back = 13; back >= 0; back--) {
    const d = new Date(localDayStart(today, tz).getTime() - back * 86400000 + 12 * 3600000);
    const date = localDate(d, tz);
    const weekday = d.getUTCDay();
    employees.forEach((e, i) => {
      if (weekday === 5 && i === 2) return;
      if ((back + i) % 9 === 0 && back > 0) return; // the odd day off
      const [sh, sm] = (e.shift_start ?? "09:00").split(":").map(Number);
      const lateBy = (back * 7 + i * 13) % 5 === 0 ? 18 : -((back + i) % 6);
      const inMin = sh * 60 + sm + lateBy;
      const inAt = at(date, `${Math.floor(inMin / 60)}:${inMin % 60}`);
      if (back === 0) {
        if (new Date(inAt).getTime() < Date.now() && i !== 1) add(e, "in", inAt);
        return;
      }
      add(e, "in", inAt);
      const [eh] = (e.shift_end ?? "18:00").split(":").map(Number);
      add(e, "out", at(date, `${eh}:${(back * 11 + i * 3) % 30}`));
    });
  }
  return { employees, punches, pins };
}

function store(): StaffStore {
  const g = globalThis as unknown as Record<string, StaffStore | undefined>;
  if (!g[KEY]) g[KEY] = seed();
  return g[KEY]!;
}

export const demoStaff = {
  employees(): Employee[] {
    return [...store().employees].sort((a, b) => a.full_name.localeCompare(b.full_name));
  },
  createEmployee(input: Partial<Employee> & { full_name: string }): Employee {
    const active = store().employees.filter((e) => e.active).length;
    if (active >= 15) throw new Error("Your plan includes 15 active employees. Upgrade in Settings → Billing to add more.");
    const e: Employee = {
      id: uid(),
      full_name: input.full_name,
      job_title: input.job_title ?? null,
      phone: input.phone ?? null,
      shift_start: input.shift_start ?? null,
      shift_end: input.shift_end ?? null,
      allow_phone: input.allow_phone ?? true,
      checkin_token: token(),
      photo_path: input.photo_path ?? null,
      has_pin: false,
      active: true,
      created_at: new Date().toISOString(),
    };
    store().employees.push(e);
    return e;
  },
  updateEmployee(id: string, patch: Partial<Employee>): Employee {
    const e = store().employees.find((x) => x.id === id);
    if (!e) throw new Error("Employee not found");
    Object.assign(e, patch, { id: e.id });
    return e;
  },
  deleteEmployee(id: string) {
    const s = store();
    s.employees = s.employees.filter((e) => e.id !== id);
    s.punches = s.punches.filter((p) => p.employee_id !== id);
  },
  setPin(id: string, pin: string) {
    store().pins.set(id, pin);
    demoStaff.updateEmployee(id, { has_pin: true });
  },
  newToken(id: string) {
    return demoStaff.updateEmployee(id, { checkin_token: token() });
  },
  punches(fromIso: string, toIso: string): AttendancePunch[] {
    return store()
      .punches.filter((p) => p.at >= fromIso && p.at < toIso)
      .sort((a, b) => b.at.localeCompare(a.at));
  },
  punch(input: { employee_id: string; pin: string; photo: string; source: "kiosk" | "phone"; timeZone: string }) {
    const s = store();
    const e = s.employees.find((x) => x.id === input.employee_id && x.active);
    if (!e) throw new Error("Employee not found.");
    if (!s.pins.has(e.id)) throw new Error("No PIN is set for you yet. Ask your manager to set one.");
    if (s.pins.get(e.id) !== input.pin) throw new Error("That PIN is not right. Try again.");
    const start = localDayStart(localDate(new Date(), input.timeZone), input.timeZone).toISOString();
    const last = s.punches
      .filter((p) => p.employee_id === e.id && p.at >= start)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    const now = new Date().toISOString();
    const p: AttendancePunch = {
      id: uid(),
      employee_id: e.id,
      kind: last?.kind === "in" ? "out" : "in",
      at: now,
      source: input.source,
      photo_path: input.photo,
      latitude: null,
      longitude: null,
      accuracy_m: null,
      note: null,
      created_by: null,
      created_at: now,
    };
    s.punches.push(p);
    return { kind: p.kind, at: p.at, name: e.full_name };
  },
  addManual(input: { employee_id: string; kind: "in" | "out"; at: string; note: string | null }) {
    const p: AttendancePunch = {
      id: uid(),
      employee_id: input.employee_id,
      kind: input.kind,
      at: input.at,
      source: "manual",
      photo_path: null,
      latitude: null,
      longitude: null,
      accuracy_m: null,
      note: input.note,
      created_by: null,
      created_at: new Date().toISOString(),
    };
    store().punches.push(p);
    return p;
  },
  deletePunch(id: string) {
    const s = store();
    s.punches = s.punches.filter((p) => p.id !== id);
  },
};
