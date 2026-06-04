"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { KivoAssistant } from "../components/KivoAssistant";
import { KivoRobot } from "../components/KivoRobot";
import { OperacoesPanel } from "../components/OperacoesPanel";
import { RhPanel, RH_VIEW_LABELS, type RhView } from "../components/RhPanel";

type AutomationInfo = {
  key: string;
  name: string;
  description: string;
};

type BankKey = "bb" | "itau_sigra";

type FinanceAccount = {
  id: number;
  bank: BankKey;
  name: string;
  slug: string;
  sort_order: number;
  is_active: number;
};

type Run = {
  id: number;
  automation_key: string;
  account_id?: number | null;
  account_name?: string | null;
  status: string;
  triggered_by: string;
  parameters_json: string;
  output_path: string;
  logs: string;
  created_at: string;
  updated_at: string;
};

type RunMetric = {
  total_extrato: number;
  total_conciliacao_rows: number;
  total_extratos_conciliados: number;
  total_pendentes_status: number;
  status_breakdown_json: string;
};

type MatchRow = {
  extrato_id: string;
  data_extrato: string;
  valor_extrato: number;
  comprovante_id: string;
  data_comprovante: string;
  valor_comprovante: number;
  ref_sigra: string;
  categoria: string;
  cliente: string;
  origem: string;
};

type StatusRow = {
  sheet_name: string;
  extrato_id: string;
  aba_extrato?: string;
  data: string;
  valor_extrato: number;
  saldo: number;
  favorecido_descricao: string;
  status: string;
  qtd_comprovantes: number;
  valor_total_conciliado: number;
  diferenca: number;
  ref_sigra: string;
  cliente: string;
  observacao: string;
};

type RunDataset = {
  metric: RunMetric | null;
  matches: MatchRow[];
  statuses: StatusRow[];
};

type DocumentSlot = {
  key: "extrato" | "comprovantes" | "numerario";
  title: string;
  hint: string;
  required: boolean;
  allowMultiple: boolean;
};

type SectorKey = "financeiro" | "pedro" | "rh" | "operacoes";
type PlatformView = "inicio" | "configuracoes" | SectorKey;
type OperationsView = "importacao" | "exportacao";
type AuthUser = {
  id: number;
  username: string;
  sector: string;
  role: string;
};

type PendingUser = {
  id: number;
  username: string;
  requested_sector: string;
  created_at: string;
};

const runtimeHost = typeof window !== "undefined" && window.location?.hostname ? window.location.hostname : "localhost";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || `http://${runtimeHost}:8000`;
const FAST_POLL_MS = 700;
const DEFAULT_POLL_MS = 2000;
const TRIGGER_TIMEOUT_MS = 120000;

const SLOT_CONFIG: Record<string, DocumentSlot[]> = {
  bb: [
    {
      key: "extrato",
      title: "Extrato BB",
      hint: "Arquivo de extrato do Banco do Brasil.",
      required: true,
      allowMultiple: false,
    },
    {
      key: "comprovantes",
      title: "Comprovantes / PGTO",
      hint: "Pode anexar um ou mais arquivos de pagamento.",
      required: true,
      allowMultiple: true,
    },
  ],
  itau_sigra: [
    {
      key: "extrato",
      title: "Extrato Itaú",
      hint: "Arquivo de extrato do Itaú para a rodada.",
      required: true,
      allowMultiple: false,
    },
    {
      key: "comprovantes",
      title: "Comprovantes / PGTO",
      hint: "Pode anexar vários comprovantes.",
      required: true,
      allowMultiple: true,
    },
    {
      key: "numerario",
      title: "Numerário (opcional)",
      hint: "Use quando houver recebimentos a conciliar.",
      required: false,
      allowMultiple: true,
    },
  ],
};

const SECTOR_MENU: { key: SectorKey; label: string; subtitle: string }[] = [
  { key: "financeiro", label: "Financeiro", subtitle: "Conciliações e caixa" },
  { key: "pedro", label: "Pedro", subtitle: "F/ Alinhamento" },
  { key: "rh", label: "RH", subtitle: "Pessoal e folha" },
  { key: "operacoes", label: "Operações", subtitle: "Rotinas internas" },
];

function platformPageTitle(view: PlatformView): string {
  if (view === "inicio") return "Início";
  if (view === "configuracoes") return "Configurações";
  if (view === "financeiro") return "Setor Financeiro";
  if (view === "pedro") return "Setor Pedro";
  if (view === "rh") return "RH";
  return "Setor de Operações";
}

function platformPageSubtitle(view: PlatformView): string {
  if (view === "inicio") return "Visão geral da plataforma KIVO";
  if (view === "configuracoes") return "Conta, segurança e preferências do ambiente";
  return SECTOR_MENU.find((s) => s.key === view)?.subtitle ?? "";
}

const ANALYSIS_VIEW_LABELS: Record<"planilha" | "matches" | "log", string> = {
  planilha: "Status consolidado",
  matches: "Conciliações",
  log: "Log técnico",
};

function bankLabel(bank: BankKey): string {
  return bank === "bb" ? "Banco do Brasil" : "Itaú / SIGRA";
}

type PageHeading = { title: string; subtitle: string; tag: string };

function resolvePlatformHeading(
  activeView: PlatformView,
  analysisView: "planilha" | "matches" | "log",
  bankView: BankKey,
  operationsView: OperationsView,
  rhView: RhView,
): PageHeading {
  if (activeView === "inicio") {
    return { title: "Início", subtitle: platformPageSubtitle("inicio"), tag: "Plataforma" };
  }
  if (activeView === "configuracoes") {
    return { title: "Configurações", subtitle: platformPageSubtitle("configuracoes"), tag: "Sistema" };
  }
  if (activeView === "financeiro") {
    return {
      title: "Financeiro",
      subtitle: `${ANALYSIS_VIEW_LABELS[analysisView]} · ${bankLabel(bankView)}`,
      tag: "Módulo ativo",
    };
  }
  if (activeView === "operacoes") {
    const flow = operationsView === "importacao" ? "Importação" : "Exportação";
    return { title: "Operações", subtitle: `Comex · ${flow}`, tag: "Módulo ativo" };
  }
  if (activeView === "rh") {
    return {
      title: "Recursos Humanos",
      subtitle: RH_VIEW_LABELS[rhView],
      tag: "Módulo ativo",
    };
  }
  const sector = SECTOR_MENU.find((s) => s.key === activeView);
  return {
    title: sector?.label ?? platformPageTitle(activeView),
    subtitle: sector?.subtitle ?? "",
    tag: "Em breve",
  };
}

function resolveDocumentTitle(
  activeView: PlatformView,
  analysisView: "planilha" | "matches" | "log",
  bankView: BankKey,
  operationsView: OperationsView,
  rhView: RhView,
): string {
  if (activeView === "financeiro") {
    return `${ANALYSIS_VIEW_LABELS[analysisView]} — Financeiro — KIVO`;
  }
  if (activeView === "operacoes") {
    const flow = operationsView === "importacao" ? "Importação" : "Exportação";
    return `${flow} — Operações — KIVO`;
  }
  if (activeView === "rh") {
    return `${RH_VIEW_LABELS[rhView]} — RH — KIVO`;
  }
  return `${platformPageTitle(activeView)} — KIVO`;
}

function resolveGuestDocumentTitle(
  guestView: "landing" | "auth" | "forgot" | "reset",
  authMode: "login" | "register",
): string {
  if (guestView === "auth") {
    return authMode === "register" ? "Criar conta — KIVO" : "Entrar — KIVO";
  }
  if (guestView === "forgot") return "Recuperar acesso — KIVO";
  if (guestView === "reset") return "Nova senha — KIVO";
  return "KIVO — ERP operacional";
}

function sectorLabel(key: string): string {
  return SECTOR_MENU.find((s) => s.key === key)?.label ?? key;
}

function roleLabel(role: string): string {
  if (role === "admin") return "Administrador";
  if (role === "operator") return "Operador";
  return role;
}

function parseApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (first && typeof first === "object" && "msg" in first) {
      return String((first as { msg: string }).msg);
    }
  }
  return fallback;
}

function SettingsRailIcon() {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6 };
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </svg>
  );
}

function HomeRailIcon() {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6 };
  return (
    <svg {...common}>
      <path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 01-1.5 1.5H5.5A1.5 1.5 0 014 19v-8.5z" />
      <path d="M9.5 20.5V13h5v7.5" />
    </svg>
  );
}

function SectorRailIcon({ sector }: { sector: SectorKey }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6 };
  if (sector === "financeiro") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
        <circle cx="16" cy="15" r="1.25" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (sector === "pedro") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
      </svg>
    );
  }
  if (sector === "rh") {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="2.5" />
        <circle cx="16" cy="10" r="2" />
        <path d="M4 19c0-2.5 2.2-4.5 5-4.5M15 19c0-2 1.6-3.5 3.5-3.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </svg>
  );
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("completed")) return "status-pill status-completed";
  if (s.includes("running")) return "status-pill status-running";
  if (s.includes("failed")) return "status-pill status-failed";
  return "status-pill status-queued";
}

const EXTRATO_TAB_MONTH_ORDER = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

function normalizeExtratoTabKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function monthKeyFromDate(dateValue: string): string {
  const raw = (dateValue || "").trim();
  let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}`;
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${d.getFullYear()}-${mm}`;
  }
  return "sem-data";
}

function extratoTabOrder(key: string): number {
  if (key === "sem-aba" || key === "sem-data") return 1000;
  const normalized = normalizeExtratoTabKey(key);
  for (let i = 0; i < EXTRATO_TAB_MONTH_ORDER.length; i++) {
    if (normalized.startsWith(EXTRATO_TAB_MONTH_ORDER[i])) return i;
  }
  return 500;
}

/** Chave da aba do extrato (MAIO, JANEIRO26…); fallback por data em execuções antigas. */
function extratoTabKeyFromRow(row: StatusRow): string {
  const aba = (row.aba_extrato || "").trim();
  if (aba) return normalizeExtratoTabKey(aba);
  const fromDate = monthKeyFromDate(row.data);
  return fromDate === "sem-data" ? "sem-aba" : fromDate;
}

function extratoTabLabelFromKey(key: string): string {
  if (key === "sem-aba" || key === "sem-data") return "Sem aba";
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [year, month] = key.split("-");
    const mm = Number(month);
    const yy = year?.slice(-2) || "";
    const labels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return `${labels[(mm || 1) - 1] || "Mês"} ${yy}`;
  }
  const normalized = normalizeExtratoTabKey(key);
  const monthLabels: Record<string, string> = {
    janeiro: "Janeiro",
    fevereiro: "Fevereiro",
    marco: "Março",
    abril: "Abril",
    maio: "Maio",
    junho: "Junho",
    julho: "Julho",
    agosto: "Agosto",
    setembro: "Setembro",
    outubro: "Outubro",
    novembro: "Novembro",
    dezembro: "Dezembro",
  };
  for (const month of EXTRATO_TAB_MONTH_ORDER) {
    if (!normalized.startsWith(month)) continue;
    const suffix = normalized.slice(month.length);
    const yearMatch = suffix.match(/^(\d{2,4})$/);
    const base = monthLabels[month] || month;
    if (yearMatch) {
      const yy = yearMatch[1].length === 4 ? yearMatch[1].slice(-2) : yearMatch[1];
      return `${base} ${yy}`;
    }
    return base;
  }
  return key;
}

/** Linhas de saldo de conta (não são pagamentos) — ocultas só nos KPIs, não na tabela. */
function isExtratoBalanceSnapshot(row: StatusRow): boolean {
  const normalized = (row.favorecido_descricao || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  return normalized === "S A L D O" || normalized === "SALDO" || normalized.includes("SALDO ANTERIOR");
}

function parseBrDateToTs(dateValue: string): number {
  const raw = (dateValue || "").trim();
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function AuthPasswordField({
  id,
  placeholder,
  value,
  visible,
  onToggleVisible,
  autoComplete,
  onChange,
  onEnter,
}: {
  id: string;
  placeholder: string;
  value: string;
  visible: boolean;
  onToggleVisible: () => void;
  autoComplete: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
}) {
  return (
    <div className="auth-screen-password-wrap">
      <input
        id={id}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
      />
      <button
        type="button"
        className="auth-screen-password-toggle"
        onClick={onToggleVisible}
        title={visible ? "Pedir pro robô não olhar" : "Deixar o robô espiar a senha"}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={visible}
      >
        <KivoRobot mood={visible ? "peek" : "shy"} />
      </button>
    </div>
  );
}

function FilterSearchInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="filter-search">
      <Image
        src="/brand/kivo-logo-redonda.png"
        alt=""
        width={28}
        height={28}
        className="filter-search-logo"
        aria-hidden
      />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function HomePage() {
  const [authReady, setAuthReady] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [guestView, setGuestView] = useState<"landing" | "auth" | "forgot" | "reset">("landing");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showNewPasswordConfirm, setShowNewPasswordConfirm] = useState(false);
  const [changeCurrentPassword, setChangeCurrentPassword] = useState("");
  const [changeNewPassword, setChangeNewPassword] = useState("");
  const [changeNewPasswordConfirm, setChangeNewPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminError, setAdminError] = useState("");
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [adminLookupUsername, setAdminLookupUsername] = useState("");
  const [adminResetLink, setAdminResetLink] = useState("");
  const [adminResetLinkFor, setAdminResetLinkFor] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showAuthPasswordConfirm, setShowAuthPasswordConfirm] = useState(false);
  const [registerSector, setRegisterSector] = useState<SectorKey>("financeiro");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [pendingUsersLoading, setPendingUsersLoading] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);
  const [approvalSectorByUser, setApprovalSectorByUser] = useState<Record<number, SectorKey>>({});
  const [hideLandingTopbar, setHideLandingTopbar] = useState(false);
  const [activeView, setActiveView] = useState<PlatformView>("inicio");
  const [operationsView, setOperationsView] = useState<OperationsView>("importacao");
  const [rhView, setRhView] = useState<RhView>("visao");
  const [automations, setAutomations] = useState<AutomationInfo[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [bankView, setBankView] = useState<BankKey>("bb");
  const [financeAccounts, setFinanceAccounts] = useState<FinanceAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [newAccountBank, setNewAccountBank] = useState<BankKey>("bb");
  const [newAccountName, setNewAccountName] = useState("");
  const [accountsBusy, setAccountsBusy] = useState(false);
  const [accountsError, setAccountsError] = useState("");
  const [accountsMessage, setAccountsMessage] = useState("");
  const [analysisView, setAnalysisView] = useState<"planilha" | "matches" | "log">("planilha");
  const [matchSort, setMatchSort] = useState<{ field: "data" | "valor"; direction: "desc" | "asc" }>({
    field: "data",
    direction: "desc",
  });
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>("todos");
  const [filterField, setFilterField] = useState<
    "geral" | "data" | "id_extrato" | "descricao" | "ref_sigra" | "status"
  >("geral");
  const [filterValue, setFilterValue] = useState<string>("");
  const [statusSort, setStatusSort] = useState<{ field: "data" | "valor"; direction: "desc" | "asc" }>({
    field: "data",
    direction: "desc",
  });
  const [liveRun, setLiveRun] = useState<Run | null>(null);
  const [filesBySlot, setFilesBySlot] = useState<Record<string, File[]>>({
    extrato: [],
    comprovantes: [],
    numerario: [],
  });
  const [dataset, setDataset] = useState<RunDataset | null>(null);
  const [datasetError, setDatasetError] = useState("");
  const [loading, setLoading] = useState(false);
  const [runsRefreshing, setRunsRefreshing] = useState(false);
  const [error, setError] = useState("");

  const accountsForBank = useMemo(
    () =>
      financeAccounts
        .filter((account) => account.bank === bankView && Number(account.is_active) === 1)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [financeAccounts, bankView],
  );

  const inactiveAccountsForBank = useMemo(
    () => financeAccounts.filter((account) => account.bank === bankView && Number(account.is_active) !== 1),
    [financeAccounts, bankView],
  );

  const selectedAccount = useMemo(
    () => accountsForBank.find((account) => account.id === selectedAccountId) ?? null,
    [accountsForBank, selectedAccountId],
  );

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (run.automation_key !== bankView) return false;
      if (!selectedAccountId) return true;
      return run.account_id === selectedAccountId;
    });
  }, [runs, bankView, selectedAccountId]);

  const runCountByAccountId = useMemo(() => {
    const map: Record<number, number> = {};
    runs.forEach((run) => {
      if (run.account_id) {
        map[run.account_id] = (map[run.account_id] || 0) + 1;
      }
    });
    return map;
  }, [runs]);
  const selectedRunBase = useMemo(
    () => filteredRuns.find((r) => r.id === selectedRunId) ?? filteredRuns[0],
    [filteredRuns, selectedRunId],
  );
  const selectedRun = useMemo(
    () =>
      liveRun && selectedRunBase && liveRun.id === selectedRunBase.id
        ? { ...selectedRunBase, ...liveRun }
        : selectedRunBase,
    [selectedRunBase, liveRun],
  );
  const isSelectedRunActive = useMemo(
    () => ["running", "queued"].includes((selectedRun?.status || "").toLowerCase()),
    [selectedRun?.status],
  );
  const totals = useMemo(() => {
    const completed = runs.filter((r) => r.status === "completed").length;
    const running = runs.filter((r) => r.status === "running").length;
    const failed = runs.filter((r) => r.status === "failed").length;
    return {
      total: runs.length,
      completed,
      running,
      failed,
    };
  }, [runs]);
  const runCountsByBank = useMemo(
    () => ({
      bb: runs.filter((r) => r.automation_key === "bb").length,
      itau_sigra: runs.filter((r) => r.automation_key === "itau_sigra").length,
    }),
    [runs],
  );
  const slotConfig = useMemo(() => SLOT_CONFIG[bankView] ?? [], [bankView]);
  const flattenedFiles = useMemo(
    () => slotConfig.flatMap((slot) => (filesBySlot[slot.key] ?? []).map((file) => ({ slot: slot.key, file }))),
    [filesBySlot, slotConfig],
  );
  const hasMissingRequiredDocs = useMemo(
    () => slotConfig.some((slot) => slot.required && (filesBySlot[slot.key]?.length ?? 0) === 0),
    [filesBySlot, slotConfig],
  );
  const allStatuses = useMemo(() => dataset?.statuses ?? [], [dataset?.statuses]);
  const statusesForKpi = useMemo(
    () => allStatuses.filter((row) => !isExtratoBalanceSnapshot(row)),
    [allStatuses],
  );
  const monthTabs = useMemo(() => {
    const values = allStatuses;
    const map = new Map<string, number>();
    values.forEach((row) => {
      const key = extratoTabKeyFromRow(row);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    const keys = Array.from(map.keys()).sort((a, b) => extratoTabOrder(a) - extratoTabOrder(b));
    return [
      { key: "todos", label: "Todos", count: values.length },
      ...keys.map((key) => ({ key, label: extratoTabLabelFromKey(key), count: map.get(key) ?? 0 })),
    ];
  }, [allStatuses]);
  const filteredStatuses = useMemo(() => {
    const rows = allStatuses;
    const needle = filterValue.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesMonth =
        selectedMonthKey === "todos" || extratoTabKeyFromRow(row) === selectedMonthKey;
      if (!needle) return matchesMonth;

      const matchesByField =
        filterField === "geral"
          ? `${row.extrato_id} ${row.data} ${row.favorecido_descricao} ${row.ref_sigra} ${row.status}`
              .toLowerCase()
              .includes(needle)
          : filterField === "data"
            ? String(row.data || "").toLowerCase().includes(needle)
            : filterField === "id_extrato"
              ? String(row.extrato_id || "").toLowerCase().includes(needle)
              : filterField === "descricao"
                ? String(row.favorecido_descricao || "").toLowerCase().includes(needle)
                : filterField === "ref_sigra"
                  ? String(row.ref_sigra || "").toLowerCase().includes(needle)
                  : String(row.status || "").toLowerCase().includes(needle);

      return matchesMonth && matchesByField;
    });
  }, [filterField, filterValue, selectedMonthKey, allStatuses]);
  const sortedStatuses = useMemo(() => {
    const rows = [...filteredStatuses];
    rows.sort((a, b) => {
      const left = statusSort.field === "data" ? parseBrDateToTs(a.data) : Number(a.valor_extrato || 0);
      const right = statusSort.field === "data" ? parseBrDateToTs(b.data) : Number(b.valor_extrato || 0);
      const diff = left - right;
      if (diff === 0) return 0;
      return statusSort.direction === "asc" ? diff : -diff;
    });
    return rows;
  }, [filteredStatuses, statusSort]);
  const balanceSummary = useMemo(() => {
    const rows = statusesForKpi;
    const totalExtratos = rows.reduce((acc, row) => acc + Number(row.valor_extrato || 0), 0);
    const totalComprovantes = rows.reduce((acc, row) => acc + Number(row.valor_total_conciliado || 0), 0);
    return {
      totalExtratos,
      totalComprovantes,
      saldo: totalExtratos - totalComprovantes,
    };
  }, [statusesForKpi]);

  const allMatches = useMemo(() => dataset?.matches ?? [], [dataset?.matches]);
  const filteredMatches = useMemo(() => {
    const needle = filterValue.trim().toLowerCase();
    if (!needle) return allMatches;
    return allMatches.filter((row) => {
      if (filterField === "geral") {
        const blob = `${row.extrato_id} ${row.data_extrato} ${row.comprovante_id} ${row.data_comprovante} ${row.ref_sigra} ${row.categoria} ${row.cliente} ${row.origem}`;
        return blob.toLowerCase().includes(needle);
      }
      if (filterField === "data") {
        return `${row.data_extrato} ${row.data_comprovante}`.toLowerCase().includes(needle);
      }
      if (filterField === "id_extrato") {
        return String(row.extrato_id || "").toLowerCase().includes(needle);
      }
      if (filterField === "ref_sigra") {
        return String(row.ref_sigra || "").toLowerCase().includes(needle);
      }
      if (filterField === "descricao") {
        return `${row.categoria} ${row.cliente}`.toLowerCase().includes(needle);
      }
      return true;
    });
  }, [allMatches, filterField, filterValue]);
  const sortedMatches = useMemo(() => {
    const rows = [...filteredMatches];
    rows.sort((a, b) => {
      const left =
        matchSort.field === "data"
          ? parseBrDateToTs(a.data_extrato || a.data_comprovante)
          : Number(a.valor_extrato || 0);
      const right =
        matchSort.field === "data"
          ? parseBrDateToTs(b.data_extrato || b.data_comprovante)
          : Number(b.valor_extrato || 0);
      const diff = left - right;
      if (diff === 0) return 0;
      return matchSort.direction === "asc" ? diff : -diff;
    });
    return rows;
  }, [filteredMatches, matchSort]);

  const visibleSectors = useMemo(() => {
    if (!currentUser || currentUser.role === "admin") return SECTOR_MENU;
    return SECTOR_MENU.filter((sector) => sector.key === currentUser.sector);
  }, [currentUser]);

  async function apiFetch(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers || {});
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (res.status === 401) {
      setAuthToken(null);
      setCurrentUser(null);
      setAuthError("Sessão expirada. Faça login novamente.");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("fin_access_token");
      }
      throw new Error("Sessão expirada.");
    }
    return res;
  }

  async function loadCurrentUser() {
    const res = await apiFetch("/auth/me");
    if (!res.ok) {
      throw new Error("Falha ao validar sessão.");
    }
    const data = (await res.json()) as AuthUser;
    setCurrentUser(data);
  }

  function applyAuthSuccess(accessToken: string, user: AuthUser | null) {
    setAuthToken(accessToken);
    setCurrentUser(user);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fin_access_token", accessToken);
    }
    setLoginPassword("");
    setRegisterPasswordConfirm("");
    setAuthError("");
    setGuestView("landing");
  }

  async function handleLogin() {
    if (!loginUsername.trim() || !loginPassword.trim()) {
      setAuthError("Informe usuário e senha.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.access_token) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Falha ao autenticar."));
      }
      applyAuthSuccess(payload.access_token, payload.user || null);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Erro ao autenticar.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleRegister() {
    if (!loginUsername.trim() || !loginPassword.trim()) {
      setAuthError("Informe usuário e senha.");
      return;
    }
    if (loginUsername.trim().length < 3) {
      setAuthError("O usuário deve ter pelo menos 3 caracteres.");
      return;
    }
    if (loginPassword !== registerPasswordConfirm) {
      setAuthError("As senhas não coincidem.");
      return;
    }
    if (loginPassword.length < 6) {
      setAuthError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
          sector: registerSector,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Serviço de cadastro indisponível. Reinicie o backend (porta 8000) e tente novamente.",
          );
        }
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível criar a conta."));
      }
      setLoginPassword("");
      setRegisterPasswordConfirm("");
      setAuthMode("login");
      setAuthSuccess(
        payload?.message ||
          "Cadastro enviado! Aguarde a aprovação de um administrador para entrar.",
      );
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Erro ao cadastrar.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadPendingUsers() {
    setPendingUsersLoading(true);
    try {
      const res = await apiFetch("/auth/admin/pending-users");
      if (!res.ok) throw new Error("Não foi possível carregar solicitações pendentes.");
      const data = (await res.json()) as PendingUser[];
      setPendingUsers(data);
      setApprovalSectorByUser((prev) => {
        const next = { ...prev };
        for (const user of data) {
          if (!next[user.id]) {
            next[user.id] = (user.requested_sector as SectorKey) || "financeiro";
          }
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar aprovações.");
    } finally {
      setPendingUsersLoading(false);
    }
  }

  async function approvePendingUser(userId: number) {
    const sector = approvalSectorByUser[userId] || "financeiro";
    setPendingActionId(userId);
    try {
      const res = await apiFetch(`/auth/admin/users/${userId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível aprovar o cadastro."));
      }
      setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
      await loadPendingCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao aprovar cadastro.");
    } finally {
      setPendingActionId(null);
    }
  }

  async function rejectPendingUser(userId: number) {
    setPendingActionId(userId);
    try {
      const res = await apiFetch(`/auth/admin/users/${userId}/reject`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível recusar o cadastro."));
      }
      setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
      await loadPendingCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao recusar cadastro.");
    } finally {
      setPendingActionId(null);
    }
  }

  function openAuthScreen(mode: "login" | "register") {
    setAuthMode(mode);
    setAuthError("");
    setAuthSuccess("");
    setGuestView("auth");
  }

  function clearLocalAuth() {
    setAuthToken(null);
    setCurrentUser(null);
    setAuthError("");
    setRuns([]);
    setDataset(null);
    setActiveSessionCount(0);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("fin_access_token");
    }
  }

  async function handleLogout() {
    try {
      if (authToken) {
        await apiFetch("/auth/logout", { method: "POST" });
      }
    } catch {
      /* encerra localmente mesmo se a API falhar */
    } finally {
      clearLocalAuth();
    }
  }

  async function handleForgotPassword() {
    if (!loginUsername.trim()) {
      setAuthError("Informe seu usuário para solicitar a redefinição.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível processar a solicitação."));
      }
      let message =
        payload?.message ||
        "Se o usuário existir, um administrador pode fornecer o link de redefinição.";
      if (payload?.reset_url) {
        message = `${message} Link (ambiente de teste): ${payload.reset_url}`;
      }
      setAuthSuccess(message);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Erro ao solicitar redefinição.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleResetPassword() {
    if (!resetToken.trim() || !newPassword.trim()) {
      setAuthError("Informe o link de redefinição e a nova senha.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setAuthError("As senhas não coincidem.");
      return;
    }
    if (newPassword.length < 6) {
      setAuthError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken.trim(), new_password: newPassword }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível redefinir a senha."));
      }
      setNewPassword("");
      setNewPasswordConfirm("");
      setResetToken("");
      setAuthSuccess(payload?.message || "Senha redefinida. Faça login com a nova senha.");
      setGuestView("auth");
      setAuthMode("login");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Erro ao redefinir senha.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadActiveSessions() {
    const res = await apiFetch("/auth/sessions");
    if (!res.ok) return;
    const data = (await res.json()) as { id: number }[];
    setActiveSessionCount(data.length);
  }

  async function handleChangePassword() {
    if (!changeCurrentPassword.trim() || !changeNewPassword.trim()) {
      setPasswordError("Preencha a senha atual e a nova senha.");
      return;
    }
    if (changeNewPassword !== changeNewPasswordConfirm) {
      setPasswordError("A confirmação da nova senha não confere.");
      return;
    }
    if (changeNewPassword.length < 6) {
      setPasswordError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordMessage("");
    try {
      const res = await apiFetch("/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: changeCurrentPassword,
          new_password: changeNewPassword,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível alterar a senha."));
      }
      setChangeCurrentPassword("");
      setChangeNewPassword("");
      setChangeNewPasswordConfirm("");
      setPasswordMessage(payload?.message || "Senha alterada com sucesso.");
      await loadActiveSessions();
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Erro ao alterar senha.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleLogoutOtherSessions() {
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordMessage("");
    try {
      const res = await apiFetch("/auth/logout-all", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível encerrar outras sessões."));
      }
      setPasswordMessage(payload?.message || "Outras sessões encerradas.");
      await loadActiveSessions();
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Erro ao encerrar sessões.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function adminGenerateResetLink() {
    const username = adminLookupUsername.trim();
    if (!username) {
      setAdminError("Informe o usuário para gerar o link.");
      return;
    }
    setAdminBusy(true);
    setAdminError("");
    setAdminMessage("");
    setAdminResetLink("");
    setAdminResetLinkFor("");
    try {
      const lookupRes = await apiFetch(
        `/auth/admin/users/lookup?username=${encodeURIComponent(username)}`,
      );
      const lookupPayload = await lookupRes.json().catch(() => ({}));
      if (!lookupRes.ok) {
        throw new Error(parseApiErrorDetail(lookupPayload?.detail, "Usuário não encontrado."));
      }
      const user = lookupPayload as AuthUser;
      const linkRes = await apiFetch(`/auth/admin/users/${user.id}/password-reset-link`, {
        method: "POST",
      });
      const linkPayload = await linkRes.json().catch(() => ({}));
      if (!linkRes.ok) {
        throw new Error(parseApiErrorDetail(linkPayload?.detail, "Não foi possível gerar o link."));
      }
      setAdminResetLink(linkPayload.reset_url || "");
      setAdminResetLinkFor(linkPayload.username || user.username);
      setAdminMessage(`Link gerado para ${linkPayload.username || user.username} (válido por 1 hora).`);
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : "Erro ao gerar link.");
    } finally {
      setAdminBusy(false);
    }
  }

  function toggleStatusSort(field: "data" | "valor") {
    setStatusSort((prev) =>
      prev.field === field
        ? { field, direction: prev.direction === "desc" ? "asc" : "desc" }
        : { field, direction: "desc" },
    );
  }

  function toggleMatchSort(field: "data" | "valor") {
    setMatchSort((prev) =>
      prev.field === field
        ? { field, direction: prev.direction === "desc" ? "asc" : "desc" }
        : { field, direction: "desc" },
    );
  }

  async function loadPendingCount() {
    if (currentUser?.role !== "admin") {
      setPendingCount(0);
      return;
    }
    const res = await apiFetch("/auth/admin/pending-count");
    if (!res.ok) return;
    const data = (await res.json()) as { count?: number };
    setPendingCount(Number(data.count || 0));
  }

  async function downloadRunExcel(runId: number) {
    setDownloadBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/runs/${runId}/download`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível baixar o Excel."));
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const utfMatch = disposition.match(/filename\*=UTF-8''([^;\s]+)/i);
      const plainMatch = disposition.match(/filename="?([^";\n]+)"?/i);
      const filename = utfMatch
        ? decodeURIComponent(utfMatch[1])
        : plainMatch
          ? plainMatch[1].trim()
          : `conciliacao_run_${runId}.xlsx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao baixar Excel.");
    } finally {
      setDownloadBusy(false);
    }
  }

  async function loadAutomations() {
    const res = await apiFetch("/automations");
    if (!res.ok) throw new Error("Erro ao carregar automações.");
    const data = await res.json();
    setAutomations(data);
  }

  async function loadFinanceAccounts(options?: { includeInactive?: boolean }) {
    const query = options?.includeInactive ? "?include_inactive=true" : "";
    const res = await apiFetch(`/accounts${query}`);
    if (!res.ok) throw new Error("Erro ao carregar contas bancárias.");
    const data = (await res.json()) as FinanceAccount[];
    setFinanceAccounts(data);
  }

  async function refreshRuns() {
    setRunsRefreshing(true);
    try {
      await loadRuns();
    } finally {
      setRunsRefreshing(false);
    }
  }

  async function loadRuns() {
    const res = await apiFetch("/runs");
    if (!res.ok) throw new Error("Erro ao carregar execuções.");
    const data = (await res.json()) as Run[];
    setRuns(data);

    const visible = data.filter((run) => {
      if (run.automation_key !== bankView) return false;
      if (selectedAccountId && run.account_id !== selectedAccountId) return false;
      return true;
    });
    if (visible.length > 0) {
      setSelectedRunId((current) =>
        visible.some((run) => run.id === current) ? current : visible[0].id,
      );
    } else {
      setSelectedRunId(null);
    }
  }

  async function createFinanceAccount() {
    const name = newAccountName.trim();
    if (!name) {
      setAccountsError("Informe o nome da conta.");
      return;
    }
    setAccountsBusy(true);
    setAccountsError("");
    setAccountsMessage("");
    try {
      const res = await apiFetch("/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank: newAccountBank, name }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível criar a conta."));
      }
      setNewAccountName("");
      setAccountsMessage(`Conta "${payload.name}" criada.`);
      await loadFinanceAccounts({ includeInactive: true });
      if (payload.bank === bankView) {
        setSelectedAccountId(payload.id);
      }
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : "Erro ao criar conta.");
      await loadFinanceAccounts({ includeInactive: true }).catch(() => null);
    } finally {
      setAccountsBusy(false);
    }
  }

  async function reactivateFinanceAccount(accountId: number) {
    const account = financeAccounts.find((item) => item.id === accountId);
    if (!account) return;
    setAccountsBusy(true);
    setAccountsError("");
    setAccountsMessage("");
    try {
      const res = await apiFetch(`/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível reativar a conta."));
      }
      setAccountsMessage(`Conta "${account.name}" reativada.`);
      await loadFinanceAccounts({ includeInactive: true });
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : "Erro ao reativar conta.");
    } finally {
      setAccountsBusy(false);
    }
  }

  async function deactivateFinanceAccount(accountId: number) {
    const account = financeAccounts.find((item) => item.id === accountId);
    if (!account) return;
    const ok = window.confirm(`Desativar a conta "${account.name}"?`);
    if (!ok) return;
    setAccountsBusy(true);
    setAccountsError("");
    setAccountsMessage("");
    try {
      const res = await apiFetch(`/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível desativar a conta."));
      }
      setAccountsMessage(`Conta "${account.name}" desativada.`);
      await loadFinanceAccounts({ includeInactive: true });
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : "Erro ao desativar conta.");
    } finally {
      setAccountsBusy(false);
    }
  }

  async function loadRunLive(runId: number) {
    const res = await apiFetch(`/runs/${runId}`);
    if (!res.ok) return;
    const data = (await res.json()) as Run;
    setLiveRun(data);
  }

  async function loadDataset(runId: number, runStatus?: string) {
    try {
      setDatasetError("");
      const res = await apiFetch(`/runs/${runId}/dataset`);
      if (!res.ok) {
        const runningOrQueued = ["running", "queued"].includes((runStatus || "").toLowerCase());
        if (runningOrQueued) {
          setDataset(null);
          return;
        }
        throw new Error("Dados da conciliação ainda não disponíveis para esta execução.");
      }
      const data = await res.json();
      setDataset(data);
    } catch (e) {
      setDataset(null);
      setDatasetError(e instanceof Error ? e.message : "Erro ao carregar dataset.");
    }
  }

  async function triggerRun() {
    if (!selectedAccountId) {
      setError("Selecione a conta bancária da rodada.");
      return;
    }
    if (flattenedFiles.length === 0) {
      setError("Adicione os documentos da rodada antes de executar.");
      return;
    }
    if (hasMissingRequiredDocs) {
      setError("Existem documentos obrigatórios que ainda não foram anexados.");
      return;
    }
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
    try {
      const formData = new FormData();
      formData.append("automation_key", bankView);
      formData.append("account_id", String(selectedAccountId));
      formData.append("triggered_by", currentUser?.username || "financeiro");
      formData.append("parameters_json", "{}");
      flattenedFiles.forEach((entry) => {
        formData.append("files", entry.file);
        formData.append("slot_keys", entry.slot);
      });

      const res = await apiFetch("/runs/upload", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.detail || "Falha ao disparar execução.");
      }
      const created = await res.json();
      if (created?.automation_key === "bb" || created?.automation_key === "itau_sigra") {
        setBankView(created.automation_key);
      }
      setRuns((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
      setSelectedRunId(created.id);
      setLiveRun(created);
      setAnalysisView("planilha");
      loadDataset(created.id, created.status).catch(() => null);
      setFilesBySlot({ extrato: [], comprovantes: [], numerario: [] });
      await loadRuns();
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setError("O disparo demorou mais do que o esperado. Tente novamente em instantes.");
      } else {
        setError(e instanceof Error ? e.message : "Erro inesperado.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  function addFiles(slotKey: DocumentSlot["key"], selectedFiles: FileList | null, allowMultiple: boolean) {
    if (!selectedFiles || selectedFiles.length === 0) return;
    const incoming = Array.from(selectedFiles);
    setFilesBySlot((prev) => {
      const current = prev[slotKey] ?? [];
      const merged = allowMultiple ? [...current, ...incoming] : incoming.slice(0, 1);
      const deduped = merged.filter(
        (file, index, arr) =>
          arr.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size) === index,
      );
      return { ...prev, [slotKey]: deduped };
    });
  }

  function removeFile(slotKey: DocumentSlot["key"], index: number) {
    setFilesBySlot((prev) => ({
      ...prev,
      [slotKey]: (prev[slotKey] ?? []).filter((_, idx) => idx !== index),
    }));
  }

  function clearSlot(slotKey: DocumentSlot["key"]) {
    setFilesBySlot((prev) => ({ ...prev, [slotKey]: [] }));
  }

  async function clearAllRuns() {
    const accountLabel = selectedAccount?.name || "esta conta";
    const bankLabel = bankView === "bb" ? "Banco do Brasil" : "Itaú / SIGRA";
    const ok = window.confirm(
      `Apagar o histórico de execuções de ${accountLabel} (${bankLabel})?`,
    );
    if (!ok) return;
    if (filteredRuns.length === 0) {
      setError(`Não há execuções para ${accountLabel}.`);
      return;
    }
    if (!selectedAccountId) {
      setError("Selecione uma conta.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        automation_key: bankView,
        account_id: String(selectedAccountId),
      });
      const res = await apiFetch(`/runs?${params.toString()}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(parseApiErrorDetail(payload?.detail, `Falha ao limpar histórico de ${accountLabel}.`));
      }
      setSelectedRunId(null);
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = window.localStorage.getItem("fin_access_token");
      if (token) setAuthToken(token);
      const params = new URLSearchParams(window.location.search);
      const resetFromUrl = params.get("reset");
      if (resetFromUrl) {
        setResetToken(resetFromUrl);
        setGuestView("reset");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (!authToken || currentUser?.role !== "admin") return;
    loadPendingCount().catch(() => null);
    const timer = window.setInterval(() => {
      loadPendingCount().catch(() => null);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [authToken, currentUser?.role]);

  useEffect(() => {
    if (!authToken) return;
    loadCurrentUser().catch(() => {
      setAuthToken(null);
      setCurrentUser(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("fin_access_token");
      }
    });
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    loadAutomations().catch(() => setError("Erro ao carregar automações."));
    loadFinanceAccounts().catch(() => {
      setError("Erro ao carregar contas bancárias. Reinicie o backend e atualize a página.");
    });
  }, [authToken]);

  useEffect(() => {
    if (!authToken || activeView !== "financeiro") return;
    loadFinanceAccounts().catch(() => null);
  }, [authToken, activeView]);

  useEffect(() => {
    if (!accountsForBank.length) {
      setSelectedAccountId(null);
      return;
    }
    if (!selectedAccountId || !accountsForBank.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(accountsForBank[0].id);
    }
  }, [accountsForBank, selectedAccountId]);

  useEffect(() => {
    if (!authToken) return;
    loadRuns().catch(() => setError("Erro ao carregar execuções."));
    const timer = setInterval(
      () => {
        loadRuns().catch(() => null);
      },
      isSelectedRunActive ? FAST_POLL_MS : DEFAULT_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [authToken, bankView, selectedAccountId, isSelectedRunActive]);

  useEffect(() => {
    if (!authToken) return;
    if (selectedRun?.id) {
      loadDataset(selectedRun.id, selectedRun.status).catch(() => null);
    } else {
      setDataset(null);
    }
  }, [selectedRun?.id, selectedRun?.status]);

  useEffect(() => {
    if (!authToken) return;
    if (!selectedRun?.id) return;
    const timer = setInterval(() => {
      loadDataset(selectedRun.id, selectedRun.status).catch(() => null);
    }, isSelectedRunActive ? FAST_POLL_MS : DEFAULT_POLL_MS);
    return () => clearInterval(timer);
  }, [isSelectedRunActive, selectedRun?.id, selectedRun?.status]);

  useEffect(() => {
    if (!authToken) return;
    if (!selectedRunBase?.id) {
      setLiveRun(null);
      return;
    }
    loadRunLive(selectedRunBase.id).catch(() => null);
    const timer = setInterval(() => {
      loadRunLive(selectedRunBase.id).catch(() => null);
    }, isSelectedRunActive ? 500 : 1000);
    return () => clearInterval(timer);
  }, [isSelectedRunActive, selectedRunBase?.id]);

  useEffect(() => {
    setFilesBySlot({ extrato: [], comprovantes: [], numerario: [] });
    setError("");
  }, [bankView]);

  useEffect(() => {
    setSelectedMonthKey("todos");
  }, [selectedRunId]);

  useEffect(() => {
    if (!monthTabs.length) return;
    const exists = monthTabs.some((tab) => tab.key === selectedMonthKey);
    if (!exists) setSelectedMonthKey("todos");
  }, [monthTabs, selectedMonthKey]);

  useEffect(() => {
    if (!filteredRuns.length) {
      setSelectedRunId(null);
      return;
    }
    const existsInFilter = filteredRuns.some((r) => r.id === selectedRunId);
    if (!existsInFilter) {
      setSelectedRunId(filteredRuns[0].id);
    }
  }, [filteredRuns, selectedRunId]);

  useEffect(() => {
    setSelectedMonthKey("todos");
    setFilterField("geral");
    setFilterValue("");
  }, [selectedRun?.id, bankView]);

  useEffect(() => {
    if (activeView !== "configuracoes") return;
    setPasswordError("");
    setPasswordMessage("");
    setAdminError("");
    setAdminMessage("");
    loadActiveSessions().catch(() => null);
    if (currentUser?.role === "admin") {
      loadPendingUsers().catch(() => null);
      loadPendingCount().catch(() => null);
      loadFinanceAccounts({ includeInactive: true }).catch(() => null);
    }
  }, [activeView, currentUser?.role]);

  useEffect(() => {
    const panel = document.querySelector(".platform-dashboard");
    const timer = window.setTimeout(() => {
      panel?.scrollTo({ top: 0, behavior: "smooth" });
    }, 420);
    return () => window.clearTimeout(timer);
  }, [activeView]);

  useEffect(() => {
    const useConfigBg = Boolean(authToken) && activeView === "configuracoes";
    document.documentElement.setAttribute("data-kivo-bg", useConfigBg ? "config" : "degrade");
  }, [authToken, activeView]);

  const pageHeading = useMemo(
    () => resolvePlatformHeading(activeView, analysisView, bankView, operationsView, rhView),
    [activeView, analysisView, bankView, operationsView, rhView],
  );

  useEffect(() => {
    if (!authToken || !currentUser) {
      document.title = resolveGuestDocumentTitle(guestView, authMode);
      return;
    }
    document.title = resolveDocumentTitle(activeView, analysisView, bankView, operationsView, rhView);
  }, [
    authToken,
    currentUser,
    guestView,
    authMode,
    activeView,
    analysisView,
    bankView,
    operationsView,
    rhView,
  ]);

  useEffect(() => {
    let lastY = window.scrollY;
    const minY = 80;
    const minDelta = 10;

    const onScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastY;
      if (Math.abs(delta) < minDelta) return;

      if (currentY < minY) {
        setHideLandingTopbar(false);
      } else if (delta > 0) {
        setHideLandingTopbar((prev) => (prev ? prev : true));
      } else {
        setHideLandingTopbar((prev) => (prev ? false : prev));
      }
      lastY = currentY;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!authReady) {
    return (
      <main className="app-shell">
        <section className="panel">
          <h2>Carregando...</h2>
          <p className="subtitle">Preparando ambiente de autenticação.</p>
        </section>
      </main>
    );
  }

  if (!authToken || !currentUser) {
    const scrollToLogin = () => openAuthScreen("login");

    if (guestView === "auth" || guestView === "forgot" || guestView === "reset") {
      const isRegister = authMode === "register" && guestView === "auth";
      const isForgot = guestView === "forgot";
      const isReset = guestView === "reset";
      const authTitle = isReset
        ? "Defina uma nova senha"
        : isForgot
          ? "Recuperar acesso"
          : isRegister
            ? "Crie sua conta no KIVO"
            : "Bem-vindo de volta!";
      return (
        <main className="auth-screen">
          <button
            type="button"
            className="auth-screen-back"
            onClick={() => {
              setAuthError("");
              setAuthSuccess("");
              if (isForgot || isReset) {
                setGuestView("auth");
                setAuthMode("login");
              } else {
                setGuestView("landing");
              }
            }}
          >
            <span aria-hidden="true">‹</span> Voltar
          </button>

          <div className="auth-screen-card">
            <div className="auth-screen-logo">
              <Image
                src="/brand/kivo-logotipo.png"
                alt="KIVO"
                width={200}
                height={56}
                className="auth-screen-logo-img"
                priority
              />
            </div>

            <h1 className="auth-screen-title">{authTitle}</h1>
            <p className="auth-screen-subtitle">
              {isReset ? (
                <>
                  Cole o código do link ou use o link enviado pelo administrador.{" "}
                  <button
                    type="button"
                    className="auth-screen-link"
                    onClick={() => {
                      setGuestView("auth");
                      setAuthMode("login");
                      setAuthError("");
                    }}
                  >
                    Voltar ao login
                  </button>
                </>
              ) : isForgot ? (
                <>
                  Informe seu usuário. Um administrador pode gerar o link de redefinição.{" "}
                  <button
                    type="button"
                    className="auth-screen-link"
                    onClick={() => {
                      setGuestView("auth");
                      setAuthMode("login");
                      setAuthError("");
                    }}
                  >
                    Voltar ao login
                  </button>
                </>
              ) : isRegister ? (
                <>
                  Já tem conta?{" "}
                  <button
                    type="button"
                    className="auth-screen-link"
                    onClick={() => {
                      setAuthMode("login");
                      setAuthSuccess("");
                    }}
                  >
                    Entrar
                  </button>
                </>
              ) : (
                <>
                  Primeira vez aqui?{" "}
                  <button
                    type="button"
                    className="auth-screen-link"
                    onClick={() => {
                      setAuthMode("register");
                      setAuthSuccess("");
                    }}
                  >
                    Cadastre-se grátis
                  </button>
                </>
              )}
            </p>

            {isRegister && (
              <p className="auth-screen-subtitle auth-screen-register-hint">
                Após o cadastro, um administrador aprova seu acesso e define o setor liberado.
              </p>
            )}

            {isForgot && (
              <p className="auth-screen-subtitle auth-screen-register-hint">
                Por segurança, a resposta é sempre a mesma, mesmo que o usuário não exista.
              </p>
            )}

            <div className="auth-screen-form">
              {(guestView === "auth" || isForgot) && (
              <div className="auth-screen-field">
                <input
                  id="auth-username"
                  type="text"
                  placeholder="Seu usuário"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
              )}

              {isReset && (
                <div className="auth-screen-field">
                  <input
                    id="auth-reset-token"
                    type="text"
                    placeholder="Código do link de redefinição"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              )}

              {isRegister && (
                <div className="auth-screen-field">
                  <label className="auth-screen-label" htmlFor="auth-sector">
                    Setor
                  </label>
                  <select
                    id="auth-sector"
                    className="auth-screen-select"
                    value={registerSector}
                    onChange={(e) => setRegisterSector(e.target.value as SectorKey)}
                  >
                    {SECTOR_MENU.map((sector) => (
                      <option key={sector.key} value={sector.key}>
                        {sector.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(guestView === "auth" || isReset) && (
              <div className="auth-screen-field">
                <AuthPasswordField
                  id="auth-password"
                  placeholder={isReset ? "Nova senha" : "Sua senha"}
                  value={isReset ? newPassword : loginPassword}
                  visible={isReset ? showNewPassword : showAuthPassword}
                  onToggleVisible={() =>
                    isReset ? setShowNewPassword((prev) => !prev) : setShowAuthPassword((prev) => !prev)
                  }
                  autoComplete={isRegister || isReset ? "new-password" : "current-password"}
                  onChange={isReset ? setNewPassword : setLoginPassword}
                  onEnter={() => {
                    if (isReset) handleResetPassword().catch(() => null);
                    else if (isRegister) handleRegister().catch(() => null);
                    else handleLogin().catch(() => null);
                  }}
                />
              </div>
              )}

              {(isRegister || isReset) && (
                <div className="auth-screen-field">
                  <AuthPasswordField
                    id="auth-password-confirm"
                    placeholder="Confirme sua senha"
                    value={isReset ? newPasswordConfirm : registerPasswordConfirm}
                    visible={isReset ? showNewPasswordConfirm : showAuthPasswordConfirm}
                    onToggleVisible={() =>
                      isReset
                        ? setShowNewPasswordConfirm((prev) => !prev)
                        : setShowAuthPasswordConfirm((prev) => !prev)
                    }
                    autoComplete="new-password"
                    onChange={isReset ? setNewPasswordConfirm : setRegisterPasswordConfirm}
                    onEnter={() => {
                      if (isReset) handleResetPassword().catch(() => null);
                      else handleRegister().catch(() => null);
                    }}
                  />
                </div>
              )}

              <button
                type="button"
                className="auth-screen-submit"
                disabled={authLoading}
                onClick={() => {
                  if (isReset) handleResetPassword().catch(() => null);
                  else if (isForgot) handleForgotPassword().catch(() => null);
                  else if (isRegister) handleRegister().catch(() => null);
                  else handleLogin().catch(() => null);
                }}
              >
                {authLoading
                  ? isReset
                    ? "Salvando..."
                    : isForgot
                      ? "Enviando..."
                      : isRegister
                        ? "Criando conta..."
                        : "Entrando..."
                  : isReset
                    ? "Redefinir senha"
                    : isForgot
                      ? "Solicitar redefinição"
                      : isRegister
                        ? "Criar conta"
                        : "Entrar"}
              </button>

              {guestView === "auth" && authMode === "login" && (
                <button
                  type="button"
                  className="auth-screen-link auth-screen-forgot"
                  onClick={() => {
                    setAuthError("");
                    setAuthSuccess("");
                    setGuestView("forgot");
                  }}
                >
                  Esqueci minha senha
                </button>
              )}

              {authError && <p className="auth-screen-error">{authError}</p>}
              {authSuccess && <p className="auth-screen-success">{authSuccess}</p>}
            </div>

            <p className="auth-screen-legal">
              Ao continuar, você concorda com os{" "}
              <a href="#termos">Termos de Uso</a> e a <a href="#privacidade">Política de Privacidade</a>.
            </p>
          </div>
        </main>
      );
    }

    return (
      <main className="lp-shell">
        <header className={`lp-topbar ${hideLandingTopbar ? "lp-topbar--hidden" : ""}`}>
          <div className="lp-brand">
            <Image
              src="/brand/kivo-logotipo.png"
              alt="KIVO"
              width={360}
              height={90}
              className="lp-brand-logo"
              priority
            />
          </div>
          <nav className="lp-nav">
            <a href="#lp-modules">Soluções</a>
            <a href="#lp-modules">Módulos</a>
            <a href="#lp-journey">API</a>
            <a href="#lp-journey">Planos</a>
          </nav>
        </header>

        <section className="lp-hero-grid">
          <article className="lp-hero-copy">
            <h1>O ERP QUE MOVE SUA OPERAÇÃO GLOBAL.</h1>
            <p>
              Automação inteligente e infraestrutura cloud-native para times que não podem parar a operação global.
              Conciliações, Comex e governança em uma única plataforma.
            </p>
            <div className="lp-cta-row">
              <button type="button" className="lp-btn-primary" onClick={scrollToLogin}>
                Acessar Plataforma
              </button>
              <button
                type="button"
                className="lp-btn-ghost"
                onClick={() => document.getElementById("lp-modules")?.scrollIntoView({ behavior: "smooth" })}
              >
                Conhecer os Módulos
                <span className="lp-chevron" aria-hidden="true">
                  ↓
                </span>
              </button>
            </div>
          </article>

          <article className="lp-login-card" id="lp-login">
            <div className="login-hero">
              <Image
                src="/brand/kivo-logotipo.png"
                alt="KIVO"
                width={160}
                height={44}
                className="lp-login-card-logo"
                priority
              />
              <h2>Acesse o KIVO</h2>
              <p>Entre na sua conta ou crie um acesso novo em segundos.</p>
            </div>
            <div className="login-form lp-login-cta-stack">
              <button type="button" className="lp-login-submit" onClick={() => openAuthScreen("login")}>
                Entrar na conta
              </button>
              <button type="button" className="lp-btn-ghost lp-login-secondary" onClick={() => openAuthScreen("register")}>
                Criar conta grátis
              </button>
            </div>
          </article>
        </section>

        <section className="lp-module-grid" id="lp-modules">
          <article className="lp-module-card">
            <span className="lp-feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M9 9h6M9 12h6M9 15h4" />
              </svg>
            </span>
            <h3>Menos trabalho manual</h3>
            <p>Conciliações que levavam horas em planilhas, executadas em minutos.</p>
          </article>
          <article className="lp-module-card">
            <span className="lp-feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <h3>Visibilidade total</h3>
            <p>Logs de execução, histórico de cargas e status em tempo real.</p>
          </article>
          <article className="lp-module-card">
            <span className="lp-feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 3l7 4v5c0 4.5-3.2 7.8-7 9-3.8-1.2-7-4.5-7-9V7l7-4z" />
              </svg>
            </span>
            <h3>Governança auditada</h3>
            <p>Rastreabilidade ponta a ponta com controle de acesso por papel.</p>
          </article>
        </section>

        <section className="lp-flow-section" id="lp-journey">
          <div className="lp-flow-header">
            <span className="lp-flow-kicker">COMO OPERAR NA MÉTRICA</span>
            <h2>Uma jornada simples para operar e escalar.</h2>
            <p>
              Da entrada dos documentos ao acompanhamento dos resultados, o fluxo foi pensado para reduzir atrito no dia
              a dia do financeiro.
            </p>
          </div>

          <div className="lp-flow-steps">
            <article className="lp-flow-step">
              <span className="lp-flow-index">01</span>
              <h3>Monte a rodada</h3>
              <p>Selecione banco, anexe extratos e comprovantes, e valide os arquivos obrigatórios.</p>
              <div className="lp-dash-preview" aria-hidden="true">
                <div className="lp-dash-toolbar" />
                <div className="lp-dash-chart" />
                <div className="lp-dash-rows">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
            <article className="lp-flow-step">
              <span className="lp-flow-index">02</span>
              <h3>Execute em um clique</h3>
              <p>Dispare a automação e acompanhe o status da execução sem trocar de tela.</p>
              <div className="lp-dash-preview lp-dash-preview--wide" aria-hidden="true">
                <div className="lp-dash-toolbar" />
                <div className="lp-dash-kpis">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="lp-dash-rows">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
            <article className="lp-flow-step">
              <span className="lp-flow-index">03</span>
              <h3>Analise e audite</h3>
              <p>Consulte logs, pendências e histórico consolidado com rastreabilidade ponta a ponta.</p>
              <div className="lp-dash-preview" aria-hidden="true">
                <div className="lp-dash-toolbar" />
                <div className="lp-dash-split">
                  <div className="lp-dash-chart lp-dash-chart--sm" />
                  <div className="lp-dash-rows">
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="platform-shell">
      <div className="platform-frame">
        <aside className="platform-rail" aria-label="Navegação rápida">
          <button
            type="button"
            className="platform-rail-logo-btn"
            onClick={() => setActiveView("inicio")}
            title="KIVO — Início"
          >
            <Image
              src="/brand/kivo-logotipo.png"
              alt="KIVO"
              width={64}
              height={18}
              className="platform-rail-logo"
            />
          </button>
          <nav className="platform-rail-nav">
            <button
              type="button"
              className={`platform-rail-btn ${activeView === "inicio" ? "active" : ""}`}
              onClick={() => setActiveView("inicio")}
              title="Início"
              aria-label="Início"
            >
              <HomeRailIcon />
            </button>
            {visibleSectors.map((sector) => (
              <button
                key={sector.key}
                type="button"
                className={`platform-rail-btn ${activeView === sector.key ? "active" : ""}`}
                onClick={() => setActiveView(sector.key)}
                title={`${sector.label} — ${sector.subtitle}`}
                aria-label={sector.label}
              >
                <SectorRailIcon sector={sector.key} />
              </button>
            ))}
          </nav>
          <button
            type="button"
            className={`platform-rail-btn platform-rail-btn--settings ${activeView === "configuracoes" ? "active" : ""}`}
            onClick={() => setActiveView("configuracoes")}
            title={
              pendingCount > 0
                ? `Configurações (${pendingCount} cadastro${pendingCount === 1 ? "" : "s"} pendente${pendingCount === 1 ? "" : "s"})`
                : "Configurações"
            }
            aria-label="Configurações"
          >
            <SettingsRailIcon />
            {currentUser.role === "admin" && pendingCount > 0 && (
              <span className="platform-nav-badge" aria-hidden="true">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </button>
          <div className="platform-rail-avatar" title={`${currentUser.username} (${currentUser.role})`}>
            {currentUser.username.charAt(0).toUpperCase()}
          </div>
        </aside>

        <div className="platform-dashboard-wrap">
          <div
            className={`platform-dashboard${
              activeView === "financeiro"
                ? " platform-dashboard--financeiro"
                : activeView === "configuracoes"
                  ? " platform-dashboard--centered platform-dashboard--settings"
                  : activeView === "inicio"
                    ? " platform-dashboard--centered platform-dashboard--home"
                    : activeView === "operacoes"
                      ? " platform-dashboard--centered platform-dashboard--operacoes"
                      : activeView === "rh"
                        ? " platform-dashboard--centered platform-dashboard--rh"
                        : " platform-dashboard--centered platform-dashboard--module"
            }`}
          >
            <header className="platform-page-header platform-page-header--animate">
              <div>
                <h1 className="platform-title">{pageHeading.title}</h1>
                <p className="platform-subtitle">{pageHeading.subtitle}</p>
              </div>
              <span className="platform-tag">{pageHeading.tag}</span>
            </header>

            <div key={activeView} className={`platform-view-pane platform-view-pane--${activeView}`}>
        {activeView === "inicio" ? (
          <section className="platform-home" aria-label="Página inicial">
            <div className="platform-home-hero">
              <div className="platform-home-hero-copy">
                <p className="platform-home-eyebrow">Olá, {currentUser.username}</p>
                <h2 className="platform-home-title">
                  Bem-vindo ao{" "}
                  <span className="platform-home-brand">
                    KIV<span className="platform-home-brand-o">O</span>
                  </span>
                </h2>
                <p className="platform-home-lead">
                  Escolha um setor para começar. Você também pode usar a barra lateral ou a navegação
                  inferior.
                </p>
              </div>
              <div className="platform-home-hero-mascot" aria-hidden="true">
                <div className="platform-home-hero-mascot-glow" />
                <KivoRobot mood="idle" className="platform-home-hero-robot" title="Assistente KIVO" />
              </div>
            </div>

            <div className="platform-home-modules-head">
              <h3 className="platform-home-modules-title">Seus módulos</h3>
              <span className="platform-home-modules-count">
                {visibleSectors.length} {visibleSectors.length === 1 ? "setor" : "setores"}
              </span>
            </div>

            <div className="platform-home-modules">
              {visibleSectors.map((sector) => (
                <button
                  key={sector.key}
                  type="button"
                  className={`platform-home-module platform-home-module--${sector.key}`}
                  onClick={() => setActiveView(sector.key)}
                >
                  <span className="platform-home-module-icon" aria-hidden="true">
                    <SectorRailIcon sector={sector.key} />
                  </span>
                  <span className="platform-home-module-body">
                    <strong>{sector.label}</strong>
                    <span className="platform-home-module-desc">{sector.subtitle}</span>
                  </span>
                  <span className="platform-home-module-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ))}
            </div>

            <p className="platform-home-assistant-hint">
              <KivoRobot mood="peek" className="platform-home-hint-robot" />
              Dúvidas? Clique no robô escondido atrás do painel — ele sai, abre o chat e, ao enviar mensagem, fica
              andando pensando.
            </p>
          </section>
        ) : activeView === "configuracoes" ? (
          <section className="panel platform-settings">
            {currentUser.role === "admin" && pendingCount > 0 && (
              <div className="platform-settings-alert" role="status">
                <strong>
                  {pendingCount} cadastro{pendingCount === 1 ? "" : "s"} aguardando aprovação
                </strong>
                <span>Revise na seção Administração abaixo.</span>
              </div>
            )}
            <div className="platform-settings-grid">
              <article className="platform-settings-card">
                <span className="platform-settings-label">Usuário</span>
                <strong>{currentUser.username}</strong>
              </article>
              <article className="platform-settings-card">
                <span className="platform-settings-label">Perfil</span>
                <strong>{roleLabel(currentUser.role)}</strong>
              </article>
              <article className="platform-settings-card">
                <span className="platform-settings-label">Setor</span>
                <strong>{sectorLabel(currentUser.sector)}</strong>
              </article>
              <article className="platform-settings-card">
                <span className="platform-settings-label">Sessões</span>
                <strong>
                  {activeSessionCount > 0
                    ? `${activeSessionCount} ativa${activeSessionCount === 1 ? "" : "s"}`
                    : "—"}
                </strong>
              </article>
              <article className="platform-settings-card platform-settings-card--wide">
                <span className="platform-settings-label">API conectada</span>
                <strong className="platform-settings-mono">{API_BASE}</strong>
              </article>
            </div>

            <div className="platform-settings-stack">
              <section className="platform-settings-block">
                <header className="platform-settings-block-head">
                  <h3>Segurança da conta</h3>
                  <p className="platform-settings-block-desc">
                    {activeSessionCount > 1
                      ? `${activeSessionCount} sessões abertas — alterar a senha mantém apenas esta.`
                      : "Atualize sua senha quando necessário."}
                  </p>
                </header>
                <div className="platform-settings-security-form">
                  <label className="platform-settings-field">
                    <span className="platform-settings-field-label">Senha atual</span>
                    <AuthPasswordField
                      id="settings-current-password"
                      placeholder="Digite a senha atual"
                      value={changeCurrentPassword}
                      visible={showAuthPassword}
                      onToggleVisible={() => setShowAuthPassword((prev) => !prev)}
                      autoComplete="current-password"
                      onChange={setChangeCurrentPassword}
                    />
                  </label>
                  <label className="platform-settings-field">
                    <span className="platform-settings-field-label">Nova senha</span>
                    <AuthPasswordField
                      id="settings-new-password"
                      placeholder="Mínimo 6 caracteres"
                      value={changeNewPassword}
                      visible={showNewPassword}
                      onToggleVisible={() => setShowNewPassword((prev) => !prev)}
                      autoComplete="new-password"
                      onChange={setChangeNewPassword}
                    />
                  </label>
                  <label className="platform-settings-field">
                    <span className="platform-settings-field-label">Confirmar nova senha</span>
                    <AuthPasswordField
                      id="settings-new-password-confirm"
                      placeholder="Repita a nova senha"
                      value={changeNewPasswordConfirm}
                      visible={showNewPasswordConfirm}
                      onToggleVisible={() => setShowNewPasswordConfirm((prev) => !prev)}
                      autoComplete="new-password"
                      onChange={setChangeNewPasswordConfirm}
                    />
                  </label>
                </div>
                <div className="platform-settings-block-actions">
                  <button
                    type="button"
                    className="platform-settings-approve-btn"
                    disabled={passwordBusy}
                    onClick={() => handleChangePassword().catch(() => null)}
                  >
                    {passwordBusy ? "Salvando…" : "Alterar senha"}
                  </button>
                  {activeSessionCount > 1 && (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={passwordBusy}
                      onClick={() => handleLogoutOtherSessions().catch(() => null)}
                    >
                      Encerrar outras sessões
                    </button>
                  )}
                </div>
                {passwordError && (
                  <p className="platform-settings-feedback platform-settings-feedback--error">{passwordError}</p>
                )}
                {passwordMessage && (
                  <p className="platform-settings-feedback platform-settings-feedback--ok">{passwordMessage}</p>
                )}
              </section>

              {currentUser.role === "admin" && (
                <section className="platform-settings-block platform-settings-block--admin">
                  <header className="platform-settings-block-head">
                    <h3>Administração</h3>
                    <p className="platform-settings-block-desc">
                      Aprovação de cadastros e links de redefinição de senha.
                    </p>
                  </header>

                  <div className="platform-settings-admin-panel">
                    <div className="platform-settings-admin-section">
                      <h4>Contas bancárias</h4>
                      <p className="platform-settings-block-desc">
                        Cadastre quantas contas precisar por banco (Master 1, Master 2, Administrativo, etc.).
                      </p>
                      <div className="platform-settings-admin-reset-row platform-settings-add-account-row">
                        <label className="platform-settings-field platform-settings-admin-reset-input">
                          <span className="platform-settings-field-label">Banco</span>
                          <select
                            className="platform-settings-select"
                            value={newAccountBank}
                            onChange={(e) => setNewAccountBank(e.target.value as BankKey)}
                          >
                            <option value="bb">Banco do Brasil</option>
                            <option value="itau_sigra">Itaú / SIGRA</option>
                          </select>
                        </label>
                        <label className="platform-settings-field platform-settings-admin-reset-input">
                          <span className="platform-settings-field-label">Nome da conta</span>
                          <input
                            type="text"
                            placeholder="Ex.: Master 1"
                            value={newAccountName}
                            onChange={(e) => setNewAccountName(e.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="platform-settings-approve-btn platform-settings-generate-link"
                          disabled={accountsBusy}
                          onClick={() => createFinanceAccount().catch(() => null)}
                        >
                          {accountsBusy ? "Salvando…" : "Adicionar conta"}
                        </button>
                      </div>
                      <div className="platform-settings-accounts-scroll">
                      <ul className="platform-settings-accounts-list">
                        {financeAccounts.length === 0 && (
                          <li className="platform-settings-empty muted">
                            Nenhuma conta cadastrada ainda.
                          </li>
                        )}
                        {financeAccounts.map((account) => (
                          <li key={account.id} className="platform-settings-account-item">
                            <div>
                              <strong>{account.name}</strong>
                              <span>
                                {account.bank === "bb" ? "BB" : "Itaú"} · {account.slug}
                                {Number(account.is_active) !== 1 ? " · inativa" : " · ativa"}
                              </span>
                            </div>
                            {Number(account.is_active) === 1 ? (
                              <button
                                type="button"
                                className="btn-secondary platform-settings-reject-btn"
                                disabled={accountsBusy}
                                onClick={() => deactivateFinanceAccount(account.id).catch(() => null)}
                              >
                                Desativar
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="platform-settings-approve-btn"
                                disabled={accountsBusy}
                                onClick={() => reactivateFinanceAccount(account.id).catch(() => null)}
                              >
                                Reativar
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                      </div>
                      {accountsError && (
                        <p className="platform-settings-feedback platform-settings-feedback--error">
                          {accountsError}
                        </p>
                      )}
                      {accountsMessage && (
                        <p className="platform-settings-feedback platform-settings-feedback--ok">
                          {accountsMessage}
                        </p>
                      )}
                    </div>

                    <div className="platform-settings-admin-section">
                      <div className="platform-settings-approvals-head">
                        <h4>Cadastros pendentes</h4>
                        <button
                          type="button"
                          className="btn-secondary platform-settings-refresh"
                          disabled={pendingUsersLoading}
                          onClick={() => loadPendingUsers().catch(() => null)}
                        >
                          {pendingUsersLoading ? "Atualizando…" : "Atualizar"}
                        </button>
                      </div>
                      {pendingUsers.length === 0 ? (
                        <p className="platform-settings-empty muted">Nenhuma solicitação pendente.</p>
                      ) : (
                        <ul className="platform-settings-pending-list">
                          {pendingUsers.map((user) => (
                            <li key={user.id} className="platform-settings-pending-item">
                              <div className="platform-settings-pending-meta">
                                <strong>{user.username}</strong>
                                <span>
                                  {sectorLabel(user.requested_sector)} ·{" "}
                                  {new Date(user.created_at).toLocaleString("pt-BR")}
                                </span>
                              </div>
                              <div className="platform-settings-pending-actions">
                                <label className="platform-settings-pending-sector">
                                  <span>Setor liberado</span>
                                  <select
                                    className="platform-settings-select platform-settings-sector-select"
                                    value={approvalSectorByUser[user.id] || user.requested_sector}
                                    onChange={(e) =>
                                      setApprovalSectorByUser((prev) => ({
                                        ...prev,
                                        [user.id]: e.target.value as SectorKey,
                                      }))
                                    }
                                    disabled={pendingActionId === user.id}
                                  >
                                    {SECTOR_MENU.map((sector) => (
                                      <option key={sector.key} value={sector.key}>
                                        {sector.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  type="button"
                                  className="platform-settings-approve-btn"
                                  disabled={pendingActionId === user.id}
                                  onClick={() => approvePendingUser(user.id).catch(() => null)}
                                >
                                  Aprovar
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary platform-settings-reject-btn"
                                  disabled={pendingActionId === user.id}
                                  onClick={() => rejectPendingUser(user.id).catch(() => null)}
                                >
                                  Recusar
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="platform-settings-admin-section">
                      <h4>Link de redefinição</h4>
                      <p className="platform-settings-block-desc">
                        Válido por 1 hora — envie ao usuário por canal interno.
                      </p>
                      <div className="platform-settings-admin-reset-row">
                        <label className="platform-settings-field platform-settings-admin-reset-input">
                          <span className="platform-settings-field-label">Usuário</span>
                          <input
                            type="text"
                            placeholder="Nome de login"
                            value={adminLookupUsername}
                            onChange={(e) => setAdminLookupUsername(e.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn-secondary platform-settings-generate-link"
                          disabled={adminBusy}
                          onClick={() => adminGenerateResetLink().catch(() => null)}
                        >
                          {adminBusy ? "Gerando…" : "Gerar link"}
                        </button>
                      </div>
                      {adminResetLink && (
                        <div className="platform-settings-reset-link-box">
                          <span className="platform-settings-label">{adminResetLinkFor}</span>
                          <a href={adminResetLink} className="platform-settings-reset-link-url">
                            {adminResetLink}
                          </a>
                        </div>
                      )}
                      {adminError && (
                        <p className="platform-settings-feedback platform-settings-feedback--error">{adminError}</p>
                      )}
                      {adminMessage && (
                        <p className="platform-settings-feedback platform-settings-feedback--ok">{adminMessage}</p>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </div>

            <footer className="platform-settings-footer">
              <button type="button" className="btn-secondary" onClick={() => handleLogout().catch(() => null)}>
                Sair da conta
              </button>
            </footer>
          </section>
        ) : activeView === "operacoes" ? (
          <section className="platform-operacoes" aria-label="Painel de operações">
            <div className="platform-operacoes-flows platform-operacoes-flows--compact" role="tablist" aria-label="Fluxos de comércio exterior">
              <button
                type="button"
                role="tab"
                aria-selected={operationsView === "importacao"}
                className={`platform-operacoes-flow-tab ${operationsView === "importacao" ? "active" : ""}`}
                onClick={() => setOperationsView("importacao")}
              >
                Importação
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={operationsView === "exportacao"}
                className={`platform-operacoes-flow-tab ${operationsView === "exportacao" ? "active" : ""}`}
                onClick={() => setOperationsView("exportacao")}
              >
                Exportação
              </button>
            </div>

            <OperacoesPanel
              apiFetch={apiFetch}
              operationsView={operationsView}
              username={currentUser.username}
              isAdmin={currentUser.role === "admin"}
            />
          </section>
        ) : activeView === "rh" ? (
          <RhPanel apiFetch={apiFetch} onViewChange={setRhView} />
        ) : activeView !== "financeiro" ? (
          <section className="panel platform-sector-empty">
            <h2>{SECTOR_MENU.find((item) => item.key === activeView)?.label} em breve</h2>
            <p className="subtitle">
              Este setor já está previsto na navegação. Quando quiser, eu estruturo as telas e fluxos deste módulo também.
            </p>
          </section>
        ) : (
          <main className="app-shell app-shell--financeiro">
      <section className="hero">
        <div>
          <h1>Painel Financeiro / Conciliação</h1>
          <p>
            Plataforma operacional para conciliações financeiras com arquitetura extensível:
            Banco do Brasil, Itaú/SIGRA e novas automações plugáveis.
          </p>
        </div>
        <div className="badge">Live Operations • Internal Use</div>
      </section>

      <section className="kpi-grid">
        <article className="kpi">
          <div className="label">Total de execuções</div>
          <div className="value">{totals.total}</div>
        </article>
        <article className="kpi">
          <div className="label">Concluídas</div>
          <div className="value">{totals.completed}</div>
        </article>
        <article className="kpi">
          <div className="label">Em andamento</div>
          <div className="value">{totals.running}</div>
        </article>
        <article className="kpi">
          <div className="label">Com erro</div>
          <div className="value">{totals.failed}</div>
        </article>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>Montagem e Execução da Rodada</h2>
        <p className="subtitle">
          Organize os arquivos por tipo de documento, execute e acompanhe o resultado logo abaixo na mesma tela.
        </p>

        <div className="tab-row" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className={`tab-btn ${bankView === "bb" ? "active" : ""}`}
            onClick={() => setBankView("bb")}
          >
            Banco do Brasil ({runCountsByBank.bb})
          </button>
          <button
            type="button"
            className={`tab-btn ${bankView === "itau_sigra" ? "active" : ""}`}
            onClick={() => setBankView("itau_sigra")}
          >
            Itaú / SIGRA ({runCountsByBank.itau_sigra})
          </button>
        </div>

        <div className="finance-account-row">
          <span className="finance-account-row-label">Conta</span>
          <div className="tab-row finance-account-tabs">
            {accountsForBank.map((account) => (
              <button
                key={account.id}
                type="button"
                className={`tab-btn finance-account-tab ${selectedAccountId === account.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedAccountId(account.id);
                  setSelectedRunId(null);
                  setDataset(null);
                }}
              >
                {account.name} ({runCountByAccountId[account.id] || 0})
              </button>
            ))}
            {accountsForBank.length === 0 && (
              <span className="muted">
                {inactiveAccountsForBank.length > 0
                  ? `${inactiveAccountsForBank.length} conta(s) inativa(s) — reative em Configurações → Contas bancárias.`
                  : "Nenhuma conta ativa. Peça ao admin para cadastrar em Configurações."}
              </span>
            )}
          </div>
        </div>

        <p className="subtitle" style={{ marginBottom: 12 }}>
          {selectedAccount
            ? `Rodada para ${selectedAccount.name} — ${
                automations.find((a) => a.key === bankView)?.description ||
                (bankView === "bb"
                  ? "conciliação Banco do Brasil."
                  : "conciliação Itaú com SIGRA/Numerário.")
              }`
            : "Selecione a conta bancária da rodada."}
        </p>

        <div className="doc-grid">
          {slotConfig.map((slot) => (
            <article className="doc-card" key={slot.key}>
              <div className="doc-head">
                <h3>{slot.title}</h3>
                <span className={`doc-badge ${slot.required ? "required" : "optional"}`}>
                  {slot.required ? "Obrigatório" : "Opcional"}
                </span>
              </div>
              <p className="doc-hint">{slot.hint}</p>
              <div className="doc-actions">
                <label className="upload-btn">
                  Adicionar {slot.allowMultiple ? "documentos" : "documento"}
                  <input
                    type="file"
                    multiple={slot.allowMultiple}
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      addFiles(slot.key, e.target.files, slot.allowMultiple);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => clearSlot(slot.key)}
                  disabled={(filesBySlot[slot.key]?.length ?? 0) === 0}
                >
                  Limpar
                </button>
              </div>
              <div className="file-list">
                {(filesBySlot[slot.key] ?? []).length === 0 && (
                  <span className="muted">Nenhum arquivo neste bloco.</span>
                )}
                {(filesBySlot[slot.key] ?? []).map((f, idx) => (
                  <div className="file-chip" key={`${slot.key}-${f.name}-${idx}`}>
                    {f.name}
                    <button type="button" onClick={() => removeFile(slot.key, idx)}>
                      x
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="run-toolbar">
          <div className="muted">{flattenedFiles.length} arquivo(s) pronto(s) para envio.</div>
          <div className="control-row">
            <button
              type="button"
              className="btn-primary"
              onClick={triggerRun}
              disabled={
                loading || !selectedAccountId || flattenedFiles.length === 0 || hasMissingRequiredDocs
              }
            >
              {loading ? "Disparando..." : "Executar conciliação"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setFilesBySlot({ extrato: [], comprovantes: [], numerario: [] });
                setError("");
              }}
              disabled={loading}
            >
              Nova montagem
            </button>
          </div>
        </div>
        {hasMissingRequiredDocs && (
          <p className="muted">Preencha todos os blocos obrigatórios para liberar a execução.</p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="layout-grid">
        <div className="panel">
          <h2>Execuções</h2>
          <p className="subtitle">
            Execuções de {selectedAccount?.name || "—"} (
            {bankView === "bb" ? "Banco do Brasil" : "Itaú / SIGRA"}).
          </p>
          <div className="control-row" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading || runsRefreshing}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                refreshRuns().catch((err) =>
                  setError(err instanceof Error ? err.message : "Erro ao atualizar execuções."),
                );
              }}
            >
              {runsRefreshing ? "Atualizando…" : "Atualizar"}
            </button>
            <button type="button" className="btn-secondary" onClick={clearAllRuns} disabled={loading}>
              Limpar histórico
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Conta</th>
                  <th>Status</th>
                  <th>Usuário</th>
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`clickable ${selectedRun?.id === run.id ? "active" : ""}`}
                  >
                    <td>{run.id}</td>
                    <td>{run.account_name || "—"}</td>
                    <td>
                      <span className={statusClass(run.status)}>{run.status}</span>
                    </td>
                    <td>{run.triggered_by}</td>
                    <td>{new Date(run.updated_at).toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
                {filteredRuns.length === 0 && (
                  <tr>
                    <td colSpan={5}>Sem execuções para esta conta.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredRuns.length === 0 && runs.length > 0 && (
            <p className="info-note" style={{ marginTop: 10 }}>
              Não há execuções para {bankView === "bb" ? "Banco do Brasil" : "Itaú / SIGRA"} no momento.
              Selecione o outro banco para visualizar os dados existentes.
            </p>
          )}
        </div>

        <div className="panel">
          <h2>Execução Selecionada</h2>
          {selectedRun ? (
            <>
              <p className="subtitle">
                Execução #{selectedRun.id} • {selectedRun.account_name || selectedRun.automation_key} •{" "}
                <span className={statusClass(selectedRun.status)}>{selectedRun.status}</span>
              </p>
              <div className="run-focus-grid">
                <article className="kpi">
                  <div className="label">Criada em</div>
                  <div className="value-sm">{new Date(selectedRun.created_at).toLocaleString("pt-BR")}</div>
                </article>
                <article className="kpi">
                  <div className="label">Última atualização</div>
                  <div className="value-sm">{new Date(selectedRun.updated_at).toLocaleString("pt-BR")}</div>
                </article>
                <article className="kpi">
                  <div className="label">Automação</div>
                  <div className="value-sm">{selectedRun.automation_key}</div>
                </article>
                <article className="kpi">
                  <div className="label">Usuário</div>
                  <div className="value-sm">{selectedRun.triggered_by}</div>
                </article>
              </div>
              {selectedRun.status === "completed" && selectedRun.output_path ? (
                <div className="run-output-actions">
                  <button
                    type="button"
                    className="platform-settings-approve-btn run-download-btn"
                    disabled={downloadBusy}
                    onClick={() => downloadRunExcel(selectedRun.id).catch(() => null)}
                  >
                    {downloadBusy ? "Baixando…" : "Baixar Excel da conciliação"}
                  </button>
                  <p className="output-path muted">
                    <b>Arquivo:</b> {selectedRun.output_path.split(/[/\\]/).pop()}
                  </p>
                </div>
              ) : selectedRun.output_path ? (
                <p className="output-path muted">
                  <b>Arquivo de saída:</b> será liberado ao concluir a execução.
                </p>
              ) : (
                <p className="muted">Arquivo de saída ainda não disponível.</p>
              )}
            </>
          ) : (
            <p className="muted">Nenhuma execução selecionada.</p>
          )}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="tab-row">
          <button
            type="button"
            className={`tab-btn ${analysisView === "planilha" ? "active" : ""}`}
            onClick={() => setAnalysisView("planilha")}
          >
            Status
          </button>
          <button
            type="button"
            className={`tab-btn ${analysisView === "matches" ? "active" : ""}`}
            onClick={() => setAnalysisView("matches")}
          >
            Conciliações ({allMatches.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${analysisView === "log" ? "active" : ""}`}
            onClick={() => setAnalysisView("log")}
          >
            Log Técnico
          </button>
          {selectedRun?.status === "completed" && selectedRun.output_path && (
            <button
              type="button"
              className="tab-btn tab-btn--download"
              disabled={downloadBusy}
              onClick={() => downloadRunExcel(selectedRun.id).catch(() => null)}
            >
              {downloadBusy ? "Baixando…" : "↓ Excel"}
            </button>
          )}
        </div>

        {analysisView === "planilha" && (
          <>
            <h2>Dados da Conciliação (no App)</h2>
            <p className="subtitle">
              Exibindo dados de: {bankView === "bb" ? "Banco do Brasil" : "Itaú / SIGRA"}
            </p>
            {datasetError && <p className="error">{datasetError}</p>}
            {!dataset && !datasetError && (
              <p className="info-note">
                {selectedRun?.status === "running" || selectedRun?.status === "queued"
                  ? "Execução em andamento. A planilha será atualizada automaticamente após a finalização."
                  : "Aguardando dados da execução selecionada."}
              </p>
            )}
            {dataset && (
              <>
                <div className="kpi-grid" style={{ marginBottom: 12 }}>
                  <article className="kpi">
                    <div className="label">Extratos</div>
                    <div className="value">{dataset.metric?.total_extrato ?? 0}</div>
                  </article>
                  <article className="kpi">
                    <div className="label">Linhas conciliadas</div>
                    <div className="value">{dataset.metric?.total_conciliacao_rows ?? 0}</div>
                  </article>
                  <article className="kpi">
                    <div className="label">Extratos conciliados</div>
                    <div className="value">{dataset.metric?.total_extratos_conciliados ?? 0}</div>
                  </article>
                  <article className="kpi">
                    <div className="label">Pendentes</div>
                    <div className="value">{dataset.metric?.total_pendentes_status ?? 0}</div>
                  </article>
                  <article className="kpi">
                    <div className="label">Saldo (Extratos - Comprovantes)</div>
                    <div className="value">
                      {balanceSummary.saldo.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </article>
                </div>

                <h3 style={{ marginTop: 0 }}>Tabela única - Status consolidado</h3>
                <p className="subtitle" style={{ marginBottom: 8 }}>
                  {bankView === "bb"
                    ? "Abas por mês do extrato BB (Janeiro, Maio…): cada aba lista todos os lançamentos daquela planilha, independente da data do pagamento."
                    : "Exibição consolidada do extrato com status de conciliação, Ref. Sigra e descrição/histórico."}
                </p>
                <div className="tab-row month-tabs" style={{ marginBottom: 10 }}>
                  {monthTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={`tab-btn ${selectedMonthKey === tab.key ? "active" : ""}`}
                      onClick={() => setSelectedMonthKey(tab.key)}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  ))}
                </div>
                <div className="filter-row" style={{ marginBottom: 10 }}>
                  <select value={filterField} onChange={(e) => setFilterField(e.target.value as typeof filterField)}>
                    <option value="geral">Filtro geral</option>
                    <option value="data">Data</option>
                    <option value="id_extrato">ID Extrato</option>
                    <option value="descricao">Descrição / Histórico</option>
                    <option value="ref_sigra">Ref. Sigra</option>
                    <option value="status">Status</option>
                  </select>
                  <FilterSearchInput
                    placeholder={
                      filterField === "data"
                        ? "Digite a data (ex.: 08/05/2026)"
                        : filterField === "id_extrato"
                          ? "Digite o ID do extrato"
                          : filterField === "descricao"
                            ? "Digite parte da descrição/histórico"
                            : filterField === "ref_sigra"
                              ? "Digite a Ref. Sigra"
                              : filterField === "status"
                                ? "Digite o status (conciliado/pendente)"
                                : "Digite para filtrar em todas as colunas"
                    }
                    value={filterValue}
                    onChange={setFilterValue}
                  />
                </div>
                <p className="subtitle" style={{ marginBottom: 8 }}>
                  Mostrando {sortedStatuses.length} linha(s) na visão atual.
                </p>
                <div className="table-wrapper table-wrapper--scroll planilha-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {bankView === "bb" && <th>Aba extrato</th>}
                        <th>ID Extrato</th>
                        <th
                          onClick={() => toggleStatusSort("data")}
                          style={{ cursor: "pointer", userSelect: "none" }}
                          title="Clique para ordenar por data"
                        >
                          Data {statusSort.field === "data" ? (statusSort.direction === "desc" ? "▼" : "▲") : ""}
                        </th>
                        <th>Descrição / Histórico</th>
                        <th
                          onClick={() => toggleStatusSort("valor")}
                          style={{ cursor: "pointer", userSelect: "none" }}
                          title="Clique para ordenar por valor"
                        >
                          Valor {statusSort.field === "valor" ? (statusSort.direction === "desc" ? "▼" : "▲") : ""}
                        </th>
                        <th>Ref. Sigra</th>
                        <th>Status</th>
                        <th>Qtd Comp.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedStatuses.map((s, idx) => (
                        <tr key={`${s.sheet_name}-${s.extrato_id}-${s.aba_extrato ?? ""}-${idx}`}>
                          {bankView === "bb" && (
                            <td>{s.aba_extrato ? extratoTabLabelFromKey(extratoTabKeyFromRow(s)) : "-"}</td>
                          )}
                          <td>{s.extrato_id}</td>
                          <td>{s.data}</td>
                          <td>{s.favorecido_descricao}</td>
                          <td>{s.valor_extrato.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                          <td>{s.ref_sigra || "-"}</td>
                          <td>{s.status}</td>
                          <td>{s.qtd_comprovantes}</td>
                        </tr>
                      ))}
                      {sortedStatuses.length === 0 && (
                        <tr>
                          <td colSpan={bankView === "bb" ? 8 : 7}>Sem linhas para os filtros selecionados.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {analysisView === "matches" && (
          <>
            <h2>Linhas conciliadas</h2>
            <p className="subtitle">
              Pares extrato ↔ comprovante da aba <b>conciliacao</b> do Excel ({bankView === "bb" ? "BB" : "Itaú"}).
            </p>
            {datasetError && <p className="error">{datasetError}</p>}
            {!dataset && !datasetError && (
              <p className="info-note">
                {selectedRun?.status === "running" || selectedRun?.status === "queued"
                  ? "Aguarde a conclusão da execução para carregar as conciliações."
                  : "Aguardando dados da execução selecionada."}
              </p>
            )}
            {dataset && (
              <>
                <div className="filter-row" style={{ marginBottom: 10 }}>
                  <select value={filterField} onChange={(e) => setFilterField(e.target.value as typeof filterField)}>
                    <option value="geral">Filtro geral</option>
                    <option value="data">Data</option>
                    <option value="id_extrato">ID Extrato</option>
                    <option value="descricao">Categoria / Cliente</option>
                    <option value="ref_sigra">Ref. Sigra</option>
                  </select>
                  <FilterSearchInput
                    placeholder="Filtrar conciliações…"
                    value={filterValue}
                    onChange={setFilterValue}
                  />
                </div>
                <p className="subtitle" style={{ marginBottom: 8 }}>
                  Mostrando {sortedMatches.length} de {allMatches.length} linha(s) conciliada(s).
                </p>
                <div className="table-wrapper table-wrapper--scroll planilha-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>ID Extrato</th>
                        <th
                          onClick={() => toggleMatchSort("data")}
                          style={{ cursor: "pointer", userSelect: "none" }}
                          title="Ordenar por data do extrato"
                        >
                          Data extrato {matchSort.field === "data" ? (matchSort.direction === "desc" ? "▼" : "▲") : ""}
                        </th>
                        <th
                          onClick={() => toggleMatchSort("valor")}
                          style={{ cursor: "pointer", userSelect: "none" }}
                          title="Ordenar por valor do extrato"
                        >
                          Valor extrato{" "}
                          {matchSort.field === "valor" ? (matchSort.direction === "desc" ? "▼" : "▲") : ""}
                        </th>
                        <th>ID Comprovante</th>
                        <th>Data comp.</th>
                        <th>Valor comp.</th>
                        <th>Ref. Sigra</th>
                        <th>Categoria</th>
                        <th>Cliente</th>
                        <th>Origem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedMatches.map((m, idx) => (
                        <tr key={`${m.extrato_id}-${m.comprovante_id}-${idx}`}>
                          <td>{m.extrato_id}</td>
                          <td>{m.data_extrato}</td>
                          <td>{m.valor_extrato.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                          <td>{m.comprovante_id}</td>
                          <td>{m.data_comprovante}</td>
                          <td>{m.valor_comprovante.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                          <td>{m.ref_sigra || "-"}</td>
                          <td>{m.categoria || "-"}</td>
                          <td>{m.cliente || "-"}</td>
                          <td>{m.origem || "-"}</td>
                        </tr>
                      ))}
                      {sortedMatches.length === 0 && (
                        <tr>
                          <td colSpan={10}>
                            {allMatches.length === 0
                              ? "Nenhuma linha na aba conciliacao desta execução."
                              : "Sem linhas para os filtros selecionados."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {analysisView === "log" && (
          <>
            <h2>Log Técnico</h2>
            {selectedRun ? (
              <>
                <p className="subtitle">
                  Execução #{selectedRun.id} • {selectedRun.automation_key} •{" "}
                  <span className={statusClass(selectedRun.status)}>{selectedRun.status}</span>
                </p>
                {selectedRun.output_path && (
                  <p>
                    <b>Arquivo de saída:</b> {selectedRun.output_path}
                  </p>
                )}
                <div className="log-box">
                  {selectedRun.logs ||
                    (["running", "queued"].includes((selectedRun.status || "").toLowerCase())
                      ? "Execução iniciada. Aguardando primeiras linhas de log..."
                      : "Sem logs ainda.")}
                </div>
              </>
            ) : (
              <p className="muted">Nenhuma execução selecionada para este banco.</p>
            )}
          </>
        )}
      </section>
          </main>
        )}
            </div>
          </div>

          <KivoAssistant username={currentUser.username} />

          <nav className="platform-bottomnav" aria-label="Navegação por setor">
            <div className="platform-bottomnav-pills">
              <button
                type="button"
                className={`platform-nav-pill ${activeView === "inicio" ? "active" : ""}`}
                onClick={() => setActiveView("inicio")}
              >
                Início
              </button>
              {visibleSectors.map((sector) => (
                <button
                  key={sector.key}
                  type="button"
                  className={`platform-nav-pill ${activeView === sector.key ? "active" : ""}`}
                  onClick={() => setActiveView(sector.key)}
                >
                  {sector.label}
                </button>
              ))}
              <span className="platform-bottomnav-divider" aria-hidden="true" />
              <button
                type="button"
                className={`platform-nav-pill platform-nav-pill--settings ${activeView === "configuracoes" ? "active" : ""}`}
                onClick={() => setActiveView("configuracoes")}
              >
                Configurações
                {currentUser.role === "admin" && pendingCount > 0 && (
                  <span className="platform-nav-badge">{pendingCount > 9 ? "9+" : pendingCount}</span>
                )}
              </button>
            </div>
            <div className="platform-bottomnav-actions">
              <span className="platform-bottomnav-user muted">
                {currentUser.username}
              </span>
              <button
                type="button"
                className="btn-secondary platform-bottomnav-logout"
                onClick={() => handleLogout().catch(() => null)}
              >
                Sair
              </button>
            </div>
          </nav>
          <span className="platform-bottomnav-hint" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
