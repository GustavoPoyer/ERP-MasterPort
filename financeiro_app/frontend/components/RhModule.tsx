"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { KivoLoader, waitMinLoaderTime } from "./KivoLoader";

export type RhView = "overview" | "calendario" | "colaboradores" | "admissao" | "demissao" | "ferias" | "folha";

export const RH_VIEW_LABELS: Record<RhView, string> = {
  overview: "Visão geral",
  calendario: "Calendário",
  colaboradores: "Colaboradores",
  admissao: "Admissão",
  demissao: "Demissão",
  ferias: "Férias",
  folha: "Folha salarial",
};

type RhDashboard = {
  total_employees: number;
  active_employees: number;
  pending_vacations: number;
  approved_vacations: number;
  payroll_pending: number;
  payroll_paid: number;
  monthly_payroll_total: number;
  upcoming_events: number;
};

type RhEmployee = {
  id: number;
  full_name: string;
  email: string;
  department: string;
  job_title: string;
  salary_base: number;
  vacation_balance_days: number;
  admission_date: string;
  status: string;
};

type RhVacation = {
  id: number;
  employee_id: number;
  employee_name: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  notes: string;
};

type RhPayroll = {
  id: number;
  employee_id: number;
  employee_name: string;
  reference_month: string;
  gross_salary: number;
  deductions: number;
  net_salary: number;
  status: string;
  notes: string;
};

type RhCalendarEvent = {
  id: number;
  title: string;
  event_type: string;
  start_date: string;
  end_date: string;
  employee_id: number | null;
  employee_name: string;
  description: string;
  color: string;
};

const DEFAULT_EVENT_COLOR = "#d9f99d";

const EVENT_COLOR_PRESETS = [
  { hex: "#d9f99d", label: "Limão" },
  { hex: "#5eb3ff", label: "Azul" },
  { hex: "#fbbf24", label: "Amarelo" },
  { hex: "#f472b6", label: "Rosa" },
  { hex: "#a78bfa", label: "Lilás" },
  { hex: "#34d399", label: "Verde" },
  { hex: "#fb7185", label: "Coral" },
  { hex: "#94a3b8", label: "Cinza" },
] as const;

const RH_VIEWS: { key: RhView; label: string }[] = [
  { key: "overview", label: "Visão geral" },
  { key: "calendario", label: "Calendário" },
  { key: "colaboradores", label: "Colaboradores" },
  { key: "admissao", label: "Admissão" },
  { key: "demissao", label: "Demissão" },
  { key: "ferias", label: "Férias" },
  { key: "folha", label: "Folha salarial" },
];

const EVENT_TYPE_LABEL: Record<string, string> = {
  folha: "Folha",
  ferias: "Férias",
  compliance: "Compliance",
  treinamento: "Treinamento",
  aniversario: "Aniversário",
  geral: "Geral",
};

const VACATION_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Recusada",
  cancelled: "Cancelada",
};

const PAYROLL_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  paid: "Paga",
  cancelled: "Cancelada",
};

const EMPLOYEE_STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  inactive: "Desligado",
};

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatDayIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidIsoDate(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

function parseIsoParts(iso: string): { year: number; month: number; day: number } | null {
  if (!isValidIsoDate(iso)) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function isSameCalendarDay(iso: string, year: number, month: number, day: number): boolean {
  const parts = parseIsoParts(iso);
  if (!parts) return false;
  return parts.year === year && parts.month === month && parts.day === day;
}

function eventPillStyle(color: string): CSSProperties {
  const hex = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_EVENT_COLOR;
  return {
    borderColor: `${hex}88`,
    backgroundColor: `${hex}33`,
    color: hex,
  };
}

const DEPARTMENT_CARD_COLORS = ["#3b6cff", "#f97316", "#7c3aed", "#16a34a", "#dc2626", "#14b8a6"] as const;

function employeeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function departmentTag(name: string): string {
  return `#${name.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, "").slice(0, 12)}`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function vacationOverlapsMonth(vac: RhVacation, year: number, month: number): boolean {
  const start = parseIsoDate(vac.start_date);
  const end = parseIsoDate(vac.end_date);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  return start <= monthEnd && end >= monthStart;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function eventDaysInMonth(event: RhCalendarEvent, year: number, month: number): number[] {
  const startParts = parseIsoParts(event.start_date);
  const endParts = parseIsoParts(event.end_date || event.start_date);
  if (!startParts || !endParts) return [];

  let start = new Date(startParts.year, startParts.month - 1, startParts.day);
  let end = new Date(endParts.year, endParts.month - 1, endParts.day);
  if (end < start) end = start;

  const days: number[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (cursor.getFullYear() === year && cursor.getMonth() + 1 === month) {
      days.push(cursor.getDate());
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildEventPayload(event: {
  title: string;
  event_type: string;
  start_date: string;
  end_date: string;
  description: string;
  color: string;
}) {
  const title = event.title.trim() || (event.event_type === "ferias" ? "Férias" : "Compromisso");
  const endDate = event.event_type === "ferias" ? event.end_date || event.start_date : event.start_date;
  return { ...event, title, end_date: endDate };
}

function formatEventPeriod(event: RhCalendarEvent): string {
  const start = parseIsoDate(event.start_date).toLocaleDateString("pt-BR");
  const end = parseIsoDate(event.end_date || event.start_date).toLocaleDateString("pt-BR");
  return start === end ? start : `${start} — ${end}`;
}

function startWeekday(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

type RhModuleProps = {
  apiBase: string;
  authToken: string;
};

type RhSelectOption = { value: string; label: string };

function RhSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: RhSelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className={`rh-select ${open ? "rh-select--open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="rh-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((state) => !state)}
      >
        <span>{selected?.label ?? value}</span>
        <span className="rh-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul className="rh-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <li key={option.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`rh-select-option ${option.value === value ? "is-selected" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RhModule({ apiBase, authToken }: RhModuleProps) {
  const [rhView, setRhView] = useState<RhView>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<RhDashboard | null>(null);
  const [employees, setEmployees] = useState<RhEmployee[]>([]);
  const [vacations, setVacations] = useState<RhVacation[]>([]);
  const [payroll, setPayroll] = useState<RhPayroll[]>([]);
  const [events, setEvents] = useState<RhCalendarEvent[]>([]);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [payrollMonth, setPayrollMonth] = useState(currentMonthKey());
  const [busy, setBusy] = useState(false);
  const [calendarSuccess, setCalendarSuccess] = useState("");
  const [overviewPayroll, setOverviewPayroll] = useState<RhPayroll[]>([]);
  const [yearPayrollTotals, setYearPayrollTotals] = useState<number[]>(() => new Array(12).fill(0));
  const [deleteConfirmEventId, setDeleteConfirmEventId] = useState<number | null>(null);
  const [deleteInlineError, setDeleteInlineError] = useState("");
  const [vacationDateField, setVacationDateField] = useState<"start" | "end">("start");

  const [newEvent, setNewEvent] = useState({
    title: "",
    event_type: "geral",
    start_date: "",
    end_date: "",
    description: "",
    color: DEFAULT_EVENT_COLOR,
  });

  const [admissionForm, setAdmissionForm] = useState({
    full_name: "",
    email: "",
    department: "",
    job_title: "",
    salary_base: "",
    vacation_balance_days: "30",
    admission_date: new Date().toISOString().slice(0, 10),
  });
  const [admissionSuccess, setAdmissionSuccess] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [dismissalForm, setDismissalForm] = useState({
    employee_id: "",
    termination_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [dismissConfirmOpen, setDismissConfirmOpen] = useState(false);
  const [dismissalSuccess, setDismissalSuccess] = useState("");
  const [dismissalEmployeeSearch, setDismissalEmployeeSearch] = useState("");

  const apiFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${authToken}`,
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      };
      if (init?.body) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(`${apiBase}${path}`, {
        ...init,
        headers,
      });
      if (!res.ok) {
        let detail = "Erro ao comunicar com a API de RH.";
        try {
          const body = await res.json();
          if (body?.detail) {
            detail = typeof body.detail === "string" ? body.detail : detail;
            if (detail === "Not Found" && init?.method === "DELETE") {
              detail = "Não foi possível excluir. Reinicie o backend (API) e tente novamente.";
            }
          }
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      if (res.status === 204 || res.status === 205) return undefined as T;
      const text = await res.text();
      if (!text.trim()) return undefined as T;
      return JSON.parse(text) as T;
    },
    [apiBase, authToken],
  );

  const loadCalendarEvents = useCallback(
    async (year: number, month: number) => {
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return;
      }
      try {
        const cal = await apiFetch<RhCalendarEvent[]>(`/rh/calendar?year=${year}&month=${month}`);
        setEvents(cal);
        return cal;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível carregar o calendário.");
      }
    },
    [apiFetch],
  );

  const loadRhData = useCallback(async () => {
    const startedAt = Date.now();
    setLoading(true);
    setError("");
    try {
      const [dash, emps, vacs, pay] = await Promise.all([
        apiFetch<RhDashboard>("/rh/dashboard"),
        apiFetch<RhEmployee[]>("/rh/employees"),
        apiFetch<RhVacation[]>("/rh/vacations"),
        apiFetch<RhPayroll[]>(`/rh/payroll?month=${encodeURIComponent(payrollMonth)}`),
      ]);
      setDashboard(dash);
      setEmployees(emps);
      setVacations(vacs);
      setPayroll(pay);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar dados de RH.");
    } finally {
      await waitMinLoaderTime(startedAt);
      setLoading(false);
    }
  }, [apiFetch, payrollMonth]);

  useEffect(() => {
    loadRhData().catch(() => null);
  }, [loadRhData]);

  useEffect(() => {
    loadCalendarEvents(calendarYear, calendarMonth).catch(() => null);
  }, [calendarYear, calendarMonth, loadCalendarEvents]);

  useEffect(() => {
    let cancelled = false;
    const key = monthKey(calendarYear, calendarMonth);
    apiFetch<RhPayroll[]>(`/rh/payroll?month=${encodeURIComponent(key)}`)
      .then((rows) => {
        if (!cancelled) setOverviewPayroll(rows);
      })
      .catch(() => {
        if (!cancelled) setOverviewPayroll([]);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarYear, calendarMonth, apiFetch]);

  useEffect(() => {
    if (rhView !== "overview") return;
    let cancelled = false;
    (async () => {
      const totals = await Promise.all(
        Array.from({ length: 12 }, async (_, index) => {
          const key = monthKey(calendarYear, index + 1);
          try {
            const rows = await apiFetch<RhPayroll[]>(`/rh/payroll?month=${encodeURIComponent(key)}`);
            return rows.reduce((acc, row) => acc + row.net_salary, 0);
          } catch {
            return 0;
          }
        }),
      );
      if (!cancelled) setYearPayrollTotals(totals);
    })();
    return () => {
      cancelled = true;
    };
  }, [rhView, calendarYear, apiFetch]);

  const eventsByDay = useMemo(() => {
    const map = new Map<number, RhCalendarEvent[]>();
    for (const event of events) {
      for (const day of eventDaysInMonth(event, calendarYear, calendarMonth)) {
        const list = map.get(day) ?? [];
        list.push(event);
        map.set(day, list);
      }
    }
    return map;
  }, [events, calendarYear, calendarMonth]);

  const calendarCells = useMemo(() => {
    const totalDays = daysInMonth(calendarYear, calendarMonth);
    const offset = startWeekday(calendarYear, calendarMonth);
    const cells: Array<{ day: number | null; events: RhCalendarEvent[] }> = [];
    for (let i = 0; i < offset; i += 1) cells.push({ day: null, events: [] });
    for (let day = 1; day <= totalDays; day += 1) {
      cells.push({ day, events: eventsByDay.get(day) ?? [] });
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, events: [] });
    return cells;
  }, [calendarYear, calendarMonth, eventsByDay]);

  const departmentCards = useMemo(() => {
    const payrollByEmployee = new Map(overviewPayroll.map((row) => [row.employee_id, row.net_salary]));
    const map = new Map<string, { name: string; count: number; totalSalary: number; employees: RhEmployee[] }>();
    for (const emp of employees) {
      const dept = emp.department.trim() || "Geral";
      const entry = map.get(dept) ?? { name: dept, count: 0, totalSalary: 0, employees: [] };
      entry.count += 1;
      entry.totalSalary += payrollByEmployee.get(emp.id) ?? emp.salary_base;
      entry.employees.push(emp);
      map.set(dept, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [employees, overviewPayroll]);

  const overviewMetrics = useMemo(() => {
    const monthVacations = vacations.filter((vac) => vacationOverlapsMonth(vac, calendarYear, calendarMonth));
    const payrollTotal = overviewPayroll.reduce((acc, row) => acc + row.net_salary, 0);
    return {
      payrollTotal,
      payrollPending: overviewPayroll.filter((row) => row.status === "pending").length,
      pendingVacations: monthVacations.filter((vac) => vac.status === "pending").length,
      approvedVacations: monthVacations.filter((vac) => vac.status === "approved").length,
      eventCount: events.length,
      monthVacations,
    };
  }, [vacations, calendarYear, calendarMonth, overviewPayroll, events]);

  const annualPayrollEstimate = useMemo(
    () => yearPayrollTotals.reduce((acc, value) => acc + value, 0),
    [yearPayrollTotals],
  );

  const overviewMonthBars = useMemo(() => {
    const labels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const maxTotal = Math.max(...yearPayrollTotals, 1);
    return labels.map((label, index) => {
      const month = index + 1;
      const total = yearPayrollTotals[index] ?? 0;
      const height = total > 0 ? Math.max(28, (total / maxTotal) * 100) : 28;
      return {
        label,
        month,
        height,
        isSelected: month === calendarMonth,
        total,
      };
    });
  }, [calendarMonth, yearPayrollTotals]);

  const selectOverviewMonth = (month: number) => {
    if (month < 1 || month > 12) return;
    setCalendarMonth(month);
  };

  const shiftOverviewYear = (delta: number) => {
    setCalendarYear((year) => year + delta);
  };

  const shiftCalendar = (delta: number) => {
    const date = new Date(calendarYear, calendarMonth - 1 + delta, 1);
    setCalendarYear(date.getFullYear());
    setCalendarMonth(date.getMonth() + 1);
  };

  const pickCalendarDay = (day: number) => {
    const iso = formatDayIso(calendarYear, calendarMonth, day);
    setCalendarSuccess("");
    setError("");
    setNewEvent((state) => {
      if (state.event_type === "ferias" && vacationDateField === "end") {
        const endDate = state.start_date && iso < state.start_date ? state.start_date : iso;
        return { ...state, end_date: endDate };
      }
      if (state.event_type === "ferias") {
        const endDate =
          state.end_date && state.end_date >= iso ? state.end_date : state.end_date || "";
        return { ...state, start_date: iso, end_date: endDate };
      }
      return { ...state, start_date: iso, end_date: iso };
    });
  };

  const handleEventTypeChange = (eventType: string) => {
    setNewEvent((state) => ({
      ...state,
      event_type: eventType,
      end_date: eventType === "ferias" ? state.end_date : state.start_date,
    }));
    if (eventType === "ferias") {
      setVacationDateField("start");
    }
  };

  const handleVacationStartChange = (iso: string) => {
    setNewEvent((state) => {
      const endDate = state.end_date && iso && state.end_date < iso ? iso : state.end_date;
      return { ...state, start_date: iso, end_date: endDate };
    });
    if (iso) syncCalendarToDate(iso);
  };

  const handleVacationEndChange = (iso: string) => {
    setNewEvent((state) => {
      const endDate = state.start_date && iso && iso < state.start_date ? state.start_date : iso;
      return { ...state, end_date: endDate };
    });
  };

  const markDayOnCalendar = async () => {
    if (!newEvent.start_date) {
      setError("Clique em um dia do calendário para marcar.");
      return;
    }
    const payload = buildEventPayload(newEvent);
    if (payload.event_type === "ferias" && payload.end_date < payload.start_date) {
      setError("A data final deve ser igual ou posterior à data de início.");
      return;
    }
    setBusy(true);
    setError("");
    setCalendarSuccess("");
    try {
      const parts = parseIsoParts(payload.start_date);
      if (!parts) {
        setError("Informe uma data válida.");
        return;
      }

      const created = await apiFetch<RhCalendarEvent>("/rh/calendar/events", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const startParts = parseIsoParts(created.start_date);
      if (startParts && (startParts.year !== calendarYear || startParts.month !== calendarMonth)) {
        setCalendarYear(startParts.year);
        setCalendarMonth(startParts.month);
        await loadCalendarEvents(startParts.year, startParts.month);
      } else {
        await loadCalendarEvents(calendarYear, calendarMonth);
      }

      const dash = await apiFetch<RhDashboard>("/rh/dashboard");
      setDashboard(dash);

      setNewEvent((state) => ({
        ...state,
        title: "",
        description: "",
        end_date: state.event_type === "ferias" ? "" : state.end_date,
      }));

      const startLabel = parseIsoDate(created.start_date).toLocaleDateString("pt-BR");
      const endLabel = parseIsoDate(created.end_date || created.start_date).toLocaleDateString("pt-BR");
      const periodLabel = created.end_date && created.end_date !== created.start_date ? `${startLabel} — ${endLabel}` : startLabel;
      setCalendarSuccess(`Marcado (${periodLabel}): ${created.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível marcar no calendário.");
    } finally {
      setBusy(false);
    }
  };

  const syncCalendarToDate = (iso: string) => {
    const parts = parseIsoParts(iso);
    if (!parts) return;
    if (parts.year !== calendarYear || parts.month !== calendarMonth) {
      setCalendarYear(parts.year);
      setCalendarMonth(parts.month);
    }
  };

  const deleteCalendarEvent = async (eventId: number) => {
    const target = events.find((item) => item.id === eventId);
    if (!target) return;

    const removedTitle = target.title;
    const snapshot = events;
    setEvents((prev) => prev.filter((item) => item.id !== eventId));
    setDeleteConfirmEventId(null);
    setDeleteInlineError("");
    setBusy(true);
    setError("");
    setCalendarSuccess("");
    try {
      await apiFetch<{ ok: boolean; id: number }>(`/rh/calendar/events/${eventId}`, { method: "DELETE" });
      await loadCalendarEvents(calendarYear, calendarMonth);
      const dash = await apiFetch<RhDashboard>("/rh/dashboard");
      setDashboard(dash);
      setCalendarSuccess(`"${removedTitle}" excluída do calendário.`);
    } catch (err) {
      setEvents(snapshot);
      const message = err instanceof Error ? err.message : "Não foi possível excluir a marcação.";
      setDeleteInlineError(message);
      setDeleteConfirmEventId(eventId);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const requestDeleteCalendarEvent = (eventId: number) => {
    setDeleteInlineError("");
    setDeleteConfirmEventId((current) => (current === eventId ? null : eventId));
  };

  const updateVacationStatus = async (id: number, status: string) => {
    setBusy(true);
    try {
      await apiFetch(`/rh/vacations/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const [dash, vacs] = await Promise.all([
        apiFetch<RhDashboard>("/rh/dashboard"),
        apiFetch<RhVacation[]>("/rh/vacations"),
      ]);
      setDashboard(dash);
      setVacations(vacs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar férias.");
    } finally {
      setBusy(false);
    }
  };

  const updatePayrollStatus = async (id: number, status: string) => {
    setBusy(true);
    try {
      await apiFetch(`/rh/payroll/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const [dash, pay] = await Promise.all([
        apiFetch<RhDashboard>("/rh/dashboard"),
        apiFetch<RhPayroll[]>(`/rh/payroll?month=${encodeURIComponent(payrollMonth)}`),
      ]);
      setDashboard(dash);
      setPayroll(pay);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar folha.");
    } finally {
      setBusy(false);
    }
  };

  const submitEvent = markDayOnCalendar;

  const recentAdmissions = useMemo(() => {
    return [...employees]
      .filter((emp) => emp.admission_date)
      .sort((a, b) => b.admission_date.localeCompare(a.admission_date))
      .slice(0, 6);
  }, [employees]);

  const jobTitleOptions = useMemo(() => {
    const titles = new Set<string>();
    for (const emp of employees) {
      const title = emp.job_title.trim();
      if (title) titles.add(title);
    }
    return Array.from(titles).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!jobTitleFilter) return employees;
    return employees.filter((emp) => emp.job_title.trim() === jobTitleFilter);
  }, [employees, jobTitleFilter]);

  const activeEmployees = useMemo(
    () =>
      [...employees]
        .filter((emp) => emp.status === "active")
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
    [employees],
  );

  const inactiveEmployees = useMemo(
    () =>
      [...employees]
        .filter((emp) => emp.status !== "active")
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
    [employees],
  );

  const selectedDismissEmployee = useMemo(
    () => activeEmployees.find((emp) => String(emp.id) === dismissalForm.employee_id) ?? null,
    [activeEmployees, dismissalForm.employee_id],
  );

  const filteredDismissEmployees = useMemo(() => {
    const query = dismissalEmployeeSearch.trim().toLowerCase();
    if (!query) return activeEmployees;
    return activeEmployees.filter((emp) => {
      const haystack = [emp.full_name, emp.job_title, emp.department, emp.email]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [activeEmployees, dismissalEmployeeSearch]);

  const submitAdmission = async () => {
    const fullName = admissionForm.full_name.trim();
    if (!fullName) {
      setError("Informe o nome completo do colaborador.");
      return;
    }
    if (!admissionForm.admission_date) {
      setError("Informe a data de admissão.");
      return;
    }

    setBusy(true);
    setError("");
    setAdmissionSuccess("");
    try {
      await apiFetch<RhEmployee>("/rh/employees", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          email: admissionForm.email.trim(),
          department: admissionForm.department.trim(),
          job_title: admissionForm.job_title.trim(),
          salary_base: Number(admissionForm.salary_base) || 0,
          vacation_balance_days: Number(admissionForm.vacation_balance_days) || 30,
          admission_date: admissionForm.admission_date,
          status: "active",
        }),
      });

      const [dash, emps] = await Promise.all([
        apiFetch<RhDashboard>("/rh/dashboard"),
        apiFetch<RhEmployee[]>("/rh/employees"),
      ]);
      setDashboard(dash);
      setEmployees(emps);
      setAdmissionSuccess(`${fullName} admitido(a) com sucesso.`);
      setAdmissionForm({
        full_name: "",
        email: "",
        department: "",
        job_title: "",
        salary_base: "",
        vacation_balance_days: "30",
        admission_date: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a admissão.");
    } finally {
      setBusy(false);
    }
  };

  const submitDismissal = async () => {
    if (!selectedDismissEmployee) {
      setError("Selecione o colaborador a desligar.");
      return;
    }
    if (!dismissalForm.termination_date) {
      setError("Informe a data da demissão.");
      return;
    }

    const employeeName = selectedDismissEmployee.full_name;
    setBusy(true);
    setError("");
    setDismissalSuccess("");
    setDismissConfirmOpen(false);
    try {
      await apiFetch<RhEmployee>(`/rh/employees/${selectedDismissEmployee.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "inactive" }),
      });

      const [dash, emps] = await Promise.all([
        apiFetch<RhDashboard>("/rh/dashboard"),
        apiFetch<RhEmployee[]>("/rh/employees"),
      ]);
      setDashboard(dash);
      setEmployees(emps);
      setDismissalSuccess(
        `${employeeName} desligado(a) em ${parseIsoDate(dismissalForm.termination_date).toLocaleDateString("pt-BR")}.`,
      );
      setDismissalForm({
        employee_id: "",
        termination_date: new Date().toISOString().slice(0, 10),
        notes: "",
      });
      setDismissalEmployeeSearch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a demissão.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (rhView !== "calendario" || newEvent.start_date) return;
    const now = new Date();
    if (now.getFullYear() === calendarYear && now.getMonth() + 1 === calendarMonth) {
      const iso = formatDayIso(calendarYear, calendarMonth, now.getDate());
      setNewEvent((state) => ({
        ...state,
        start_date: iso,
        end_date: state.event_type === "ferias" ? state.end_date : iso,
      }));
    }
  }, [rhView, calendarYear, calendarMonth, newEvent.start_date, newEvent.event_type]);

  return (
    <main className="app-shell app-shell--rh">
      {rhView !== "overview" && (
        <section className="hero">
          <div>
            <h1>Painel de RH / Pessoas</h1>
            <p>
              Calendário operacional, colaboradores, controle de férias, folha salarial e eventos de compliance —
              centralizados para o time de Recursos Humanos.
            </p>
          </div>
          <div className="badge">People Ops • Internal Use</div>
        </section>
      )}

      <nav className="module-subnav rh-subnav" aria-label="Navegação RH">
        {RH_VIEWS.map((view) => (
          <button
            key={view.key}
            type="button"
            className={`module-subnav-btn ${rhView === view.key ? "active" : ""}`}
            onClick={() => setRhView(view.key)}
          >
            {view.label}
          </button>
        ))}
      </nav>

      {error && <p className="error rh-error">{error}</p>}
      {loading && !dashboard ? (
        <div className="module-pane-loading" role="status" aria-live="polite">
          <KivoLoader size="md" showLabel label="Carregando dados de RH…" />
        </div>
      ) : (
        <>
          {rhView === "overview" && dashboard && (
            <div className="rh-dash">
              <header className="rh-dash-hero">
                <div className="rh-dash-hero-copy">
                  <span className="rh-dash-eyebrow">Visão geral · {formatMonthLabel(calendarYear, calendarMonth)}</span>
                  <h2 className="rh-dash-title">Dashboard de Pessoas</h2>
                  <div className="rh-dash-hero-metric-row">
                    <span className="rh-dash-hero-value">
                      {formatBrl(overviewMetrics.payrollTotal || dashboard.monthly_payroll_total)}
                    </span>
                    <span className="rh-dash-badge">
                      {dashboard.active_employees} ativo{dashboard.active_employees === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="rh-dash-hero-label">Total líquido da folha em {formatMonthLabel(calendarYear, calendarMonth)}</p>
                </div>
                <button type="button" className="rh-dash-invite-btn" onClick={() => setRhView("calendario")}>
                  Abrir calendário
                </button>
              </header>

              <div className="rh-dash-layout">
                <div className="rh-dash-main">
                  <div className="rh-dash-section-head">
                    <h3>Setores ({departmentCards.length})</h3>
                    <button type="button" className="rh-dash-link-btn" onClick={() => setRhView("colaboradores")}>
                      Ver colaboradores →
                    </button>
                  </div>

                  <div className="rh-dash-cards">
                    {departmentCards.map((dept, index) => {
                      const color = DEPARTMENT_CARD_COLORS[index % DEPARTMENT_CARD_COLORS.length];
                      return (
                        <article
                          key={dept.name}
                          className="rh-dash-card"
                          style={{ background: `linear-gradient(145deg, ${color} 0%, ${color}dd 100%)` }}
                        >
                          <div className="rh-dash-card-top">
                            <span className="rh-dash-card-tag">{departmentTag(dept.name)}</span>
                            <span className="rh-dash-card-arrow" aria-hidden="true">
                              ↗
                            </span>
                          </div>
                          <h4 className="rh-dash-card-title">{dept.name}</h4>
                          <p className="rh-dash-card-meta">{dept.count} colaborador(es)</p>
                          <p className="rh-dash-card-value">{formatBrl(dept.totalSalary)}</p>
                          <div className="rh-dash-card-avatars">
                            {dept.employees.slice(0, 4).map((emp) => (
                              <span key={emp.id} className="rh-dash-avatar" title={emp.full_name}>
                                {employeeInitials(emp.full_name)}
                              </span>
                            ))}
                            {dept.count > 4 && <span className="rh-dash-avatar rh-dash-avatar--more">+{dept.count - 4}</span>}
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="rh-dash-stats-row">
                    <article className="rh-dash-stat-card">
                      <span className="rh-dash-stat-label">Folha acumulada {calendarYear}</span>
                      <strong className="rh-dash-stat-value">{formatBrl(annualPayrollEstimate)}</strong>
                      <p className="rh-dash-stat-hint">Soma dos 12 meses do ano selecionado</p>
                    </article>
                    <article className="rh-dash-stat-card">
                      <span className="rh-dash-stat-label">Férias & eventos do mês</span>
                      <strong className="rh-dash-stat-value">
                        {overviewMetrics.pendingVacations} / {overviewMetrics.eventCount}
                      </strong>
                      <p className="rh-dash-stat-hint">Pendentes · eventos em {formatMonthLabel(calendarYear, calendarMonth)}</p>
                    </article>
                    <article className="rh-dash-stat-card rh-dash-stat-card--chart">
                      <div className="rh-dash-chart-head">
                        <span className="rh-dash-stat-label rh-dash-stat-label--animated" key={`mov-${calendarYear}-${calendarMonth}`}>
                          Movimento {formatMonthLabel(calendarYear, calendarMonth)}
                        </span>
                        <div className="rh-dash-year-nav">
                          <button type="button" className="rh-dash-year-btn" onClick={() => shiftOverviewYear(-1)} aria-label="Ano anterior">
                            <span className="rh-dash-year-icon" aria-hidden="true">‹</span>
                          </button>
                          <span>{calendarYear}</span>
                          <button type="button" className="rh-dash-year-btn" onClick={() => shiftOverviewYear(1)} aria-label="Próximo ano">
                            <span className="rh-dash-year-icon" aria-hidden="true">›</span>
                          </button>
                        </div>
                      </div>
                      <div className="rh-dash-month-picker" role="group" aria-label="Selecionar mês">
                        {overviewMonthBars.map((bar) => (
                          <button
                            key={bar.label}
                            type="button"
                            className={`rh-dash-month-cell ${bar.isSelected ? "is-selected" : ""}`}
                            onClick={() => selectOverviewMonth(bar.month)}
                            aria-label={`Ver ${bar.label} de ${calendarYear}`}
                            aria-pressed={bar.isSelected}
                            title={bar.total > 0 ? formatBrl(bar.total) : `Sem folha em ${bar.label}`}
                          >
                            <span className="rh-dash-month-bar-wrap" aria-hidden="true">
                              <span className="rh-dash-month-bar" />
                            </span>
                            <span className="rh-dash-month-lbl">{bar.label}</span>
                          </button>
                        ))}
                      </div>
                    </article>
                  </div>

                  <div className="rh-dash-lists">
                    <section className="rh-dash-list-card">
                      <h4>Eventos em {formatMonthLabel(calendarYear, calendarMonth)}</h4>
                      <ul className="rh-event-list">
                        {events.slice(0, 4).map((event) => (
                          <li key={event.id} className="rh-event-list-item">
                            <span className="rh-event-color-dot" style={eventPillStyle(event.color)} aria-hidden="true" />
                            <div>
                              <strong>{event.title}</strong>
                              <span className="muted">
                                {parseIsoDate(event.start_date).toLocaleDateString("pt-BR")}
                              </span>
                            </div>
                          </li>
                        ))}
                        {events.length === 0 && <li className="muted">Nenhum evento neste mês.</li>}
                      </ul>
                    </section>
                    <section className="rh-dash-list-card">
                      <h4>Férias do mês</h4>
                      <ul className="rh-event-list">
                        {overviewMetrics.monthVacations.slice(0, 4).map((vac) => (
                          <li key={vac.id} className="rh-event-list-item">
                            <span className={`rh-status rh-status--${vac.status}`}>
                              {VACATION_STATUS_LABEL[vac.status] ?? vac.status}
                            </span>
                            <div>
                              <strong>{vac.employee_name}</strong>
                              <span className="muted">{vac.days} dias</span>
                            </div>
                          </li>
                        ))}
                        {overviewMetrics.monthVacations.length === 0 && (
                          <li className="muted">Nenhuma férias neste mês.</li>
                        )}
                      </ul>
                    </section>
                  </div>
                </div>

                <aside className="rh-dash-calendar-widget">
                  <div className="rh-dash-widget-head">
                    <h3>Calendário ({formatMonthLabel(calendarYear, calendarMonth)})</h3>
                    <div className="rh-dash-widget-nav">
                      <button type="button" className="btn-secondary" onClick={() => shiftCalendar(-1)} aria-label="Mês anterior">
                        ←
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => shiftCalendar(1)} aria-label="Próximo mês">
                        →
                      </button>
                    </div>
                  </div>
                  <div className="rh-dash-cal-weekdays">
                    {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                      <span key={`${d}-${i}`}>{d}</span>
                    ))}
                  </div>
                  <div className="rh-dash-cal-grid">
                    {calendarCells.map((cell, index) => {
                      if (!cell.day) {
                        return <span key={`empty-${index}`} className="rh-dash-cal-empty" />;
                      }
                      const dayEvents = cell.events;
                      const ringColor = dayEvents[0]?.color ?? DEFAULT_EVENT_COLOR;
                      return (
                        <button
                          key={`day-${cell.day}-${index}`}
                          type="button"
                          className={`rh-dash-cal-day ${dayEvents.length ? "rh-dash-cal-day--marked" : ""}`}
                          onClick={() => {
                            pickCalendarDay(cell.day as number);
                            setRhView("calendario");
                          }}
                          title={dayEvents.map((e) => e.title).join(", ") || `Dia ${cell.day}`}
                        >
                          <span
                            className="rh-dash-cal-circle"
                            style={
                              dayEvents.length
                                ? { boxShadow: `0 0 0 2px ${ringColor}`, color: ringColor }
                                : undefined
                            }
                          >
                            {cell.day}
                          </span>
                          {dayEvents.length > 0 && (
                            <span className="rh-dash-cal-avatars">
                              {dayEvents.slice(0, 2).map((event) => (
                                <span
                                  key={event.id}
                                  className="rh-dash-cal-avatar"
                                  style={{ backgroundColor: event.color }}
                                  title={event.title}
                                >
                                  {event.employee_name
                                    ? employeeInitials(event.employee_name)
                                    : event.title.slice(0, 1).toUpperCase()}
                                </span>
                              ))}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" className="rh-dash-widget-cta" onClick={() => setRhView("calendario")}>
                    Marcar novo evento
                  </button>
                </aside>
              </div>
            </div>
          )}

          {rhView === "calendario" && (
            <section className="panel rh-panel">
              <div className="rh-calendar-head">
                <div>
                  <h2>Calendário de RH</h2>
                  <p className="subtitle">Clique em um dia, descreva o evento e marque no calendário</p>
                </div>
                <div className="rh-calendar-nav">
                  <button type="button" className="btn-secondary" onClick={() => shiftCalendar(-1)}>
                    ←
                  </button>
                  <span className="rh-calendar-month">{formatMonthLabel(calendarYear, calendarMonth)}</span>
                  <button type="button" className="btn-secondary" onClick={() => shiftCalendar(1)}>
                    →
                  </button>
                </div>
              </div>

              {calendarSuccess && <p className="rh-calendar-success">{calendarSuccess}</p>}

              <div className="rh-calendar-weekdays">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="rh-calendar-grid">
                {calendarCells.map((cell, index) => {
                  const isSelected = Boolean(
                    cell.day &&
                      newEvent.start_date &&
                      isSameCalendarDay(newEvent.start_date, calendarYear, calendarMonth, cell.day),
                  );
                  return (
                    <article
                      key={`${cell.day ?? "e"}-${index}`}
                      className={`rh-calendar-day ${cell.day ? "rh-calendar-day--pickable" : "rh-calendar-day--empty"} ${
                        isSelected ? "rh-calendar-day--selected" : ""
                      }`}
                      onClick={cell.day ? () => pickCalendarDay(cell.day as number) : undefined}
                      onKeyDown={
                        cell.day
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                pickCalendarDay(cell.day as number);
                              }
                            }
                          : undefined
                      }
                      role={cell.day ? "button" : undefined}
                      tabIndex={cell.day ? 0 : undefined}
                      aria-label={cell.day ? `Dia ${cell.day}` : undefined}
                      aria-pressed={cell.day ? isSelected : undefined}
                    >
                      {cell.day ? <header>{cell.day}</header> : null}
                      <div className="rh-calendar-day-events" onClick={(e) => e.stopPropagation()}>
                        {cell.events.map((event) => (
                          <span
                            key={event.id}
                            className="rh-calendar-pill"
                            style={eventPillStyle(event.color)}
                            title={event.description || event.title}
                          >
                            {event.title}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="rh-calendar-manage">
                <div className="rh-calendar-manage-head">
                  <h3>Excluir marcação</h3>
                  <span className="rh-calendar-manage-count">{events.length} no mês</span>
                </div>
                {events.length === 0 ? (
                  <p className="subtitle">Nenhuma marcação em {formatMonthLabel(calendarYear, calendarMonth)}.</p>
                ) : (
                  <ul className="rh-calendar-manage-list">
                    {events.map((event) => {
                      const isConfirming = deleteConfirmEventId === event.id;
                      return (
                        <li
                          key={event.id}
                          className={`rh-calendar-manage-item ${isConfirming ? "rh-calendar-manage-item--confirm" : ""}`}
                        >
                          {isConfirming ? (
                            <div className="rh-calendar-inline-confirm">
                              <p className="rh-calendar-inline-confirm-text">
                                Excluir <strong>{event.title}</strong> ({formatEventPeriod(event)})?
                              </p>
                              {deleteInlineError && <p className="rh-calendar-inline-error">{deleteInlineError}</p>}
                              <div className="rh-calendar-inline-actions">
                                <button
                                  type="button"
                                  className="btn-secondary rh-calendar-inline-btn"
                                  disabled={busy}
                                  onClick={() => {
                                    setDeleteConfirmEventId(null);
                                    setDeleteInlineError("");
                                  }}
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  className="rh-calendar-delete-btn"
                                  disabled={busy}
                                  onClick={() => deleteCalendarEvent(event.id).catch(() => null)}
                                >
                                  {busy ? "Excluindo…" : "Sim, excluir"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <span className="rh-event-color-dot" style={eventPillStyle(event.color)} aria-hidden="true" />
                              <div className="rh-calendar-manage-copy">
                                <strong>{event.title}</strong>
                                <span className="muted">
                                  {EVENT_TYPE_LABEL[event.event_type] ?? event.event_type} · {formatEventPeriod(event)}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="rh-calendar-delete-btn"
                                disabled={busy}
                                onClick={() => requestDeleteCalendarEvent(event.id)}
                              >
                                Excluir
                              </button>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="rh-mark-panel">
                <h3>Marcar no dia</h3>
                {!newEvent.start_date ? (
                  <p className="subtitle">Selecione um dia na grade acima para começar.</p>
                ) : (
                  <>
                    <p className="rh-selected-date">
                      Dia escolhido:{" "}
                      <strong>{parseIsoDate(newEvent.start_date).toLocaleDateString("pt-BR")}</strong>
                    </p>
                    <div className="rh-mark-row">
                      <label className="rh-mark-title">
                        O que marcar?
                        <input
                          type="text"
                          value={newEvent.title}
                          onChange={(e) => setNewEvent((s) => ({ ...s, title: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              markDayOnCalendar().catch(() => null);
                            }
                          }}
                          placeholder="Ex.: Reunião, folha, férias..."
                          autoFocus
                        />
                      </label>
                      <button
                        type="button"
                        className="btn-primary rh-mark-btn"
                        disabled={busy}
                        onClick={() => markDayOnCalendar().catch(() => null)}
                      >
                        {busy ? "Salvando…" : "Marcar no calendário"}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="rh-inline-form">
                <h3>Detalhes do evento</h3>
                <div className={`rh-form-row ${newEvent.event_type === "ferias" ? "rh-form-row--vacation" : ""}`}>
                  <label>
                    Tipo
                    <RhSelect
                      ariaLabel="Tipo do evento"
                      value={newEvent.event_type}
                      options={Object.entries(EVENT_TYPE_LABEL).map(([key, label]) => ({
                        value: key,
                        label,
                      }))}
                      onChange={handleEventTypeChange}
                    />
                  </label>
                  {newEvent.event_type === "ferias" ? (
                    <>
                      <label className={vacationDateField === "start" ? "rh-date-field--active" : ""}>
                        Início
                        <input
                          type="date"
                          value={newEvent.start_date}
                          onFocus={() => setVacationDateField("start")}
                          onChange={(e) => handleVacationStartChange(e.target.value)}
                        />
                      </label>
                      <label className={vacationDateField === "end" ? "rh-date-field--active" : ""}>
                        Fim
                        <input
                          type="date"
                          value={newEvent.end_date}
                          min={newEvent.start_date || undefined}
                          onFocus={() => setVacationDateField("end")}
                          onChange={(e) => handleVacationEndChange(e.target.value)}
                        />
                      </label>
                    </>
                  ) : (
                    <label>
                      Data
                      <input
                        type="date"
                        value={newEvent.start_date}
                        onChange={(e) => {
                          const iso = e.target.value;
                          setNewEvent((s) => ({ ...s, start_date: iso, end_date: iso }));
                        }}
                        onBlur={(e) => {
                          if (e.target.value) syncCalendarToDate(e.target.value);
                        }}
                      />
                    </label>
                  )}
                </div>
                {newEvent.event_type === "ferias" && newEvent.start_date && newEvent.end_date && newEvent.end_date >= newEvent.start_date && (
                  <p className="rh-vacation-period-hint">
                    Período: {parseIsoDate(newEvent.start_date).toLocaleDateString("pt-BR")} até{" "}
                    {parseIsoDate(newEvent.end_date).toLocaleDateString("pt-BR")}
                  </p>
                )}
                {newEvent.event_type === "ferias" && (
                  <p className="rh-vacation-field-hint">
                    Campo ativo no calendário: <strong>{vacationDateField === "start" ? "Início" : "Fim"}</strong>
                  </p>
                )}
                <div className="rh-color-field">
                  <span className="rh-color-field-label">Cor do evento</span>
                  <div className="rh-color-picker">
                    {EVENT_COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.hex}
                        type="button"
                        className={`rh-color-swatch ${newEvent.color === preset.hex ? "active" : ""}`}
                        style={{ backgroundColor: preset.hex }}
                        title={preset.label}
                        aria-label={preset.label}
                        onClick={() => setNewEvent((s) => ({ ...s, color: preset.hex }))}
                      />
                    ))}
                    <label className="rh-color-custom" title="Cor personalizada">
                      <input
                        type="color"
                        value={newEvent.color}
                        onChange={(e) => setNewEvent((s) => ({ ...s, color: e.target.value }))}
                        aria-label="Escolher cor personalizada"
                      />
                      <span className="rh-color-custom-badge" style={{ backgroundColor: newEvent.color }} />
                    </label>
                  </div>
                </div>
                <label>
                  Descrição
                  <input
                    type="text"
                    value={newEvent.description}
                    onChange={(e) => setNewEvent((s) => ({ ...s, description: e.target.value }))}
                    placeholder="Detalhes opcionais"
                  />
                </label>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    busy ||
                    !newEvent.start_date ||
                    (newEvent.event_type === "ferias" && !newEvent.end_date)
                  }
                  onClick={() => submitEvent()}
                >
                  {busy ? "Salvando…" : "Salvar com detalhes"}
                </button>
              </div>
            </section>
          )}

          {rhView === "colaboradores" && (
            <section className="panel rh-panel">
              <div className="rh-calendar-head">
                <div>
                  <h2>Colaboradores</h2>
                  <p className="subtitle">
                    {filteredEmployees.length} de {employees.length} cadastro(s) · salários base e saldo de férias
                  </p>
                </div>
                <div className="rh-employees-filter">
                  <label>
                    Filtrar por cargo
                    <RhSelect
                      ariaLabel="Filtrar colaboradores por cargo"
                      value={jobTitleFilter}
                      options={[
                        { value: "", label: "Todos os cargos" },
                        ...jobTitleOptions.map((title) => ({ value: title, label: title })),
                      ]}
                      onChange={setJobTitleFilter}
                    />
                  </label>
                </div>
              </div>
              <div className="table-wrapper rh-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Departamento</th>
                      <th>Cargo</th>
                      <th>Admissão</th>
                      <th className="rh-table-num-col">Salário base</th>
                      <th className="rh-table-num-col">Férias (dias)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((emp) => (
                      <tr key={emp.id}>
                        <td>
                          <strong>{emp.full_name}</strong>
                          <div className="muted">{emp.email}</div>
                        </td>
                        <td>{emp.department || "—"}</td>
                        <td>{emp.job_title || "—"}</td>
                        <td>
                          {emp.admission_date
                            ? parseIsoDate(emp.admission_date).toLocaleDateString("pt-BR")
                            : "—"}
                        </td>
                        <td className="rh-table-num-col">{formatBrl(emp.salary_base)}</td>
                        <td className="rh-table-num-col">{emp.vacation_balance_days}</td>
                        <td>
                          <span
                            className={`rh-status rh-status--${emp.status === "active" ? "approved" : "rejected"}`}
                          >
                            {EMPLOYEE_STATUS_LABEL[emp.status] ?? emp.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredEmployees.length === 0 && (
                      <tr>
                        <td colSpan={7} className="muted">
                          Nenhum colaborador encontrado para este cargo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="rh-table-hint">Deslize para ver todas as colunas →</p>
            </section>
          )}

          {rhView === "admissao" && (
            <section className="panel rh-panel rh-admission-panel">
              <h2>Admissão de colaborador</h2>
              <p className="subtitle">Cadastre um novo colaborador no sistema de RH</p>

              {admissionSuccess && <p className="rh-calendar-success">{admissionSuccess}</p>}

              <div className="rh-admission-form">
                <div className="rh-form-row rh-form-row--admission">
                  <label>
                    Nome completo
                    <input
                      type="text"
                      value={admissionForm.full_name}
                      onChange={(e) => setAdmissionForm((s) => ({ ...s, full_name: e.target.value }))}
                      placeholder="Ex.: Ana Paula Mendes"
                    />
                  </label>
                  <label>
                    E-mail
                    <input
                      type="email"
                      value={admissionForm.email}
                      onChange={(e) => setAdmissionForm((s) => ({ ...s, email: e.target.value }))}
                      placeholder="nome@empresa.com"
                    />
                  </label>
                  <label>
                    Data de admissão
                    <input
                      type="date"
                      value={admissionForm.admission_date}
                      onChange={(e) => setAdmissionForm((s) => ({ ...s, admission_date: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="rh-form-row rh-form-row--admission">
                  <label>
                    Departamento
                    <input
                      type="text"
                      value={admissionForm.department}
                      onChange={(e) => setAdmissionForm((s) => ({ ...s, department: e.target.value }))}
                      placeholder="Ex.: Financeiro"
                    />
                  </label>
                  <label>
                    Cargo
                    <input
                      type="text"
                      value={admissionForm.job_title}
                      onChange={(e) => setAdmissionForm((s) => ({ ...s, job_title: e.target.value }))}
                      placeholder="Ex.: Analista de RH"
                    />
                  </label>
                  <label>
                    Salário base
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={admissionForm.salary_base}
                      onChange={(e) => setAdmissionForm((s) => ({ ...s, salary_base: e.target.value }))}
                      placeholder="0,00"
                    />
                  </label>
                </div>
                <div className="rh-form-row rh-form-row--admission">
                  <label>
                    Saldo de férias (dias)
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={admissionForm.vacation_balance_days}
                      onChange={(e) => setAdmissionForm((s) => ({ ...s, vacation_balance_days: e.target.value }))}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !admissionForm.full_name.trim()}
                  onClick={() => submitAdmission().catch(() => null)}
                >
                  {busy ? "Salvando…" : "Registrar admissão"}
                </button>
              </div>

              <div className="rh-admission-recent">
                <h3>Admissões recentes</h3>
                {recentAdmissions.length === 0 ? (
                  <p className="subtitle">Nenhuma admissão registrada ainda.</p>
                ) : (
                  <ul className="rh-event-list">
                    {recentAdmissions.map((emp) => (
                      <li key={emp.id} className="rh-event-list-item">
                        <span className="rh-status rh-status--approved">Admitido</span>
                        <div>
                          <strong>{emp.full_name}</strong>
                          <span className="muted">
                            {emp.department || "Sem departamento"} ·{" "}
                            {parseIsoDate(emp.admission_date).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {rhView === "demissao" && (
            <section className="panel rh-panel rh-dismissal-panel">
              <h2>Demissão de colaborador</h2>
              <p className="subtitle">Registre o desligamento de colaboradores ativos</p>

              {dismissalSuccess && <p className="rh-calendar-success">{dismissalSuccess}</p>}

              <div className="rh-dismissal-form">
                <label className="rh-employee-search-field">
                  Buscar colaborador
                  <input
                    type="search"
                    className="rh-employee-search"
                    value={dismissalEmployeeSearch}
                    onChange={(e) => {
                      setDismissConfirmOpen(false);
                      setDismissalEmployeeSearch(e.target.value);
                    }}
                    placeholder="Nome, cargo, departamento ou e-mail..."
                  />
                </label>
                <div className="rh-form-row rh-form-row--admission">
                  <label>
                    Colaborador
                    <RhSelect
                      ariaLabel="Selecionar colaborador para demissão"
                      value={dismissalForm.employee_id}
                      options={[
                        {
                          value: "",
                          label:
                            filteredDismissEmployees.length === 0
                              ? "Nenhum colaborador encontrado"
                              : "Selecione o colaborador",
                        },
                        ...filteredDismissEmployees.map((emp) => ({
                          value: String(emp.id),
                          label: `${emp.full_name} · ${emp.job_title || "Sem cargo"}`,
                        })),
                      ]}
                      onChange={(value) => {
                        setDismissConfirmOpen(false);
                        setDismissalForm((state) => ({ ...state, employee_id: value }));
                      }}
                    />
                  </label>
                  <label>
                    Data da demissão
                    <input
                      type="date"
                      value={dismissalForm.termination_date}
                      onChange={(e) =>
                        setDismissalForm((state) => ({ ...state, termination_date: e.target.value }))
                      }
                    />
                  </label>
                </div>
                {dismissalEmployeeSearch.trim() && (
                  <p className="rh-employee-search-hint">
                    {filteredDismissEmployees.length} colaborador(es) encontrado(s)
                  </p>
                )}
                <label>
                  Motivo / observações
                  <input
                    type="text"
                    value={dismissalForm.notes}
                    onChange={(e) => setDismissalForm((state) => ({ ...state, notes: e.target.value }))}
                    placeholder="Ex.: Pedido de demissão, encerramento de contrato..."
                  />
                </label>

                {!dismissConfirmOpen ? (
                  <button
                    type="button"
                    className="rh-calendar-delete-btn rh-dismissal-submit-btn"
                    disabled={busy || !dismissalForm.employee_id}
                    onClick={() => setDismissConfirmOpen(true)}
                  >
                    Registrar demissão
                  </button>
                ) : (
                  <div className="rh-calendar-inline-confirm rh-dismissal-inline-confirm">
                    <p className="rh-calendar-inline-confirm-text">
                      Confirmar desligamento de <strong>{selectedDismissEmployee?.full_name}</strong> (
                      {selectedDismissEmployee?.job_title || "Sem cargo"}) em{" "}
                      {parseIsoDate(dismissalForm.termination_date).toLocaleDateString("pt-BR")}?
                    </p>
                    <div className="rh-calendar-inline-actions">
                      <button
                        type="button"
                        className="btn-secondary rh-calendar-inline-btn"
                        disabled={busy}
                        onClick={() => setDismissConfirmOpen(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="rh-calendar-delete-btn"
                        disabled={busy}
                        onClick={() => submitDismissal().catch(() => null)}
                      >
                        {busy ? "Salvando…" : "Sim, desligar"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rh-admission-recent">
                <h3>Colaboradores desligados</h3>
                {inactiveEmployees.length === 0 ? (
                  <p className="subtitle">Nenhum colaborador desligado registrado.</p>
                ) : (
                  <ul className="rh-event-list">
                    {inactiveEmployees.map((emp) => (
                      <li key={emp.id} className="rh-event-list-item">
                        <span className="rh-status rh-status--rejected">Desligado</span>
                        <div>
                          <strong>{emp.full_name}</strong>
                          <span className="muted">
                            {emp.job_title || "Sem cargo"} · {emp.department || "Sem departamento"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {rhView === "ferias" && (
            <section className="panel rh-panel">
              <h2>Controle de férias</h2>
              <p className="subtitle">Solicitações, aprovações e histórico</p>
              <div className="table-wrapper rh-table-wrap rh-table-wrap--vacations">
                <table>
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>Período</th>
                      <th>Dias</th>
                      <th>Status</th>
                      <th>Observações</th>
                      <th className="rh-table-actions-col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vacations.map((vac) => (
                      <tr key={vac.id}>
                        <td>{vac.employee_name}</td>
                        <td>
                          {parseIsoDate(vac.start_date).toLocaleDateString("pt-BR")} —{" "}
                          {parseIsoDate(vac.end_date).toLocaleDateString("pt-BR")}
                        </td>
                        <td>{vac.days}</td>
                        <td>
                          <span className={`rh-status rh-status--${vac.status}`}>
                            {VACATION_STATUS_LABEL[vac.status] ?? vac.status}
                          </span>
                        </td>
                        <td className="muted">{vac.notes || "—"}</td>
                        <td className="rh-actions">
                          {vac.status === "pending" && (
                            <>
                              <button
                                type="button"
                                className="btn-secondary"
                                disabled={busy}
                                onClick={() => updateVacationStatus(vac.id, "approved")}
                              >
                                Aprovar
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                disabled={busy}
                                onClick={() => updateVacationStatus(vac.id, "rejected")}
                              >
                                Recusar
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="rh-table-hint">Deslize para ver todas as colunas →</p>
            </section>
          )}

          {rhView === "folha" && (
            <section className="panel rh-panel">
              <div className="rh-calendar-head">
                <div>
                  <h2>Folha salarial</h2>
                  <p className="subtitle">Controle de proventos, descontos e pagamentos</p>
                </div>
                <label className="rh-month-filter">
                  Mês de referência
                  <input
                    type="month"
                    value={payrollMonth}
                    onChange={(e) => setPayrollMonth(e.target.value)}
                  />
                </label>
              </div>
              <div className="table-wrapper rh-table-wrap rh-table-wrap--payroll">
                <table>
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th className="rh-table-num-col">Bruto</th>
                      <th className="rh-table-num-col">Descontos</th>
                      <th className="rh-table-num-col">Líquido</th>
                      <th>Status</th>
                      <th className="rh-table-actions-col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payroll.map((row) => (
                      <tr key={row.id}>
                        <td>{row.employee_name}</td>
                        <td className="rh-table-num-col">{formatBrl(row.gross_salary)}</td>
                        <td className="rh-table-num-col">{formatBrl(row.deductions)}</td>
                        <td className="rh-table-num-col">{formatBrl(row.net_salary)}</td>
                        <td>
                          <span className={`rh-status rh-status--${row.status === "paid" ? "approved" : "pending"}`}>
                            {PAYROLL_STATUS_LABEL[row.status] ?? row.status}
                          </span>
                        </td>
                        <td className="rh-actions">
                          {row.status === "pending" && (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => updatePayrollStatus(row.id, "paid")}
                            >
                              Marcar paga
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {payroll.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted">
                          Nenhum registro para {payrollMonth}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="rh-table-hint">Deslize para ver todas as colunas →</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
