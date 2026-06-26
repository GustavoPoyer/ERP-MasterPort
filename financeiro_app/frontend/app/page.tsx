"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useVirtualTableWindow } from "../lib/useVirtualTableWindow";
import {
  DATASET_MATCH_PAGE,
  DATASET_STATUS_PAGE,
  buildRunDatasetQuery,
  isRunDatasetComplete,
  mergeRunDatasetChunk,
} from "../lib/runDataset";
import Image from "next/image";
import { AuthPasswordField } from "../components/AuthPasswordField";
import { HomeDashboard } from "../components/HomeDashboard";
import { SettingsPanel } from "../components/SettingsPanel";
import {
  readSettingsTabFromLocation,
  settingsTabFromSlug,
  clearPlatformViewQuery,
  syncActiveViewUrl,
  syncSettingsUrl,
  type SettingsTab,
} from "../components/settings/settingsTabUrl";
import { KivoBootScreen, KIVO_BOOT_EXIT_MS, waitMinBootTime } from "../components/KivoBootScreen";
import { KivoAssistant } from "../components/KivoAssistant";
import { AutomationQueueModule } from "../components/AutomationQueueModule";
import { OperacoesPanel } from "../components/OperacoesPanel";
import { PedroKanban } from "../components/PedroKanban";
import { RhModule, RH_VIEW_LABELS, type RhView } from "../components/RhModule";

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
  id: number;
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
  direcao_movimento?: string;
};

type RunDataset = {
  metric: RunMetric | null;
  matches: MatchRow[];
  statuses: StatusRow[];
  statuses_total?: number;
  matches_total?: number;
  status_month_counts?: Record<string, number>;
};

type DocumentSlot = {
  key: "extrato" | "comprovantes" | "numerario";
  title: string;
  hint: string;
  required: boolean;
  allowMultiple: boolean;
};

type SectorKey = "financeiro" | "pedro" | "rh" | "operacoes";
type PlatformView = "inicio" | "configuracoes" | "fila" | SectorKey;
type OperationsView = "importacao" | "exportacao";
type AuthUser = {
  id: number;
  username: string;
  sector: string;
  role: string;
  display_name?: string;
  contact_email?: string;
  notify_email_pending?: boolean;
  notify_email_queue?: boolean;
  created_at?: string;
};

type ActiveUser = {
  id: number;
  username: string;
  display_name: string;
  contact_email: string;
  sector: string;
  role: string;
  created_at: string;
};

type AuditEntry = {
  id: number;
  actor_username: string;
  action: string;
  target_type: string;
  target_label: string;
  details: string;
  created_at: string;
};

type AppInfo = {
  api_version: string;
  environment: string;
  smtp_configured: boolean;
};

type PendingUser = {
  id: number;
  username: string;
  requested_sector: string;
  created_at: string;
};

type UserSession = {
  id: number;
  created_at: string;
  expires_at: string;
  is_current: boolean;
};

function resolveApiBase(): string {
  const envApiBase = process.env.NEXT_PUBLIC_API_BASE?.trim();
  const host =
    typeof window !== "undefined" && window.location?.hostname ? window.location.hostname : "localhost";
  if (envApiBase && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(envApiBase)) {
    return envApiBase.replace(/\/$/, "");
  }
  return `http://${host}:8000`;
}

const API_BASE = resolveApiBase();
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
      hint: "Obrigatório para PIX recebido: planilha de numerário com IDs 1803013, empresa e valor.",
      required: false,
      allowMultiple: true,
    },
  ],
};

const FILA_NAV = { key: "fila" as const, label: "Fila", subtitle: "Solicitações de automação" };

const SECTOR_MENU: { key: SectorKey; label: string; subtitle: string }[] = [
  { key: "financeiro", label: "Financeiro", subtitle: "Conciliações e caixa" },
  { key: "pedro", label: "Importação", subtitle: "Processos SigraWeb" },
  { key: "rh", label: "RH", subtitle: "Pessoal e folha" },
  { key: "operacoes", label: "Operações", subtitle: "Rotinas internas" },
];

const LANDING_SHOWCASE = [
  {
    key: "financeiro",
    label: "Financeiro",
    title: "Painel de conciliação",
    description: "Monte rodadas para Banco do Brasil e Itaú/SIGRA com upload de extratos e comprovantes.",
    src: "/brand/landing/financeiro-painel.png",
    alt: "Painel financeiro do KIVO com KPIs e montagem de rodada de conciliação",
  },
  {
    key: "execucoes",
    label: "Execuções",
    title: "Histórico e auditoria",
    description: "Acompanhe execuções, status, conciliações e logs técnicos em tempo real.",
    src: "/brand/landing/financeiro-execucoes.png",
    alt: "Tela de execuções e logs técnicos do módulo financeiro KIVO",
  },
] as const;

function platformPageTitle(view: PlatformView): string {
  if (view === "inicio") return "Início";
  if (view === "configuracoes") return "Configurações";
  if (view === "fila") return "Fila de Automações";
  if (view === "financeiro") return "Setor Financeiro";
  if (view === "pedro") return "Importação";
  if (view === "rh") return "RH";
  return "Setor de Operações";
}

function platformPageSubtitle(view: PlatformView): string {
  if (view === "inicio") return "Visão geral da plataforma KIVO";
  if (view === "configuracoes") return "Conta, segurança e preferências do ambiente";
  if (view === "fila") return FILA_NAV.subtitle;
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

const SIGRA_APP_BASE = "https://app.sigraweb.com";

function parseSigraProcessIds(ref: string | undefined | null): string[] {
  const raw = (ref || "").trim();
  if (!raw || raw === "-") return [];
  return [
    ...new Set(
      raw
        .split(/[,;/|]+/)
        .map((part) => part.trim())
        .filter((part) => /^\d+$/.test(part)),
    ),
  ];
}

function sigraProcessUrl(processId: string): string {
  return `${SIGRA_APP_BASE}/#/importacao/${processId}`;
}

function formatConciliacaoDisplay(value: string | undefined | null): string {
  const normalized = (value || "").trim();
  return normalized && normalized !== "-" ? normalized : "—";
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
  if (activeView === "fila") {
    return {
      title: "Fila de Automações",
      subtitle: "Solicitações · acompanhamento em tempo real",
      tag: "Central",
    };
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
  if (activeView === "pedro") {
    return {
      title: "Importação",
      subtitle: "Processos de Importação · SigraWeb",
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
  if (activeView === "pedro") {
    return "Processos de Importação — Importação — KIVO";
  }
  if (activeView === "fila") {
    return "Fila de Automações — KIVO";
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
        <path d="M4 7h16v10H4z" />
        <path d="M8 7V5h8v2" />
        <path d="M9 12h6" />
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

const STATUS_CONCILIADO = "✅ Conciliado";
const STATUS_PENDENTE = "❌ Pendente";

function normalizeConciliationStatus(status: string): string {
  const value = (status || "").toLowerCase();
  if (value.includes("conciliado")) return STATUS_CONCILIADO;
  if (value.includes("pendente")) return STATUS_PENDENTE;
  return status || STATUS_PENDENTE;
}

function inferDirecaoMovimento(row: StatusRow): "entrada" | "saida" | "" {
  const explicit = (row.direcao_movimento || "").trim().toLowerCase();
  if (explicit === "entrada" || explicit === "saida") {
    return explicit;
  }
  const desc = (row.favorecido_descricao || "").toUpperCase();
  if (/(RECEBIMENTO|RECEBIDO|CREDITO|CRÉDITO|PIX RECEBIDO)/.test(desc)) return "entrada";
  if (/(PAGAMENTO|ENVIADO|DEBITO|DÉBITO|SISPAG|PUCOMEX|AFRMM|TARIFA|IOF)/.test(desc)) return "saida";
  return "";
}

function parseValorInput(value: string): number {
  const cleaned = value.replace(/R\$/gi, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatValorInput(value: number): string {
  return Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ConciliacaoStatusPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const normalized = normalizeConciliationStatus(value);
  const isConciliado = normalized === STATUS_CONCILIADO;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function selectOption(next: string) {
    setOpen(false);
    if (next !== normalized) {
      onChange(next);
    }
  }

  return (
    <div ref={rootRef} className={`conciliacao-status-picker${open ? " is-open" : ""}`}>
      <button
        type="button"
        className={`conciliacao-status-trigger ${
          isConciliado ? "conciliacao-status-select--conciliado" : "conciliacao-status-select--pendente"
        }`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
      >
        <span>{normalized}</span>
        <span className="conciliacao-status-trigger-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="conciliacao-status-menu" role="listbox">
          <button
            type="button"
            className="conciliacao-status-option"
            role="option"
            aria-selected={isConciliado}
            onClick={() => selectOption(STATUS_CONCILIADO)}
          >
            {STATUS_CONCILIADO}
          </button>
          <button
            type="button"
            className="conciliacao-status-option"
            role="option"
            aria-selected={!isConciliado}
            onClick={() => selectOption(STATUS_PENDENTE)}
          >
            {STATUS_PENDENTE}
          </button>
        </div>
      )}
    </div>
  );
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
  const [bootExiting, setBootExiting] = useState(false);
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
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<number | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [notifyEmailPending, setNotifyEmailPending] = useState(true);
  const [notifyEmailQueue, setNotifyEmailQueue] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [activeUsersLoading, setActiveUsersLoading] = useState(false);
  const [adminUserSearch, setAdminUserSearch] = useState("");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
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
  const [rhView, setRhView] = useState<RhView>("overview");
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
    "geral" | "data" | "id_extrato" | "descricao" | "ref_sigra" | "cliente" | "status"
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
  const [statusEditError, setStatusEditError] = useState("");
  const [statusRowSaving, setStatusRowSaving] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [runsRefreshing, setRunsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [isBankSwitchPending, startBankSwitch] = useTransition();
  const planilhaScrollRef = useRef<HTMLDivElement>(null);
  const matchesScrollRef = useRef<HTMLDivElement>(null);
  const datasetCacheRef = useRef<Map<number, RunDataset>>(new Map());
  const datasetLoadingMoreRef = useRef(false);
  const selectedRunIdRef = useRef<number | null>(null);
  const [datasetLoadingMore, setDatasetLoadingMore] = useState(false);

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
    const serverCounts = dataset?.status_month_counts;
    if (serverCounts && Object.keys(serverCounts).length > 0) {
      const total = dataset?.statuses_total ?? Object.values(serverCounts).reduce((acc, n) => acc + n, 0);
      const keys = Object.keys(serverCounts).sort((a, b) => extratoTabOrder(a) - extratoTabOrder(b));
      return [
        { key: "todos", label: "Todos", count: total },
        ...keys.map((key) => ({ key, label: extratoTabLabelFromKey(key), count: serverCounts[key] ?? 0 })),
      ];
    }
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
  }, [allStatuses, dataset?.status_month_counts, dataset?.statuses_total]);
  const filteredStatuses = useMemo(() => {
    const rows = allStatuses;
    const needle = filterValue.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesMonth =
        selectedMonthKey === "todos" || extratoTabKeyFromRow(row) === selectedMonthKey;
      if (!needle) return matchesMonth;

      const matchesByField =
        filterField === "geral"
          ? `${row.extrato_id} ${row.data} ${row.favorecido_descricao} ${row.ref_sigra} ${row.cliente} ${row.status}`
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
                  : filterField === "cliente"
                    ? String(row.cliente || "").toLowerCase().includes(needle)
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
  const planilhaVirtual = useVirtualTableWindow(sortedStatuses.length, planilhaScrollRef);
  const visibleStatuses = useMemo(
    () => sortedStatuses.slice(planilhaVirtual.startIndex, planilhaVirtual.endIndex),
    [sortedStatuses, planilhaVirtual.endIndex, planilhaVirtual.startIndex],
  );
  const planilhaColSpan = bankView === "bb" ? 10 : 9;
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
  const matchesVirtual = useVirtualTableWindow(sortedMatches.length, matchesScrollRef, 44);
  const visibleMatches = useMemo(
    () => sortedMatches.slice(matchesVirtual.startIndex, matchesVirtual.endIndex),
    [sortedMatches, matchesVirtual.endIndex, matchesVirtual.startIndex],
  );

  const recentRuns = useMemo(() => runs.slice(0, 5), [runs]);

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
    setProfileDisplayName(data.display_name || "");
    setProfileEmail(data.contact_email || "");
    setNotifyEmailPending(data.notify_email_pending ?? true);
    setNotifyEmailQueue(data.notify_email_queue ?? false);
  }

  async function loadAppInfo() {
    try {
      const res = await fetch(`${API_BASE}/auth/app-info`, { cache: "no-store" });
      if (!res.ok) return;
      setAppInfo((await res.json()) as AppInfo);
    } catch {
      setAppInfo(null);
    }
  }

  async function loadActiveUsers(search = adminUserSearch) {
    setActiveUsersLoading(true);
    try {
      const q = search.trim();
      const path = q ? `/auth/admin/users?search=${encodeURIComponent(q)}` : "/auth/admin/users";
      const res = await apiFetch(path);
      if (!res.ok) throw new Error("Não foi possível carregar usuários.");
      setActiveUsers((await res.json()) as ActiveUser[]);
    } finally {
      setActiveUsersLoading(false);
    }
  }

  async function loadAuditLog() {
    setAuditLoading(true);
    try {
      const res = await apiFetch("/auth/admin/audit-log?limit=80");
      if (!res.ok) throw new Error("Não foi possível carregar auditoria.");
      setAuditLog((await res.json()) as AuditEntry[]);
    } finally {
      setAuditLoading(false);
    }
  }

  async function handleUpdateProfile(): Promise<string> {
    setProfileBusy(true);
    try {
      const res = await apiFetch("/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: profileDisplayName.trim(),
          contact_email: profileEmail.trim(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível salvar o perfil."));
      }
      const user = payload as AuthUser;
      setCurrentUser(user);
      setProfileDisplayName(user.display_name || "");
      setProfileEmail(user.contact_email || "");
      return "Perfil atualizado.";
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleUpdateNotifications(): Promise<string> {
    setProfileBusy(true);
    try {
      const res = await apiFetch("/auth/me/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notify_email_pending: notifyEmailPending,
          notify_email_queue: notifyEmailQueue,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível salvar preferências."));
      }
      const user = payload as AuthUser;
      setCurrentUser(user);
      setNotifyEmailPending(user.notify_email_pending ?? notifyEmailPending);
      setNotifyEmailQueue(user.notify_email_queue ?? notifyEmailQueue);
      return "Preferências de notificação salvas.";
    } finally {
      setProfileBusy(false);
    }
  }

  function applyAuthSuccess(accessToken: string, user: AuthUser | null) {
    setAuthToken(accessToken);
    setCurrentUser(user);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fin_access_token", accessToken);
      const viewFromUrl = new URLSearchParams(window.location.search).get("view");
      if (viewFromUrl === "fila") {
        setActiveView("fila");
      } else {
        setActiveView("inicio");
        clearPlatformViewQuery();
      }
    } else {
      setActiveView("inicio");
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
      const msg = e instanceof Error ? e.message : "Erro ao autenticar.";
      if (/failed to fetch|networkerror|load failed/i.test(msg)) {
        setAuthError(
          `Não foi possível conectar ao servidor (${API_BASE}). Inicie o backend com start_app.ps1 e recarregue a página.`,
        );
      } else {
        setAuthError(msg);
      }
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
      throw e instanceof Error ? e : new Error("Erro ao carregar aprovações.");
    } finally {
      setPendingUsersLoading(false);
    }
  }

  async function approvePendingUser(userId: number): Promise<string> {
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
      return "Cadastro aprovado.";
    } finally {
      setPendingActionId(null);
    }
  }

  async function rejectPendingUser(userId: number): Promise<string> {
    setPendingActionId(userId);
    try {
      const res = await apiFetch(`/auth/admin/users/${userId}/reject`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível recusar o cadastro."));
      }
      setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
      await loadPendingCount();
      return "Cadastro recusado.";
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
    setActiveSessions([]);
    setActiveView("inicio");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("fin_access_token");
      clearPlatformViewQuery();
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
    setSessionsLoading(true);
    try {
      const res = await apiFetch("/auth/sessions");
      if (!res.ok) throw new Error("Não foi possível carregar as sessões.");
      const data = (await res.json()) as UserSession[];
      setActiveSessions(data);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function revokeSession(sessionId: number): Promise<string> {
    setRevokingSessionId(sessionId);
    try {
      const res = await apiFetch(`/auth/sessions/${sessionId}`, { method: "DELETE" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível encerrar a sessão."));
      }
      await loadActiveSessions();
      return payload?.message || "Sessão encerrada.";
    } finally {
      setRevokingSessionId(null);
    }
  }

  const activeSessionCount = activeSessions.length;

  async function handleChangePassword(): Promise<string> {
    if (!changeCurrentPassword.trim() || !changeNewPassword.trim()) {
      throw new Error("Preencha a senha atual e a nova senha.");
    }
    if (changeNewPassword !== changeNewPasswordConfirm) {
      throw new Error("A confirmação da nova senha não confere.");
    }
    if (changeNewPassword.length < 6) {
      throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
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
      await loadActiveSessions();
      return payload?.message || "Senha alterada com sucesso.";
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleLogoutOtherSessions(): Promise<string> {
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordMessage("");
    try {
      const res = await apiFetch("/auth/logout-all", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiErrorDetail(payload?.detail, "Não foi possível encerrar outras sessões."));
      }
      await loadActiveSessions();
      return payload?.message || "Outras sessões encerradas.";
    } finally {
      setPasswordBusy(false);
    }
  }

  async function adminGenerateResetLink(): Promise<string> {
    const username = adminLookupUsername.trim();
    if (!username) {
      throw new Error("Informe o usuário para gerar o link.");
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
      return `Link gerado para ${linkPayload.username || user.username} (válido por 1 hora).`;
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
  }

  async function createFinanceAccount(): Promise<string> {
    const name = newAccountName.trim();
    if (!name) {
      throw new Error("Informe o nome da conta.");
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
      await loadFinanceAccounts({ includeInactive: true });
      if (payload.bank === bankView) {
        setSelectedAccountId(payload.id);
      }
      return `Conta "${payload.name}" criada.`;
    } catch (e) {
      await loadFinanceAccounts({ includeInactive: true }).catch(() => null);
      throw e;
    } finally {
      setAccountsBusy(false);
    }
  }

  async function reactivateFinanceAccount(accountId: number): Promise<string> {
    const account = financeAccounts.find((item) => item.id === accountId);
    if (!account) {
      throw new Error("Conta não encontrada.");
    }
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
      await loadFinanceAccounts({ includeInactive: true });
      return `Conta "${account.name}" reativada.`;
    } finally {
      setAccountsBusy(false);
    }
  }

  async function deactivateFinanceAccount(accountId: number): Promise<string> {
    const account = financeAccounts.find((item) => item.id === accountId);
    if (!account) {
      throw new Error("Conta não encontrada.");
    }
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
      await loadFinanceAccounts({ includeInactive: true });
      return `Conta "${account.name}" desativada.`;
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

  async function patchStatusRow(rowId: number, patch: Partial<StatusRow>) {
    if (!selectedRun?.id || isSelectedRunActive) return;
    setStatusEditError("");
    setStatusRowSaving((prev) => ({ ...prev, [rowId]: true }));
    try {
      const res = await apiFetch(`/runs/${selectedRun.id}/status-rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const detail = typeof payload?.detail === "string" ? payload.detail : "Não foi possível salvar a linha.";
        throw new Error(detail);
      }
      const updated = (await res.json()) as StatusRow;
      setDataset((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          statuses: prev.statuses.map((row) => (row.id === rowId ? { ...row, ...updated } : row)),
        };
        if (selectedRun?.id) {
          datasetCacheRef.current.set(selectedRun.id, next);
        }
        return next;
      });
    } catch (e) {
      setStatusEditError(e instanceof Error ? e.message : "Erro ao salvar alteração.");
    } finally {
      setStatusRowSaving((prev) => ({ ...prev, [rowId]: false }));
    }
  }

  async function fetchDatasetPage(
    runId: number,
    params: {
      status_offset: number;
      status_limit: number;
      match_offset: number;
      match_limit: number;
      include_month_counts?: boolean;
    },
  ): Promise<RunDataset> {
    const query = buildRunDatasetQuery(params);
    const res = await apiFetch(`/runs/${runId}/dataset?${query}`);
    if (!res.ok) {
      throw new Error("Dados da conciliação ainda não disponíveis para esta execução.");
    }
    return (await res.json()) as RunDataset;
  }

  async function loadRemainingDatasetPages(runId: number, seed: RunDataset) {
    if (datasetLoadingMoreRef.current || isRunDatasetComplete(seed)) return;
    datasetLoadingMoreRef.current = true;
    setDatasetLoadingMore(true);
    try {
      let merged: RunDataset = { ...seed, statuses: [...seed.statuses], matches: [...seed.matches] };
      const statusesTotal = merged.statuses_total ?? merged.statuses.length;
      const matchesTotal = merged.matches_total ?? merged.matches.length;

      while (merged.statuses.length < statusesTotal) {
        const chunk = await fetchDatasetPage(runId, {
          status_offset: merged.statuses.length,
          status_limit: DATASET_STATUS_PAGE,
          match_offset: 0,
          match_limit: 0,
          include_month_counts: false,
        });
        merged = mergeRunDatasetChunk(merged, chunk);
        datasetCacheRef.current.set(runId, merged);
        if (selectedRunIdRef.current === runId) {
          setDataset({ ...merged });
        }
      }

      while (merged.matches.length < matchesTotal) {
        const chunk = await fetchDatasetPage(runId, {
          status_offset: 0,
          status_limit: 0,
          match_offset: merged.matches.length,
          match_limit: DATASET_MATCH_PAGE,
          include_month_counts: false,
        });
        merged = mergeRunDatasetChunk(merged, chunk);
        datasetCacheRef.current.set(runId, merged);
        if (selectedRunIdRef.current === runId) {
          setDataset({ ...merged });
        }
      }
    } catch {
      // Mantém o que já foi carregado; usuário ainda vê a primeira página.
    } finally {
      datasetLoadingMoreRef.current = false;
      setDatasetLoadingMore(false);
    }
  }

  async function loadDataset(runId: number, runStatus?: string, options?: { force?: boolean }) {
    const runningOrQueued = ["running", "queued"].includes((runStatus || "").toLowerCase());
    const cached = datasetCacheRef.current.get(runId);
    if (!options?.force && !runningOrQueued && cached && isRunDatasetComplete(cached)) {
      setDataset(cached);
      return;
    }
    if (!options?.force && datasetLoadingMoreRef.current) {
      return;
    }

    try {
      setDatasetError("");
      if (cached) {
        setDataset(cached);
      }

      const firstPage = await fetchDatasetPage(runId, {
        status_offset: 0,
        status_limit: DATASET_STATUS_PAGE,
        match_offset: 0,
        match_limit: DATASET_MATCH_PAGE,
        include_month_counts: true,
      });
      datasetCacheRef.current.set(runId, firstPage);
      setDataset(firstPage);

      if (!isRunDatasetComplete(firstPage)) {
        void loadRemainingDatasetPages(runId, firstPage);
      }
    } catch (e) {
      if (runningOrQueued) {
        if (!cached) setDataset(null);
        return;
      }
      if (!datasetCacheRef.current.has(runId)) {
        setDataset(null);
      }
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
    let cancelled = false;

    async function bootstrapSession() {
      const startedAt = Date.now();

      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const resetFromUrl = params.get("reset");
        const viewFromUrl = params.get("view");
        if (resetFromUrl) {
          setResetToken(resetFromUrl);
          setGuestView("reset");
          window.history.replaceState({}, "", window.location.pathname);
        } else if (viewFromUrl === "fila") {
          setActiveView("fila");
        } else if (viewFromUrl === "configuracoes") {
          setActiveView("configuracoes");
          const tabFromUrl = settingsTabFromSlug(params.get("tab"));
          if (tabFromUrl) setSettingsTab(tabFromUrl);
        }

        const token = window.localStorage.getItem("fin_access_token");
        if (token) {
          setAuthToken(token);
          try {
            const res = await fetch(`${API_BASE}/auth/me`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            if (res.ok) {
              const data = (await res.json()) as AuthUser;
              if (!cancelled) {
                setCurrentUser(data);
                setProfileDisplayName(data.display_name || "");
                setProfileEmail(data.contact_email || "");
                setNotifyEmailPending(data.notify_email_pending ?? true);
                setNotifyEmailQueue(data.notify_email_queue ?? false);
              }
            } else {
              window.localStorage.removeItem("fin_access_token");
              if (!cancelled) {
                setAuthToken(null);
                setCurrentUser(null);
              }
            }
          } catch {
            window.localStorage.removeItem("fin_access_token");
            if (!cancelled) {
              setAuthToken(null);
              setCurrentUser(null);
            }
          }
        }
      }

      await waitMinBootTime(startedAt);
      if (!cancelled) {
        setBootExiting(true);
        await new Promise((resolve) => setTimeout(resolve, KIVO_BOOT_EXIT_MS));
      }
      if (!cancelled) setAuthReady(true);
    }

    bootstrapSession().catch(async () => {
      if (cancelled) return;
      setBootExiting(true);
      await new Promise((resolve) => setTimeout(resolve, KIVO_BOOT_EXIT_MS));
      if (!cancelled) setAuthReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authReady || !authToken || currentUser) return;
    loadCurrentUser().catch(() => {
      setAuthToken(null);
      setCurrentUser(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("fin_access_token");
      }
    });
  }, [authReady, authToken, currentUser]);

  useEffect(() => {
    if (!authReady || !authToken || currentUser?.role !== "admin") return;
    loadPendingCount().catch(() => null);
    const timer = window.setInterval(() => {
      loadPendingCount().catch(() => null);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [authReady, authToken, currentUser?.role]);

  useEffect(() => {
    if (!authReady || !authToken) return;
    loadAutomations().catch(() => setError("Erro ao carregar automações."));
    loadFinanceAccounts().catch(() => {
      setError("Erro ao carregar contas bancárias. Reinicie o backend e atualize a página.");
    });
  }, [authReady, authToken]);

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
  }, [authToken, isSelectedRunActive]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRun?.id ?? null;
  }, [selectedRun?.id]);

  useEffect(() => {
    if (!authToken) return;
    if (selectedRun?.id) {
      const cached = datasetCacheRef.current.get(selectedRun.id);
      if (cached) {
        setDataset(cached);
      } else {
        setDataset(null);
      }
      loadDataset(selectedRun.id, selectedRun.status).catch(() => null);
    } else {
      setDataset(null);
    }
  }, [selectedRun?.id, selectedRun?.status]);

  useEffect(() => {
    if (!authToken) return;
    if (!selectedRun?.id) return;
    const timer = setInterval(() => {
      const cached = datasetCacheRef.current.get(selectedRun.id);
      const running = ["running", "queued"].includes((selectedRun.status || "").toLowerCase());
      if (running || !cached || !isRunDatasetComplete(cached)) {
        loadDataset(selectedRun.id, selectedRun.status).catch(() => null);
      }
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
    planilhaScrollRef.current?.scrollTo(0, 0);
    matchesScrollRef.current?.scrollTo(0, 0);
  }, [selectedRun?.id, bankView]);

  useEffect(() => {
    if (activeView !== "configuracoes") return;
    setPasswordError("");
    setPasswordMessage("");
    setAdminError("");
    setAdminMessage("");
    loadActiveSessions().catch(() => null);
    loadAppInfo().catch(() => null);
    if (currentUser?.role === "admin") {
      loadPendingUsers().catch(() => null);
      loadPendingCount().catch(() => null);
      loadFinanceAccounts({ includeInactive: true }).catch(() => null);
      loadActiveUsers().catch(() => null);
      loadAuditLog().catch(() => null);
    }
  }, [activeView, currentUser?.role]);

  useEffect(() => {
    if (!authToken) return;
    syncActiveViewUrl(activeView, settingsTab);
  }, [activeView, settingsTab, authToken]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      if (view === "configuracoes") {
        setActiveView("configuracoes");
        const tab = readSettingsTabFromLocation();
        if (tab) setSettingsTab(tab);
      } else if (view === "fila") {
        setActiveView("fila");
      } else {
        setActiveView("inicio");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const scrollTop = { top: 0, behavior: "instant" as ScrollBehavior };
    document.querySelector(".platform-dashboard")?.scrollTo(scrollTop);
    document.querySelector(".platform-view-pane")?.scrollTo(scrollTop);
  }, [activeView]);

  useEffect(() => {
    document.documentElement.setAttribute("data-kivo-bg", authToken ? "ambient" : "degrade");
    if (authToken) {
      document.documentElement.setAttribute("data-kivo-layout", "fullscreen");
    } else {
      document.documentElement.removeAttribute("data-kivo-layout");
    }
  }, [authToken]);

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
    return <KivoBootScreen exiting={bootExiting} />;
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
            <a href="#lp-journey">Plataforma</a>
            <a href="#lp-modules">Módulos</a>
            <a href="#lp-login">Acesso</a>
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
                onClick={() => document.getElementById("lp-journey")?.scrollIntoView({ behavior: "smooth" })}
              >
                Ver a plataforma
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
              <div className="lp-screen-preview">
                <Image
                  src={LANDING_SHOWCASE[0].src}
                  alt={LANDING_SHOWCASE[0].alt}
                  width={640}
                  height={360}
                  className="lp-screen-preview-img"
                />
              </div>
            </article>
            <article className="lp-flow-step">
              <span className="lp-flow-index">02</span>
              <h3>Execute em um clique</h3>
              <p>Dispare a automação e acompanhe o status da execução sem trocar de tela.</p>
              <div className="lp-screen-preview">
                <Image
                  src={LANDING_SHOWCASE[0].src}
                  alt={LANDING_SHOWCASE[0].alt}
                  width={640}
                  height={360}
                  className="lp-screen-preview-img"
                />
              </div>
            </article>
            <article className="lp-flow-step">
              <span className="lp-flow-index">03</span>
              <h3>Analise e audite</h3>
              <p>Consulte logs, pendências e histórico consolidado com rastreabilidade ponta a ponta.</p>
              <div className="lp-screen-preview">
                <Image
                  src={LANDING_SHOWCASE[1].src}
                  alt={LANDING_SHOWCASE[1].alt}
                  width={640}
                  height={360}
                  className="lp-screen-preview-img"
                />
              </div>
            </article>
          </div>
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
      </main>
    );
  }

  return (
    <div className="platform-shell">
      <div className="platform-frame">
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
                        ? " platform-dashboard--rh"
                        : activeView === "pedro"
                          ? " platform-dashboard--pedro"
                          : activeView === "fila"
                            ? " platform-dashboard--fila"
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

            <div key={`view-${activeView}`} className={`platform-view-pane platform-view-pane--${activeView}`}>
        {activeView === "inicio" ? (
          <HomeDashboard
            username={currentUser.username}
            sectors={visibleSectors}
            filaLabel={FILA_NAV.label}
            filaSubtitle={FILA_NAV.subtitle}
            totals={totals}
            recentRuns={recentRuns}
            onSelectSector={setActiveView}
            onSelectFila={() => setActiveView("fila")}
          />
        ) : activeView === "configuracoes" ? (
          <SettingsPanel
            username={currentUser.username}
            roleLabel={roleLabel(currentUser.role)}
            sectorLabel={sectorLabel(currentUser.sector)}
            isAdmin={currentUser.role === "admin"}
            apiBase={API_BASE}
            activeSessionCount={activeSessionCount}
            sessions={activeSessions}
            sessionsLoading={sessionsLoading}
            revokingSessionId={revokingSessionId}
            onRevokeSession={revokeSession}
            tab={settingsTab}
            onTabChange={setSettingsTab}
            pendingCount={pendingCount}
            sectorMenu={SECTOR_MENU}
            sectorLabelFn={sectorLabel}
            apiFetch={apiFetch}
            profile={{
              displayName: profileDisplayName,
              contactEmail: profileEmail,
              createdAt: currentUser.created_at,
              busy: profileBusy,
              appInfo,
              notifyEmailPending,
              notifyEmailQueue,
              onDisplayNameChange: setProfileDisplayName,
              onContactEmailChange: setProfileEmail,
              onNotifyEmailPendingChange: setNotifyEmailPending,
              onNotifyEmailQueueChange: setNotifyEmailQueue,
              onSaveProfile: handleUpdateProfile,
              onSaveNotifications: handleUpdateNotifications,
            }}
            password={{
              current: changeCurrentPassword,
              next: changeNewPassword,
              confirm: changeNewPasswordConfirm,
              busy: passwordBusy,
              showCurrent: showAuthPassword,
              showNext: showNewPassword,
              showConfirm: showNewPasswordConfirm,
              onCurrentChange: setChangeCurrentPassword,
              onNextChange: setChangeNewPassword,
              onConfirmChange: setChangeNewPasswordConfirm,
              onToggleCurrent: () => setShowAuthPassword((prev) => !prev),
              onToggleNext: () => setShowNewPassword((prev) => !prev),
              onToggleConfirm: () => setShowNewPasswordConfirm((prev) => !prev),
              onSubmit: handleChangePassword,
              onLogoutOthers: handleLogoutOtherSessions,
            }}
            admin={{
              accounts: financeAccounts,
              accountsBusy,
              newBank: newAccountBank,
              newName: newAccountName,
              onNewBankChange: setNewAccountBank,
              onNewNameChange: setNewAccountName,
              onCreateAccount: createFinanceAccount,
              onDeactivateAccount: deactivateFinanceAccount,
              onReactivateAccount: reactivateFinanceAccount,
              pendingUsers,
              pendingLoading: pendingUsersLoading,
              pendingActionId,
              approvalSectorByUser,
              onApprovalSectorChange: (userId, sector) =>
                setApprovalSectorByUser((prev) => ({ ...prev, [userId]: sector })),
              onRefreshPending: loadPendingUsers,
              onApproveUser: approvePendingUser,
              onRejectUser: rejectPendingUser,
              lookupUsername: adminLookupUsername,
              onLookupUsernameChange: setAdminLookupUsername,
              resetLink: adminResetLink,
              resetLinkFor: adminResetLinkFor,
              busy: adminBusy,
              onGenerateResetLink: adminGenerateResetLink,
              activeUsers,
              activeUsersLoading,
              userSearch: adminUserSearch,
              onUserSearchChange: setAdminUserSearch,
              onRefreshUsers: () => loadActiveUsers(adminUserSearch),
              auditLog,
              auditLoading,
              onRefreshAudit: loadAuditLog,
            }}
            onLogout={handleLogout}
          />
        ) : activeView === "operacoes" ? (
          <OperacoesPanel
            apiFetch={apiFetch}
            operationsView={operationsView}
            onOperationsViewChange={setOperationsView}
            username={currentUser.username}
            isAdmin={currentUser.role === "admin"}
          />
        ) : activeView === "rh" ? (
          authToken ? <RhModule apiBase={API_BASE} authToken={authToken} /> : null
        ) : activeView === "pedro" ? (
          authToken ? <PedroKanban apiBase={API_BASE} authToken={authToken} /> : null
        ) : activeView === "fila" ? (
          authToken ? (
            <AutomationQueueModule
              apiBase={API_BASE}
              authToken={authToken}
              username={currentUser.username}
              userSector={currentUser.sector}
              isAdmin={currentUser.role === "admin"}
            />
          ) : null
        ) : activeView !== "financeiro" ? (
          <section className="panel platform-sector-empty">
            <h2>{SECTOR_MENU.find((item) => item.key === activeView)?.label} em breve</h2>
            <p className="subtitle">
              Este setor já está previsto na navegação. Quando quiser, eu estruturo as telas e fluxos deste módulo também.
            </p>
          </section>
        ) : (
          <main className="app-shell app-shell--financeiro">
      <div className="finance-stats" aria-label="Resumo das execuções">
        <div className="finance-stat">
          <span className="finance-stat-label">Total</span>
          <strong className="finance-stat-value">{totals.total}</strong>
        </div>
        <div className="finance-stat finance-stat--ok">
          <span className="finance-stat-label">Concluídas</span>
          <strong className="finance-stat-value">{totals.completed}</strong>
        </div>
        <div className="finance-stat finance-stat--run">
          <span className="finance-stat-label">Em andamento</span>
          <strong className="finance-stat-value">{totals.running}</strong>
        </div>
        <div className="finance-stat finance-stat--err">
          <span className="finance-stat-label">Com erro</span>
          <strong className="finance-stat-value">{totals.failed}</strong>
        </div>
      </div>

      <section className="panel finance-panel finance-panel--setup">
        <div className="finance-toolbar">
          <div className="finance-toolbar-group">
            <span className="finance-toolbar-label">Banco</span>
            <div className="tab-row finance-tab-row">
              <button
                type="button"
                className={`tab-btn ${bankView === "bb" ? "active" : ""}`}
                disabled={isBankSwitchPending}
                onClick={() => startBankSwitch(() => setBankView("bb"))}
              >
                BB ({runCountsByBank.bb})
              </button>
              <button
                type="button"
                className={`tab-btn ${bankView === "itau_sigra" ? "active" : ""}`}
                disabled={isBankSwitchPending}
                onClick={() => startBankSwitch(() => setBankView("itau_sigra"))}
              >
                Itaú / SIGRA ({runCountsByBank.itau_sigra})
              </button>
            </div>
          </div>
          <div className="finance-toolbar-group finance-toolbar-group--account">
            <span className="finance-toolbar-label">Conta</span>
            <div className="tab-row finance-tab-row finance-account-tabs">
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
                <span className="muted finance-toolbar-empty">
                  {inactiveAccountsForBank.length > 0
                    ? "Contas inativas — reative em Configurações."
                    : "Nenhuma conta ativa."}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="doc-grid doc-grid--compact">
          {slotConfig.map((slot) => (
            <article className="doc-card doc-card--compact" key={slot.key} title={slot.hint}>
              <div className="doc-head">
                <h3>{slot.title}</h3>
                <span className={`doc-badge ${slot.required ? "required" : "optional"}`}>
                  {slot.required ? "Obrigatório" : "Opcional"}
                </span>
              </div>
              <div className="doc-actions">
                <label className="upload-btn upload-btn--compact">
                  Anexar
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
                  className="btn-secondary btn-secondary--compact"
                  onClick={() => clearSlot(slot.key)}
                  disabled={(filesBySlot[slot.key]?.length ?? 0) === 0}
                >
                  Limpar
                </button>
              </div>
              <div className="file-list file-list--compact">
                {(filesBySlot[slot.key] ?? []).length === 0 ? (
                  <span className="muted">Nenhum arquivo</span>
                ) : (
                  (filesBySlot[slot.key] ?? []).map((f, idx) => (
                    <div className="file-chip" key={`${slot.key}-${f.name}-${idx}`}>
                      {f.name}
                      <button type="button" onClick={() => removeFile(slot.key, idx)} aria-label="Remover">
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="run-toolbar finance-run-toolbar">
          <span className="muted">{flattenedFiles.length} arquivo(s) prontos</span>
          <div className="control-row">
            <button
              type="button"
              className="btn-primary"
              onClick={triggerRun}
              disabled={
                loading || !selectedAccountId || flattenedFiles.length === 0 || hasMissingRequiredDocs
              }
            >
              {loading ? "Disparando…" : "Executar conciliação"}
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
              Limpar montagem
            </button>
          </div>
        </div>
        {hasMissingRequiredDocs && (
          <p className="finance-inline-hint">Anexe os arquivos obrigatórios para executar.</p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel finance-panel finance-panel--runs">
        <div className="finance-panel-head">
          <h2>Execuções</h2>
          <div className="control-row finance-panel-actions">
            <button
              type="button"
              className="btn-secondary btn-secondary--compact"
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
            <button type="button" className="btn-secondary btn-secondary--compact" onClick={clearAllRuns} disabled={loading}>
              Limpar histórico
            </button>
          </div>
        </div>

        {selectedRun && (
          <div className="finance-selected-banner">
            <div className="finance-selected-meta">
              <strong>#{selectedRun.id}</strong>
              <span>{selectedRun.account_name || selectedRun.automation_key}</span>
              <span className={statusClass(selectedRun.status)}>{selectedRun.status}</span>
              <span className="muted">
                {new Date(selectedRun.updated_at).toLocaleString("pt-BR")} · {selectedRun.triggered_by}
              </span>
            </div>
            {selectedRun.status === "completed" && selectedRun.output_path ? (
              <button
                type="button"
                className="btn-primary btn-primary--compact"
                disabled={downloadBusy}
                onClick={() => downloadRunExcel(selectedRun.id).catch(() => null)}
              >
                {downloadBusy ? "Baixando…" : "Baixar Excel"}
              </button>
            ) : null}
          </div>
        )}

        <div className="table-wrapper finance-runs-table">
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
          <p className="finance-inline-hint">
            Nenhuma execução neste banco — troque a aba BB / Itaú.
          </p>
        )}
      </section>

      <section className="panel finance-panel finance-panel--analysis">
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
            Conciliações ({dataset?.matches_total ?? allMatches.length})
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
            {datasetError && <p className="error">{datasetError}</p>}
            {!dataset && !datasetError && (
              <p className="finance-inline-hint">
                {selectedRun?.status === "running" || selectedRun?.status === "queued"
                  ? "Conciliação em andamento…"
                  : "Selecione uma execução para ver os dados."}
              </p>
            )}
            {dataset && (
              <>
                <div className="finance-dataset-stats">
                  <span>
                    <strong>{dataset.metric?.total_extrato ?? 0}</strong> extratos
                  </span>
                  <span>
                    <strong>{dataset.metric?.total_extratos_conciliados ?? 0}</strong> conciliados
                  </span>
                  <span>
                    <strong>{dataset.metric?.total_pendentes_status ?? 0}</strong> pendentes
                  </span>
                  <span>
                    Saldo{" "}
                    <strong>
                      {balanceSummary.saldo.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </strong>
                  </span>
                </div>

                <div className="tab-row month-tabs finance-month-tabs">
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
                <div className="filter-row finance-filter-row">
                  <select value={filterField} onChange={(e) => setFilterField(e.target.value as typeof filterField)}>
                    <option value="geral">Filtro geral</option>
                    <option value="data">Data</option>
                    <option value="id_extrato">ID Extrato</option>
                    <option value="descricao">Descrição / Histórico</option>
                    <option value="cliente">Cliente</option>
                    <option value="ref_sigra">Processo / Ref. Sigra</option>
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
                            : filterField === "cliente"
                              ? "Digite o nome do cliente"
                              : filterField === "ref_sigra"
                                ? "Digite o processo ou Ref. Sigra"
                                : filterField === "status"
                                ? "Digite o status (conciliado/pendente)"
                                : "Digite para filtrar em todas as colunas"
                    }
                    value={filterValue}
                    onChange={setFilterValue}
                  />
                </div>
                <p className="finance-inline-hint">
                  {sortedStatuses.length} linha(s) exibida(s)
                  {dataset.statuses_total && dataset.statuses_total > dataset.statuses.length
                    ? ` · carregadas ${dataset.statuses.length} de ${dataset.statuses_total}`
                    : ""}
                  {datasetLoadingMore ? " · carregando mais em segundo plano…" : ""}
                  {" · edite na tabela; salva automaticamente."}
                </p>
                {statusEditError && <p className="error">{statusEditError}</p>}
                <div className="table-wrapper table-wrapper--scroll planilha-table-scroll" ref={planilhaScrollRef}>
                  <table className="conciliacao-edit-table">
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
                        <th>Cliente</th>
                        <th>Processo / Ref. Sigra</th>
                        <th>Status</th>
                        <th>Observação</th>
                        <th>Qtd Comp.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planilhaVirtual.topSpacerHeight > 0 && (
                        <tr className="conciliacao-virtual-spacer" aria-hidden="true">
                          <td
                            colSpan={planilhaColSpan}
                            style={{ height: planilhaVirtual.topSpacerHeight, padding: 0, border: 0 }}
                          />
                        </tr>
                      )}
                      {visibleStatuses.map((s, idx) => {
                        const rowIndex = planilhaVirtual.startIndex + idx;
                        const direcao = inferDirecaoMovimento(s);
                        const rowBusy = Boolean(statusRowSaving[s.id]);
                        const canEdit = Boolean(s.id) && !isSelectedRunActive;
                        const sigraProcessIds = parseSigraProcessIds(s.ref_sigra);
                        return (
                          <tr
                            key={
                              s.id
                                ? `status-${s.id}-${rowIndex}`
                                : `${s.sheet_name}-${s.extrato_id}-${s.aba_extrato ?? ""}-${rowIndex}`
                            }
                            className={rowBusy ? "conciliacao-row-saving" : undefined}
                          >
                            {bankView === "bb" && (
                              <td>{s.aba_extrato ? extratoTabLabelFromKey(extratoTabKeyFromRow(s)) : "-"}</td>
                            )}
                            <td>{s.extrato_id}</td>
                            <td>
                              <input
                                className="conciliacao-cell-input conciliacao-cell-input--date"
                                defaultValue={s.data}
                                disabled={!canEdit}
                                onBlur={(e) => {
                                  if (!canEdit || e.target.value === s.data) return;
                                  patchStatusRow(s.id, { data: e.target.value });
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="conciliacao-cell-input"
                                defaultValue={s.favorecido_descricao}
                                disabled={!canEdit}
                                onBlur={(e) => {
                                  if (!canEdit || e.target.value === s.favorecido_descricao) return;
                                  patchStatusRow(s.id, { favorecido_descricao: e.target.value });
                                }}
                              />
                            </td>
                            <td>
                              <div className="conciliacao-valor-cell">
                                <button
                                  type="button"
                                  className={`conciliacao-direcao-btn conciliacao-direcao-btn--${direcao || "neutro"}`}
                                  title={
                                    direcao === "entrada"
                                      ? "Entrou na conta (clique para alternar)"
                                      : direcao === "saida"
                                        ? "Saiu da conta (clique para alternar)"
                                        : "Definir se entrou ou saiu"
                                  }
                                  disabled={!canEdit}
                                  onClick={() => {
                                    if (!canEdit) return;
                                    const next = direcao === "entrada" ? "saida" : "entrada";
                                    patchStatusRow(s.id, { direcao_movimento: next });
                                  }}
                                >
                                  {direcao === "entrada" ? "↑" : direcao === "saida" ? "↓" : "↕"}
                                </button>
                                <input
                                  className="conciliacao-cell-input conciliacao-cell-input--valor"
                                  defaultValue={formatValorInput(s.valor_extrato)}
                                  disabled={!canEdit}
                                  onBlur={(e) => {
                                    if (!canEdit) return;
                                    const nextValor = parseValorInput(e.target.value);
                                    if (nextValor === Number(s.valor_extrato || 0)) return;
                                    patchStatusRow(s.id, { valor_extrato: nextValor });
                                  }}
                                />
                              </div>
                            </td>
                            <td className="conciliacao-cliente-cell" title={s.cliente || undefined}>
                              {formatConciliacaoDisplay(s.cliente)}
                            </td>
                            <td className="conciliacao-processo-cell">
                              <input
                                className="conciliacao-cell-input"
                                defaultValue={s.ref_sigra === "-" ? "" : s.ref_sigra}
                                disabled={!canEdit}
                                placeholder="-"
                                onBlur={(e) => {
                                  if (!canEdit) return;
                                  const nextRef = e.target.value.trim() || "-";
                                  if (nextRef === (s.ref_sigra || "-")) return;
                                  patchStatusRow(s.id, { ref_sigra: nextRef });
                                }}
                              />
                              {sigraProcessIds.length > 0 && (
                                <div className="conciliacao-sigra-links">
                                  {sigraProcessIds.map((processId) => (
                                    <a
                                      key={processId}
                                      className="conciliacao-sigra-link"
                                      href={sigraProcessUrl(processId)}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={`Abrir processo ${processId} no Sigra`}
                                    >
                                      Sigra #{processId}
                                    </a>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td>
                              <ConciliacaoStatusPicker
                                value={s.status}
                                disabled={!canEdit}
                                onChange={(next) => patchStatusRow(s.id, { status: next })}
                              />
                            </td>
                            <td>
                              <input
                                className="conciliacao-cell-input"
                                defaultValue={s.observacao}
                                disabled={!canEdit}
                                onBlur={(e) => {
                                  if (!canEdit || e.target.value === (s.observacao || "")) return;
                                  patchStatusRow(s.id, { observacao: e.target.value });
                                }}
                              />
                            </td>
                            <td>{s.qtd_comprovantes}</td>
                          </tr>
                        );
                      })}
                      {planilhaVirtual.bottomSpacerHeight > 0 && (
                        <tr className="conciliacao-virtual-spacer" aria-hidden="true">
                          <td
                            colSpan={planilhaColSpan}
                            style={{ height: planilhaVirtual.bottomSpacerHeight, padding: 0, border: 0 }}
                          />
                        </tr>
                      )}
                      {sortedStatuses.length === 0 && (
                        <tr>
                          <td colSpan={planilhaColSpan}>Sem linhas para os filtros selecionados.</td>
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
            {datasetError && <p className="error">{datasetError}</p>}
            {!dataset && !datasetError && (
              <p className="finance-inline-hint">
                {selectedRun?.status === "running" || selectedRun?.status === "queued"
                  ? "Conciliação em andamento…"
                  : "Selecione uma execução para ver as linhas conciliadas."}
              </p>
            )}
            {dataset && (
              <>
                <div className="filter-row finance-filter-row">
                  <select value={filterField} onChange={(e) => setFilterField(e.target.value as typeof filterField)}>
                    <option value="geral">Filtro geral</option>
                    <option value="data">Data</option>
                    <option value="id_extrato">ID Extrato</option>
                    <option value="descricao">Categoria / Cliente</option>
                    <option value="ref_sigra">Processo / Ref. Sigra</option>
                  </select>
                  <FilterSearchInput
                    placeholder="Filtrar conciliações…"
                    value={filterValue}
                    onChange={setFilterValue}
                  />
                </div>
                <p className="finance-inline-hint">
                  {sortedMatches.length} de {allMatches.length} linha(s) conciliada(s)
                </p>
                <div className="table-wrapper table-wrapper--scroll planilha-table-scroll" ref={matchesScrollRef}>
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
                        <th>Processo / Ref. Sigra</th>
                        <th>Categoria</th>
                        <th>Cliente</th>
                        <th>Origem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchesVirtual.topSpacerHeight > 0 && (
                        <tr className="conciliacao-virtual-spacer" aria-hidden="true">
                          <td colSpan={10} style={{ height: matchesVirtual.topSpacerHeight, padding: 0, border: 0 }} />
                        </tr>
                      )}
                      {visibleMatches.map((m, idx) => {
                        const rowIndex = matchesVirtual.startIndex + idx;
                        const sigraProcessIds = parseSigraProcessIds(m.ref_sigra);
                        return (
                        <tr key={`${m.extrato_id}-${m.comprovante_id}-${rowIndex}`}>
                          <td>{m.extrato_id}</td>
                          <td>{m.data_extrato}</td>
                          <td>{m.valor_extrato.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                          <td>{m.comprovante_id}</td>
                          <td>{m.data_comprovante}</td>
                          <td>{m.valor_comprovante.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                          <td className="conciliacao-processo-cell">
                            <span>{formatConciliacaoDisplay(m.ref_sigra)}</span>
                            {sigraProcessIds.length > 0 && (
                              <div className="conciliacao-sigra-links">
                                {sigraProcessIds.map((processId) => (
                                  <a
                                    key={processId}
                                    className="conciliacao-sigra-link"
                                    href={sigraProcessUrl(processId)}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={`Abrir processo ${processId} no Sigra`}
                                  >
                                    Sigra #{processId}
                                  </a>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>{m.categoria || "-"}</td>
                          <td>{formatConciliacaoDisplay(m.cliente)}</td>
                          <td>{m.origem || "-"}</td>
                        </tr>
                        );
                      })}
                      {matchesVirtual.bottomSpacerHeight > 0 && (
                        <tr className="conciliacao-virtual-spacer" aria-hidden="true">
                          <td colSpan={10} style={{ height: matchesVirtual.bottomSpacerHeight, padding: 0, border: 0 }} />
                        </tr>
                      )}
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
            {selectedRun ? (
              <>
                <p className="finance-inline-hint">
                  Execução #{selectedRun.id} · {selectedRun.automation_key} ·{" "}
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
              <button
                type="button"
                className={`platform-nav-pill ${activeView === "fila" ? "active" : ""}`}
                onClick={() => setActiveView("fila")}
              >
                {FILA_NAV.label}
              </button>
              <span className="platform-bottomnav-divider" aria-hidden="true" />
              <button
                type="button"
                className={`platform-nav-pill platform-nav-pill--settings ${activeView === "configuracoes" ? "active" : ""}`}
                onClick={() => {
                  setActiveView("configuracoes");
                  syncSettingsUrl(settingsTab);
                }}
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
