"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

type AutomationInfo = {
  key: string;
  name: string;
  description: string;
};

type Run = {
  id: number;
  automation_key: string;
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
type OperationsView = "importacao" | "exportacao";
type AuthUser = {
  id: number;
  username: string;
  sector: string;
  role: string;
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

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("completed")) return "status-pill status-completed";
  if (s.includes("running")) return "status-pill status-running";
  if (s.includes("failed")) return "status-pill status-failed";
  return "status-pill status-queued";
}

function monthKeyFromDate(dateValue: string): string {
  const raw = (dateValue || "").trim();
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "sem-data";
  return `${m[3]}-${m[2]}`;
}

function monthLabelFromKey(key: string): string {
  if (key === "sem-data") return "Sem data";
  const [year, month] = key.split("-");
  const mm = Number(month);
  const yy = year?.slice(-2) || "";
  const labels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${labels[(mm || 1) - 1] || "Mês"} ${yy}`;
}

function parseBrDateToTs(dateValue: string): number {
  const raw = (dateValue || "").trim();
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return Number.NEGATIVE_INFINITY;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

export default function HomePage() {
  const [authReady, setAuthReady] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [hideLandingTopbar, setHideLandingTopbar] = useState(false);
  const [activeSector, setActiveSector] = useState<SectorKey>("financeiro");
  const [operationsView, setOperationsView] = useState<OperationsView>("importacao");
  const [automations, setAutomations] = useState<AutomationInfo[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [bankView, setBankView] = useState<"bb" | "itau_sigra">("bb");
  const [analysisView, setAnalysisView] = useState<"planilha" | "log">("planilha");
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
  const [error, setError] = useState("");

  const filteredRuns = useMemo(
    () => runs.filter((r) => r.automation_key === bankView),
    [runs, bankView],
  );
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
  const statusesWithoutSaldo = useMemo(() => {
    const rows = dataset?.statuses ?? [];
    return rows.filter((row) => {
      const searchable = `${row.extrato_id} ${row.favorecido_descricao}`.toLowerCase();
      return !searchable.includes("saldo");
    });
  }, [dataset?.statuses]);
  const monthTabs = useMemo(() => {
    const values = statusesWithoutSaldo;
    const map = new Map<string, number>();
    values.forEach((row) => {
      const key = monthKeyFromDate(row.data);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    const keys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1));
    return [
      { key: "todos", label: "Todos", count: values.length },
      ...keys.map((key) => ({ key, label: monthLabelFromKey(key), count: map.get(key) ?? 0 })),
    ];
  }, [statusesWithoutSaldo]);
  const filteredStatuses = useMemo(() => {
    const rows = statusesWithoutSaldo;
    const needle = filterValue.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesMonth = selectedMonthKey === "todos" || monthKeyFromDate(row.data) === selectedMonthKey;
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
  }, [filterField, filterValue, selectedMonthKey, statusesWithoutSaldo]);
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
    const rows = statusesWithoutSaldo;
    const totalExtratos = rows.reduce((acc, row) => acc + Number(row.valor_extrato || 0), 0);
    const totalComprovantes = rows.reduce((acc, row) => acc + Number(row.valor_total_conciliado || 0), 0);
    return {
      totalExtratos,
      totalComprovantes,
      saldo: totalExtratos - totalComprovantes,
    };
  }, [statusesWithoutSaldo]);

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
        throw new Error(payload?.detail || "Falha ao autenticar.");
      }
      setAuthToken(payload.access_token);
      setCurrentUser(payload.user || null);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("fin_access_token", payload.access_token);
      }
      setLoginPassword("");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Erro ao autenticar.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    setAuthToken(null);
    setCurrentUser(null);
    setAuthError("");
    setRuns([]);
    setDataset(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("fin_access_token");
    }
  }

  function toggleStatusSort(field: "data" | "valor") {
    setStatusSort((prev) =>
      prev.field === field
        ? { field, direction: prev.direction === "desc" ? "asc" : "desc" }
        : { field, direction: "desc" },
    );
  }

  async function loadAutomations() {
    const res = await apiFetch("/automations");
    if (!res.ok) throw new Error("Erro ao carregar automações.");
    const data = await res.json();
    setAutomations(data);
  }

  async function loadRuns() {
    const res = await apiFetch("/runs");
    if (!res.ok) throw new Error("Erro ao carregar execuções.");
    const data = await res.json();
    setRuns(data);
    if (data.length > 0 && !selectedRunId) {
      setSelectedRunId(data[0].id);
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
    const bankLabel = bankView === "bb" ? "Banco do Brasil" : "Itaú / SIGRA";
    const ok = window.confirm(`Tem certeza que deseja apagar o histórico de execuções de ${bankLabel}?`);
    if (!ok) return;
    const targetRuns = runs.filter((run) => run.automation_key === bankView);
    if (targetRuns.length === 0) {
      setError(`Não há execuções de ${bankLabel} para limpar.`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      for (const run of targetRuns) {
        const res = await apiFetch(`/runs/${run.id}`, { method: "DELETE" });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.detail || `Falha ao limpar histórico de ${bankLabel}.`);
        }
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
    }
    setAuthReady(true);
  }, []);

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
  }, [authToken]);

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
  }, [isSelectedRunActive]);

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
    if (typeof window === "undefined") return;
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
    return (
      <main className="lp-shell">
        <header className={`lp-topbar ${hideLandingTopbar ? "lp-topbar--hidden" : ""}`}>
          <div className="lp-brand">
            <Image src="/brand/logo-completa-rbg.png" alt="MasterPort" width={460} height={110} className="lp-brand-logo" />
          </div>
          <nav className="lp-nav">
            <span>Módulos</span>
            <span>Plataforma</span>
            <span>Governança</span>
          </nav>
          <span className="lp-login-tag">Entrar -&gt;</span>
        </header>

        <section className="lp-hero-grid">
          <article className="lp-hero-copy">
            <span className="lp-kicker">
              <span className="lp-kicker-dot" />
              Comércio Exterior + Financeiro
            </span>
            <h1>O ERP que move sua operação global.</h1>
            <p>
              MasterPort centraliza processos de Comex, automatiza conciliações bancárias (Banco do Brasil e Itaú/
              SIGRA) e dá visibilidade ponta a ponta em uma plataforma única, segura e pronta para escalar por todos
              os setores.
            </p>
            <div className="lp-cta-row">
              <button type="button" className="lp-btn-primary">
                Acessar o sistema
              </button>
              <button type="button" className="lp-btn-ghost">
                Conhecer os módulos
              </button>
            </div>
          </article>

          <article className="lp-login-card">
            <div className="login-hero">
              <span className="lp-access-tag">Acesso restrito</span>
              <h2>Entrar no MasterPort</h2>
              <p>Use suas credenciais corporativas.</p>
            </div>
            <div className="login-form">
              <label className="login-label" htmlFor="login-username">
                Usuário
              </label>
              <input
                id="login-username"
                type="text"
                placeholder="nome.sobrenome"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                autoComplete="username"
              />
              <div className="lp-password-row">
                <label className="login-label" htmlFor="login-password">
                  Senha
                </label>
                <button type="button" className="lp-forgot-btn">
                  Esqueceu?
                </button>
              </div>
              <input
                id="login-password"
                type="password"
                placeholder="Digite sua senha"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin().catch(() => null);
                }}
              />
              <button
                type="button"
                className="lp-login-submit"
                onClick={() => handleLogin().catch(() => null)}
                disabled={authLoading}
              >
                {authLoading ? "Entrando..." : "Entrar"}
              </button>
              {authError && <p className="error">{authError}</p>}
            </div>
            <p className="login-help">Ambiente monitorado. Todas as ações de login são registradas para auditoria.</p>
          </article>
        </section>

        <section className="lp-module-grid">
          <article className="lp-module-card">
            <span className="lp-metric-icon">+</span>
            <h3>Menos trabalho manual</h3>
            <p>Conciliações que levavam horas em planilhas, executadas em minutos.</p>
          </article>
          <article className="lp-module-card">
            <span className="lp-metric-icon">o</span>
            <h3>Visibilidade total</h3>
            <p>Logs de execução, histórico de cargas e status em tempo real.</p>
          </article>
          <article className="lp-module-card">
            <span className="lp-metric-icon">#</span>
            <h3>Governanca auditada</h3>
            <p>Rastreabilidade ponta a ponta com controle de acesso por papel.</p>
          </article>
        </section>

        <section className="lp-flow-section">
          <div className="lp-flow-header">
            <span className="lp-flow-kicker">Como funciona na prática</span>
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
            </article>
            <article className="lp-flow-step">
              <span className="lp-flow-index">02</span>
              <h3>Execute em um clique</h3>
              <p>Dispare a automação e acompanhe o status da execução sem trocar de tela.</p>
            </article>
            <article className="lp-flow-step">
              <span className="lp-flow-index">03</span>
              <h3>Analise e audite</h3>
              <p>Consulte logs, pendências e histórico consolidado com rastreabilidade ponta a ponta.</p>
            </article>
          </div>

          <div className="lp-flow-showcase">
            <article className="lp-flow-panel">
              <h4>Visão Operacional</h4>
              <p>KPIs e filas em tempo real para saber exatamente onde agir.</p>
            </article>
            <article className="lp-flow-panel">
              <h4>Governança</h4>
              <p>Controle por perfil, trilha de ações e contexto completo para auditoria.</p>
            </article>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <div className="brand-block">
          <Image src="/brand/logo-simples.png" alt="Símbolo MasterPort" width={64} height={64} className="brand-logo-icon" />
          <div className="brand-subtitle">Aplicativos por setor</div>
        </div>
        <nav className="sector-nav">
          {SECTOR_MENU.map((sector) => (
            <button
              key={sector.key}
              type="button"
              className={`sector-btn ${activeSector === sector.key ? "active" : ""}`}
              onClick={() => setActiveSector(sector.key)}
            >
              <span>{sector.label}</span>
              <small>{sector.subtitle}</small>
            </button>
          ))}
        </nav>
      </aside>

      <div className="platform-main">
        <header className="platform-topbar">
          <div>
            <h1 className="platform-title">
              {activeSector === "financeiro"
                ? "Setor Financeiro"
                : activeSector === "pedro"
                  ? "Setor Pedro"
                  : activeSector === "rh"
                    ? "Setor RH"
                    : "Setor de Operações"}
            </h1>
            <p className="platform-subtitle">Navegação preparada para múltiplos módulos dentro do mesmo aplicativo.</p>
          </div>
          <span className="platform-tag">Módulo ativo</span>
          <div className="control-row">
            <span className="muted">
              {currentUser.username} ({currentUser.role})
            </span>
            <button type="button" className="btn-secondary" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </header>

        {activeSector === "operacoes" && (
          <nav className="module-subnav">
            <button
              type="button"
              className={`module-subnav-btn ${operationsView === "importacao" ? "active" : ""}`}
              onClick={() => setOperationsView("importacao")}
            >
              Importação
            </button>
            <button
              type="button"
              className={`module-subnav-btn ${operationsView === "exportacao" ? "active" : ""}`}
              onClick={() => setOperationsView("exportacao")}
            >
              Exportação
            </button>
          </nav>
        )}

        {activeSector !== "financeiro" ? (
          <section className="panel app-shell">
            {activeSector === "operacoes" ? (
              <>
                <h2>Painel de Operações</h2>
                <p className="subtitle">Escolha o fluxo de Comércio Exterior que deseja operar neste módulo.</p>
                {operationsView === "importacao" ? (
                  <p className="info-note">
                    Fluxo de <b>Importação</b> selecionado. Aqui você pode acompanhar processos de compras internacionais,
                    desembaraço aduaneiro e nacionalização.
                  </p>
                ) : (
                  <p className="info-note">
                    Fluxo de <b>Exportação</b> selecionado. Aqui você pode acompanhar embarques internacionais, documentação,
                    compliance e fechamento cambial.
                  </p>
                )}
              </>
            ) : (
              <>
                <h2>{SECTOR_MENU.find((item) => item.key === activeSector)?.label} em breve</h2>
                <p className="subtitle">
                  Este setor já está previsto na navegação. Quando quiser, eu estruturo as telas e fluxos deste módulo também.
                </p>
              </>
            )}
          </section>
        ) : (
          <main className="app-shell">
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
        <p className="subtitle" style={{ marginBottom: 12 }}>
          {automations.find((a) => a.key === bankView)?.description ||
            (bankView === "bb"
              ? "Executa a rotina de conciliação Banco do Brasil."
              : "Executa a rotina de conciliação Itaú com SIGRA/Numerário.")}
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
              onClick={triggerRun}
              disabled={loading || flattenedFiles.length === 0 || hasMissingRequiredDocs}
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
          <p className="subtitle">Execuções filtradas para {bankView === "bb" ? "Banco do Brasil" : "Itaú / SIGRA"}.</p>
          <div className="control-row" style={{ marginBottom: 10 }}>
            <button type="button" className="btn-secondary" onClick={() => loadRuns().catch(() => null)} disabled={loading}>
              Atualizar
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
                  <th>Automação</th>
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
                    <td>{run.automation_key}</td>
                    <td>
                      <span className={statusClass(run.status)}>{run.status}</span>
                    </td>
                    <td>{run.triggered_by}</td>
                    <td>{new Date(run.updated_at).toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
                {filteredRuns.length === 0 && (
                  <tr>
                    <td colSpan={5}>Sem execuções para este banco.</td>
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
                Execução #{selectedRun.id} • {selectedRun.automation_key} •{" "}
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
              {selectedRun.output_path ? (
                <p className="output-path">
                  <b>Arquivo de saída:</b> {selectedRun.output_path}
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
            Planilha
          </button>
          <button
            type="button"
            className={`tab-btn ${analysisView === "log" ? "active" : ""}`}
            onClick={() => setAnalysisView("log")}
          >
            Log Técnico
          </button>
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
                  Exibição consolidada do extrato com status de conciliação, Ref. Sigra e descrição/histórico.
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
                  <input
                    type="text"
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
                    onChange={(e) => setFilterValue(e.target.value)}
                  />
                </div>
                <p className="subtitle" style={{ marginBottom: 8 }}>
                  Mostrando {sortedStatuses.length} linha(s) na visão atual.
                </p>
                <div className="table-wrapper" style={{ maxHeight: 420 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Aba</th>
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
                        <tr key={`${s.sheet_name}-${s.extrato_id}-${idx}`}>
                          <td>{s.sheet_name}</td>
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
                          <td colSpan={8}>Sem linhas para os filtros selecionados.</td>
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
  );
}
