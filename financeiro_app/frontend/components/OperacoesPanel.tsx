"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KivoLoader, waitMinLoaderTime } from "./KivoLoader";
import { OperacoesFieldBuilder } from "./OperacoesFieldBuilder";
import { OperacoesCardPreview } from "./OperacoesCardPreview";
import {
  resolveCardSchema,
  type AutomationFormField,
} from "../lib/operacoesAutomationSchema";

export type OperationsView = "importacao" | "exportacao";

type SectorAutomation = {
  id: number;
  sector: string;
  flow: string;
  client_slug: string;
  visibility: string;
  key: string;
  name: string;
  description: string;
  script_path: string;
  sort_order: number;
  is_active: number;
  created_by: string;
  input_schema: AutomationFormField[];
};

type AutomationClient = {
  id: number;
  sector: string;
  flow: string;
  slug: string;
  name: string;
};

type SectorRun = {
  id: number;
  automation_key: string;
  status: string;
  triggered_by: string;
  output_path: string;
  logs: string;
  created_at: string;
};

type OperacoesPanelProps = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  operationsView: OperationsView;
  onOperationsViewChange: (view: OperationsView) => void;
  username: string;
  isAdmin: boolean;
};

type CardDraft = {
  name: string;
  description: string;
  script_path: string;
  client_slug: string;
  fields: AutomationFormField[];
};

type ClientDraft = {
  name: string;
  slug: string;
};

type ClientFilter = "all" | "global" | "geral" | string;

async function parseError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const detail = body?.detail;
  if (typeof detail === "string") {
    if (detail === "Not Found" && res.status === 404) {
      return "API de Operações indisponível. Reinicie o backend (start_app.ps1) e recarregue a página.";
    }
    return detail;
  }
  return fallback;
}

function defaultScriptPath(view: OperationsView, clientSlug: string) {
  const base = `automations/operacoes/${view}/`;
  return clientSlug ? `${base}${clientSlug}/` : base;
}

const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "na fila",
  running: "executando…",
  completed: "concluída",
  failed: "falhou",
};

function runStatusLabel(status: string) {
  return RUN_STATUS_LABEL[status.toLowerCase()] ?? status;
}

function isActiveRunStatus(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "queued" || normalized === "running";
}

type OperacoesFormModalProps = {
  title: string;
  subtitle?: string;
  titleId: string;
  variant?: "default" | "automation";
  onClose: () => void;
  children: ReactNode;
};

function OperacoesFormModal({
  title,
  subtitle,
  titleId,
  variant = "default",
  onClose,
  children,
}: OperacoesFormModalProps) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="platform-operacoes-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`platform-operacoes-modal ${variant === "automation" ? "platform-operacoes-modal--automation" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="platform-operacoes-modal-head">
          <div className="platform-operacoes-modal-head-text">
            <h3 id={titleId}>{title}</h3>
            {subtitle ? <p className="platform-operacoes-modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="platform-operacoes-modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function OperacoesPanel({
  apiFetch,
  operationsView,
  onOperationsViewChange,
  username,
  isAdmin,
}: OperacoesPanelProps) {
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;

  const [cards, setCards] = useState<SectorAutomation[]>([]);
  const [clients, setClients] = useState<AutomationClient[]>([]);
  const [runs, setRuns] = useState<SectorRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [formMode, setFormMode] = useState<"none" | "automation" | "edit-automation" | "client">("none");
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [clientFilter, setClientFilter] = useState<ClientFilter>("all");
  const [draft, setDraft] = useState<CardDraft>({
    name: "",
    description: "",
    script_path: defaultScriptPath(operationsView, ""),
    client_slug: "",
    fields: [],
  });
  const [clientDraft, setClientDraft] = useState<ClientDraft>({ name: "", slug: "" });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [textValuesByCard, setTextValuesByCard] = useState<Record<string, Record<string, string>>>({});
  const [filesByCardSlot, setFilesByCardSlot] = useState<Record<string, Record<string, File[]>>>({});
  const [savingForm, setSavingForm] = useState(false);

  const flowLabel = operationsView === "importacao" ? "Importação" : "Exportação";

  function closeFormModal() {
    setFormMode("none");
    setEditingCardId(null);
    setSavingForm(false);
  }

  useEffect(() => {
    if (formMode === "none") return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeFormModal();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [formMode]);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      const startedAt = Date.now();
      setLoading(true);
      setError("");
      try {
        const fetcher = apiFetchRef.current;
        const [cardsRes, runsRes, clientsRes] = await Promise.all([
          fetcher(`/sector-automations?sector=operacoes&flow=${operationsView}`),
          fetcher(`/sector-runs?sector=operacoes&flow=${operationsView}`),
          fetcher(`/automation-clients?sector=operacoes&flow=${operationsView}`),
        ]);
        if (cancelled) return;

        if (!cardsRes.ok) throw new Error(await parseError(cardsRes, "Erro ao carregar automações."));
        if (!runsRes.ok) throw new Error(await parseError(runsRes, "Erro ao carregar execuções."));
        if (!clientsRes.ok) throw new Error(await parseError(clientsRes, "Erro ao carregar clientes."));

        setCards(
          ((await cardsRes.json()) as SectorAutomation[]).map((card) => ({
            ...card,
            input_schema: card.input_schema ?? [],
          })),
        );
        setRuns((await runsRes.json()) as SectorRun[]);
        setClients((await clientsRes.json()) as AutomationClient[]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar Operações.");
        }
      } finally {
        if (!cancelled) {
          await waitMinLoaderTime(startedAt);
          setLoading(false);
        }
      }
    }

    loadAll().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [operationsView]);

  useEffect(() => {
    const hasActiveRun = runs.some((run) => isActiveRunStatus(run.status ?? ""));
    if (!hasActiveRun) return;

    const interval = window.setInterval(() => {
      reloadRuns().catch(() => null);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [runs, operationsView]);

  useEffect(() => {
    setDraft({
      name: "",
      description: "",
      script_path: defaultScriptPath(operationsView, ""),
      client_slug: "",
      fields: [],
    });
    setFormMode("none");
    setEditingCardId(null);
    setClientFilter("all");
    setTextValuesByCard({});
    setFilesByCardSlot({});
  }, [operationsView]);

  const latestRunByKey = useMemo(() => {
    const map: Record<string, SectorRun> = {};
    runs.forEach((run) => {
      if (!map[run.automation_key]) map[run.automation_key] = run;
    });
    return map;
  }, [runs]);

  const grouped = useMemo(() => {
    const globals = cards.filter((c) => c.visibility === "global");
    const locals = cards.filter((c) => c.visibility !== "global");
    const geralCards = locals.filter((c) => !c.client_slug);

    const clientSections = clients.map((client) => ({
      key: client.slug,
      title: client.name,
      slug: client.slug,
      cards: locals.filter((c) => c.client_slug === client.slug),
    }));

    const knownSlugs = new Set(clients.map((c) => c.slug));
    const orphanSlugs = [
      ...new Set(locals.map((c) => c.client_slug).filter((slug) => slug && !knownSlugs.has(slug))),
    ];
    for (const slug of orphanSlugs) {
      clientSections.push({
        key: slug,
        title: slug,
        slug,
        cards: locals.filter((c) => c.client_slug === slug),
      });
    }

    return { globals, clientSections, geralCards };
  }, [cards, clients]);

  const countsByClient = useMemo(() => {
    const map: Record<string, number> = { geral: grouped.geralCards.length, global: grouped.globals.length };
    for (const section of grouped.clientSections) {
      map[section.slug] = section.cards.length;
    }
    return map;
  }, [grouped]);

  const visibleSections = useMemo(() => {
    if (clientFilter === "all") {
      return {
        globals: grouped.globals,
        clientSections: grouped.clientSections.filter((section) => section.cards.length > 0),
        geralCards: grouped.geralCards,
      };
    }
    if (clientFilter === "global") {
      return { globals: grouped.globals, clientSections: [], geralCards: [] };
    }
    if (clientFilter === "geral") {
      return { globals: [], clientSections: [], geralCards: grouped.geralCards };
    }
    return {
      globals: [],
      clientSections: grouped.clientSections.filter((s) => s.slug === clientFilter),
      geralCards: [],
    };
  }, [clientFilter, grouped]);

  const hasVisibleContent =
    visibleSections.globals.length > 0 ||
    visibleSections.clientSections.length > 0 ||
    visibleSections.geralCards.length > 0;

  async function reloadCards() {
    const res = await apiFetchRef.current(`/sector-automations?sector=operacoes&flow=${operationsView}`);
    if (!res.ok) throw new Error(await parseError(res, "Erro ao carregar automações."));
    setCards(
      ((await res.json()) as SectorAutomation[]).map((card) => ({
        ...card,
        input_schema: card.input_schema ?? [],
      })),
    );
  }

  async function reloadClients() {
    const res = await apiFetchRef.current(`/automation-clients?sector=operacoes&flow=${operationsView}`);
    if (!res.ok) throw new Error(await parseError(res, "Erro ao carregar clientes."));
    setClients((await res.json()) as AutomationClient[]);
  }

  async function reloadRuns() {
    const res = await apiFetchRef.current(`/sector-runs?sector=operacoes&flow=${operationsView}`);
    if (!res.ok) throw new Error(await parseError(res, "Erro ao carregar execuções."));
    setRuns((await res.json()) as SectorRun[]);
  }

  async function pollRunUntilDone(runId: number, automationKey: string) {
    const maxAttempts = 180;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const query = new URLSearchParams({
        sector: "operacoes",
        flow: operationsView,
        automation_key: automationKey,
      });
      const res = await apiFetchRef.current(`/sector-runs?${query.toString()}`);
      if (!res.ok) continue;
      const runs = (await res.json()) as SectorRun[];
      const run = runs.find((item) => item.id === runId);
      if (!run) continue;
      await reloadRuns();
      const status = run.status?.toLowerCase() ?? "";
      if (status === "completed") {
        setMessage(`Execução #${runId} concluída.`);
        return;
      }
      if (status === "failed") {
        setError(`Execução #${runId} falhou.`);
        return;
      }
    }
    await reloadRuns();
  }

  async function downloadRunOutput(runId: number) {
    setError("");
    try {
      const res = await apiFetchRef.current(`/sector-runs/${runId}/download?sector=operacoes`);
      if (!res.ok) {
        throw new Error(await parseError(res, "Não foi possível baixar o Excel."));
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const utfMatch = disposition.match(/filename\*=UTF-8''([^;\s]+)/i);
      const plainMatch = disposition.match(/filename="?([^";\n]+)"?/i);
      const filename = utfMatch
        ? decodeURIComponent(utfMatch[1])
        : plainMatch
          ? plainMatch[1].trim()
          : `operacoes_run_${runId}.xlsx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao baixar Excel.");
    }
  }

  function openAutomationForm(clientSlug = "") {
    setEditingCardId(null);
    setFormMode("automation");
    setDraft({
      name: "",
      description: "",
      client_slug: clientSlug,
      script_path: defaultScriptPath(operationsView, clientSlug),
      fields: [],
    });
    setError("");
  }

  function openEditForm(card: SectorAutomation) {
    setEditingCardId(card.id);
    setFormMode("edit-automation");
    setDraft({
      name: card.name,
      description: card.description,
      client_slug: card.client_slug,
      script_path: card.script_path,
      fields: (card.input_schema ?? []).map((field) => ({ ...field })),
    });
    setError("");
  }

  async function handleCreateCard(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSavingForm(true);
    const visibility = draft.client_slug ? "client" : "flow";
    const res = await apiFetchRef.current("/sector-automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sector: "operacoes",
        flow: operationsView,
        client_slug: draft.client_slug,
        visibility,
        name: draft.name,
        description: draft.description,
        script_path: draft.script_path,
        input_schema: draft.fields,
      }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Não foi possível criar o card."));
      setSavingForm(false);
      return;
    }
    setMessage(
      draft.client_slug
        ? "Automação cadastrada. Usuários do setor Operações enxergam este cliente; restrinja em Configurações → Acesso a clientes, se necessário."
        : "Automação cadastrada.",
    );
    setFormMode("none");
    setEditingCardId(null);
    if (draft.client_slug) setClientFilter(draft.client_slug);
    await reloadCards();
    setSavingForm(false);
  }

  async function handleUpdateCard(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCardId) return;
    setError("");
    setMessage("");
    setSavingForm(true);
    const res = await apiFetchRef.current(`/sector-automations/${editingCardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        description: draft.description,
        script_path: draft.script_path,
        client_slug: draft.client_slug,
        visibility: draft.client_slug ? "client" : "flow",
        input_schema: draft.fields,
      }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Não foi possível salvar a automação."));
      setSavingForm(false);
      return;
    }
    setMessage("Automação atualizada.");
    setFormMode("none");
    setEditingCardId(null);
    await reloadCards();
    setSavingForm(false);
  }

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const res = await apiFetchRef.current("/automation-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sector: "operacoes",
        flow: operationsView,
        name: clientDraft.name,
        slug: clientDraft.slug || undefined,
      }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Não foi possível criar o cliente."));
      return;
    }
    const created = (await res.json()) as AutomationClient;
    setMessage(`Cliente "${created.name}" cadastrado.`);
    setClientDraft({ name: "", slug: "" });
    setFormMode("none");
    setClientFilter(created.slug);
    await reloadClients();
  }

  async function handleRun(card: SectorAutomation) {
    const schema = resolveCardSchema(card.input_schema);
    const textValues = textValuesByCard[card.key] ?? {};
    const fileSlots = filesByCardSlot[card.key] ?? {};

    const parameters: Record<string, string> = {};
    for (const field of schema) {
      if (field.type !== "text") continue;
      const value = (textValues[field.key] ?? field.default_value ?? "").trim();
      if (field.required && !value) {
        setError(`Preencha «${field.label}».`);
        return;
      }
      parameters[field.key] = value;
    }

    const allFiles: File[] = [];
    const slotKeys: string[] = [];
    for (const field of schema) {
      if (field.type !== "file") continue;
      const files = fileSlots[field.key] ?? [];
      if (field.required && files.length === 0) {
        setError(`Anexe um arquivo em «${field.label}».`);
        return;
      }
      if (!field.multiple && files.length > 1) {
        setError(`«${field.label}» aceita apenas um arquivo.`);
        return;
      }
      for (const file of files) {
        allFiles.push(file);
        slotKeys.push(field.key);
      }
    }

    const hasRequiredFileFields = schema.some((field) => field.type === "file" && field.required);
    if (hasRequiredFileFields && allFiles.length === 0) {
      setError("Anexe os arquivos obrigatórios antes de executar.");
      return;
    }

    setBusyKey(card.key);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("automation_key", card.key);
      formData.append("sector", "operacoes");
      formData.append("triggered_by", username);
      formData.append("parameters_json", JSON.stringify(parameters));
      allFiles.forEach((file) => formData.append("files", file));
      slotKeys.forEach((slotKey) => formData.append("slot_keys", slotKey));

      const res = await apiFetchRef.current("/sector-runs/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await parseError(res, "Falha ao executar automação."));
      const created = (await res.json()) as SectorRun;
      setMessage(`Execução #${created.id} iniciada.`);
      setTextValuesByCard((prev) => ({ ...prev, [card.key]: {} }));
      setFilesByCardSlot((prev) => ({ ...prev, [card.key]: {} }));
      await reloadRuns();
      await pollRunUntilDone(created.id, card.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na execução.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeactivate(card: SectorAutomation) {
    if (!confirm(`Desativar a automação "${card.name}"?`)) return;
    const res = await apiFetchRef.current(`/sector-automations/${card.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await parseError(res, "Não foi possível desativar."));
      return;
    }
    setMessage("Automação desativada.");
    await reloadCards();
  }

  function renderCard(card: SectorAutomation) {
    const lastRun = latestRunByKey[card.key];
    const schema = resolveCardSchema(card.input_schema);
    const textValues = textValuesByCard[card.key] ?? {};
    const fileSlots = filesByCardSlot[card.key] ?? {};
    const scriptFile = card.script_path.split("/").pop() || card.script_path;
    const runStatus = lastRun?.status?.toLowerCase() ?? "";
    const canManage = isAdmin || card.created_by === username;
    const totalFiles = schema
      .filter((field) => field.type === "file")
      .reduce((sum, field) => sum + (fileSlots[field.key]?.length ?? 0), 0);

    return (
      <article key={card.id} className="platform-operacoes-card">
        <header className="platform-operacoes-card-head">
          <div className="platform-operacoes-card-title-row">
            <div className="platform-operacoes-card-title-block">
              <h3>{card.name}</h3>
              <code className="platform-operacoes-card-path" title={card.script_path}>
                {scriptFile}
              </code>
            </div>
            {canManage && (
              <div className="platform-operacoes-card-actions">
                <button
                  type="button"
                  className="platform-operacoes-card-edit"
                  onClick={() => openEditForm(card)}
                  aria-label={`Editar ${card.name}`}
                  title="Editar automação"
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="platform-operacoes-card-remove"
                  onClick={() => handleDeactivate(card)}
                  aria-label={`Remover ${card.name}`}
                >
                  ×
                </button>
              </div>
            )}
          </div>
          {card.description ? <p className="platform-operacoes-card-desc">{card.description}</p> : null}
        </header>

        {lastRun && (
          <div
            className={`platform-operacoes-run-status platform-operacoes-run-status--${
              runStatus === "queued" ? "running" : runStatus || "default"
            }`}
          >
            <span className="platform-operacoes-run-status-dot" aria-hidden="true" />
            <span>
              #{lastRun.id} · <strong>{runStatusLabel(lastRun.status)}</strong>
            </span>
            {runStatus === "completed" && lastRun.output_path ? (
              <button
                type="button"
                className="platform-operacoes-download-btn"
                onClick={() => downloadRunOutput(lastRun.id)}
              >
                Baixar Excel
              </button>
            ) : null}
          </div>
        )}

        {schema.length > 0 && (
          <div className="platform-operacoes-card-fields">
            {schema.map((field) => {
              if (field.type === "text") {
                return (
                  <label key={field.key} className="platform-operacoes-card-field">
                    <span>
                      {field.label}
                      {field.required ? <em className="platform-operacoes-required">*</em> : null}
                    </span>
                    <input
                      type="text"
                      value={textValues[field.key] ?? field.default_value ?? ""}
                      placeholder={field.placeholder || undefined}
                      onChange={(e) =>
                        setTextValuesByCard((prev) => ({
                          ...prev,
                          [card.key]: { ...(prev[card.key] ?? {}), [field.key]: e.target.value },
                        }))
                      }
                    />
                  </label>
                );
              }

              const files = fileSlots[field.key] ?? [];
              return (
                <div key={field.key} className="platform-operacoes-card-field platform-operacoes-card-field--file">
                  <span>
                    {field.label}
                    {field.required ? <em className="platform-operacoes-required">*</em> : null}
                  </span>
                  <div className="platform-operacoes-card-file-row">
                    <label className="platform-operacoes-upload-btn platform-operacoes-upload-btn--inline">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M12 16V6m0 0l-3.5 3.5M12 6l3.5 3.5" />
                        <path d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2" />
                      </svg>
                      <span className="platform-operacoes-upload-label">Anexar</span>
                      <input
                        type="file"
                        multiple={field.multiple}
                        accept={field.accept || undefined}
                        hidden
                        onChange={(e) => {
                          const selected = e.target.files ? Array.from(e.target.files) : [];
                          setFilesByCardSlot((prev) => ({
                            ...prev,
                            [card.key]: { ...(prev[card.key] ?? {}), [field.key]: selected },
                          }));
                        }}
                      />
                    </label>
                    <span className={`platform-operacoes-files-count ${files.length > 0 ? "has-files" : ""}`}>
                      {files.length === 0
                        ? "Nenhum arquivo"
                        : `${files.length} arquivo${files.length > 1 ? "s" : ""}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <footer className="platform-operacoes-card-footer">
          {schema.length === 0 ? (
            <span className="platform-operacoes-files-count">Sem campos de entrada</span>
          ) : schema.every((field) => field.type === "text") ? (
            <span className="platform-operacoes-files-count">Somente campos de texto</span>
          ) : (
            <span className={`platform-operacoes-files-count ${totalFiles > 0 ? "has-files" : ""}`}>
              {totalFiles === 0 ? "Nenhum arquivo anexado" : `${totalFiles} arquivo${totalFiles > 1 ? "s" : ""} anexado${totalFiles > 1 ? "s" : ""}`}
            </span>
          )}
          <button
            type="button"
            className="platform-operacoes-run-btn"
            disabled={busyKey === card.key}
            onClick={() => handleRun(card)}
          >
            {busyKey === card.key ? "Executando…" : "Executar"}
          </button>
        </footer>
      </article>
    );
  }

  function renderSection(title: string, meta: string, sectionCards: SectorAutomation[], clientSlug?: string) {
    return (
      <section className="platform-operacoes-section" key={title}>
        <header className="platform-operacoes-section-head">
          <div className="platform-operacoes-section-head-text">
            <h3>{title}</h3>
            <span>{meta}</span>
          </div>
          <button
            type="button"
            className="platform-operacoes-section-add"
            onClick={() => openAutomationForm(clientSlug ?? "")}
          >
            Nova automação
          </button>
        </header>
        {sectionCards.length > 0 ? (
          <div className="platform-operacoes-cards">{sectionCards.map(renderCard)}</div>
        ) : (
          <div className="platform-operacoes-section-empty">
            <p>Nenhuma automação cadastrada.</p>
            <button type="button" className="platform-operacoes-btn platform-operacoes-btn--ghost" onClick={() => openAutomationForm(clientSlug ?? "")}>
              Criar primeira automação
            </button>
          </div>
        )}
      </section>
    );
  }

  function renderClientFilter(id: ClientFilter, label: string, count: number) {
    return (
      <button
        key={id}
        type="button"
        className={`platform-operacoes-sidebar-item ${clientFilter === id ? "is-active" : ""}`}
        onClick={() => setClientFilter(id)}
      >
        <span>{label}</span>
        <span className="platform-operacoes-sidebar-count">{count}</span>
      </button>
    );
  }

  const totalAutomations = cards.length;

  return (
    <section className="platform-operacoes" aria-label="Painel de operações">
      <div className="platform-operacoes-shell panel">
        <header className="platform-operacoes-bar">
          <div className="platform-operacoes-bar-main">
            <div className="platform-operacoes-flows platform-operacoes-flows--compact" role="tablist" aria-label="Equipes">
              <button
                type="button"
                role="tab"
                aria-selected={operationsView === "importacao"}
                className={`platform-operacoes-flow-tab ${operationsView === "importacao" ? "active" : ""}`}
                onClick={() => onOperationsViewChange("importacao")}
              >
                Importação
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={operationsView === "exportacao"}
                className={`platform-operacoes-flow-tab ${operationsView === "exportacao" ? "active" : ""}`}
                onClick={() => onOperationsViewChange("exportacao")}
              >
                Exportação
              </button>
            </div>
            <span className="platform-operacoes-bar-meta">
              {clients.length} clientes · {totalAutomations} automações
              {clientFilter !== "all" ? (
                <>
                  {" "}
                  ·{" "}
                  {clientFilter === "geral"
                    ? "Geral da equipe"
                    : clientFilter === "global"
                      ? "Globais"
                      : clients.find((c) => c.slug === clientFilter)?.name ?? clientFilter}
                </>
              ) : null}
            </span>
          </div>
          <div className="platform-operacoes-toolbar-actions">
            {isAdmin && (
              <button
                type="button"
                className="platform-operacoes-btn platform-operacoes-btn--ghost"
                onClick={() => setFormMode("client")}
              >
                + Cliente
              </button>
            )}
            <button
              type="button"
              className="platform-operacoes-btn platform-operacoes-btn--primary"
              onClick={() => openAutomationForm()}
            >
              + Automação
            </button>
          </div>
        </header>

        {(error || message) && (
          <div className="platform-operacoes-alerts">
            {error && <p className="platform-operacoes-alert platform-operacoes-alert--error">{error}</p>}
            {message && <p className="platform-operacoes-alert platform-operacoes-alert--ok">{message}</p>}
          </div>
        )}

        {loading && (
          <div className="module-pane-loading module-pane-loading--compact" role="status" aria-live="polite">
            <KivoLoader size="sm" showLabel label="Carregando automações…" />
          </div>
        )}

        {formMode === "client" && isAdmin && (
          <OperacoesFormModal title={`Novo cliente · ${flowLabel}`} titleId="operacoes-client-modal-title" onClose={closeFormModal}>
            <form className="platform-operacoes-form-panel platform-operacoes-form-panel--modal" onSubmit={handleCreateClient}>
              <div className="platform-operacoes-form-grid">
                <label>
                  Nome
                  <input
                    required
                    autoFocus
                    value={clientDraft.name}
                    onChange={(e) => setClientDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Yaro"
                  />
                </label>
                <label>
                  Slug <span className="platform-operacoes-optional">opcional</span>
                  <input
                    value={clientDraft.slug}
                    onChange={(e) => setClientDraft((d) => ({ ...d, slug: e.target.value }))}
                    placeholder="yaro"
                  />
                </label>
              </div>
              <div className="platform-operacoes-form-actions">
                <button type="button" className="platform-operacoes-btn platform-operacoes-btn--ghost" onClick={closeFormModal}>
                  Cancelar
                </button>
                <button type="submit" className="platform-operacoes-btn platform-operacoes-btn--primary">
                  Salvar cliente
                </button>
              </div>
            </form>
          </OperacoesFormModal>
        )}

        {(formMode === "automation" || formMode === "edit-automation") && (
          <OperacoesFormModal
            title={formMode === "edit-automation" ? "Editar automação" : "Nova automação"}
            subtitle={`${flowLabel} · defina metadados e campos que aparecem no card`}
            titleId="operacoes-automation-modal-title"
            variant="automation"
            onClose={closeFormModal}
          >
            <form
              className="platform-operacoes-form-panel platform-operacoes-form-panel--modal platform-operacoes-modal-form"
              onSubmit={formMode === "edit-automation" ? handleUpdateCard : handleCreateCard}
            >
              <div className="platform-operacoes-modal-layout">
                <div className="platform-operacoes-modal-scroll platform-operacoes-modal-editor">
                  <section className="platform-operacoes-form-section" aria-labelledby="operacoes-form-info">
                    <h4 id="operacoes-form-info" className="platform-operacoes-form-section-title">
                      Informações
                    </h4>
                    <div className="platform-operacoes-form-grid">
                      <label>
                        Nome
                        <input
                          required
                          autoFocus
                          value={draft.name}
                          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                          placeholder="Relatório DI"
                        />
                      </label>
                      <label>
                        Cliente
                        <select
                          value={draft.client_slug}
                          onChange={(e) => {
                            const client_slug = e.target.value;
                            setDraft((d) => ({
                              ...d,
                              client_slug,
                              script_path: defaultScriptPath(operationsView, client_slug),
                            }));
                          }}
                        >
                          <option value="">Geral da equipe</option>
                          {clients.map((client) => (
                            <option key={client.id} value={client.slug}>
                              {client.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="platform-operacoes-form-span2">
                        Rota do script
                        <input
                          required
                          value={draft.script_path}
                          onChange={(e) => setDraft((d) => ({ ...d, script_path: e.target.value }))}
                          placeholder={`automations/operacoes/${operationsView}/yaro/run.py`}
                        />
                      </label>
                      <label className="platform-operacoes-form-span2">
                        Descrição <span className="platform-operacoes-optional">opcional</span>
                        <textarea
                          rows={2}
                          value={draft.description}
                          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                          placeholder="O que esta rotina faz?"
                        />
                      </label>
                    </div>
                  </section>

                  <OperacoesFieldBuilder
                    fields={draft.fields}
                    onChange={(fields) => setDraft((d) => ({ ...d, fields }))}
                  />
                </div>

                <aside className="platform-operacoes-modal-preview-pane" aria-label="Pré-visualização do card">
                  <p className="platform-operacoes-preview-label">Pré-visualização</p>
                  <OperacoesCardPreview
                    name={draft.name}
                    description={draft.description}
                    scriptPath={draft.script_path}
                    fields={draft.fields}
                  />
                </aside>
              </div>

              <div className="platform-operacoes-form-actions platform-operacoes-form-actions--sticky">
                <button
                  type="button"
                  className="platform-operacoes-btn platform-operacoes-btn--ghost"
                  onClick={closeFormModal}
                  disabled={savingForm}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="platform-operacoes-btn platform-operacoes-btn--primary"
                  disabled={savingForm}
                >
                  {savingForm
                    ? "Salvando…"
                    : formMode === "edit-automation"
                      ? "Salvar alterações"
                      : "Salvar automação"}
                </button>
              </div>
            </form>
          </OperacoesFormModal>
        )}

        {!loading && (
          <div className="platform-operacoes-body">
            <aside className="platform-operacoes-sidebar" aria-label="Filtrar por cliente">
              <p className="platform-operacoes-sidebar-title">Clientes</p>
              <nav className="platform-operacoes-sidebar-nav">
                {renderClientFilter("all", "Todos", totalAutomations)}
                {grouped.globals.length > 0 && renderClientFilter("global", "Globais", countsByClient.global)}
                {clients.map((client) => renderClientFilter(client.slug, client.name, countsByClient[client.slug] ?? 0))}
                {renderClientFilter("geral", "Geral da equipe", countsByClient.geral)}
              </nav>
            </aside>

            <div className="platform-operacoes-main">
              <div className="platform-operacoes-sections">
                {visibleSections.globals.length > 0 &&
                  renderSection("Globais", "Todos os setores", visibleSections.globals)}

                {visibleSections.clientSections.map((section) =>
                  renderSection(section.title, flowLabel, section.cards, section.slug),
                )}

                {(clientFilter === "all" || clientFilter === "geral") &&
                  (clientFilter === "geral" || visibleSections.geralCards.length > 0) &&
                  renderSection("Geral da equipe", "Sem cliente específico", visibleSections.geralCards)}

                {totalAutomations === 0 && clients.length === 0 && clientFilter === "all" && (
                  <div className="platform-operacoes-empty-state">
                    <p>
                      Nenhum cliente nem automação em <b>{flowLabel}</b>.
                    </p>
                    {isAdmin && <p className="subtitle">Comece cadastrando um cliente, depois adicione automações.</p>}
                  </div>
                )}

                {!isAdmin && cards.length === 0 && (clients.length > 0 || clientFilter !== "all") && (
                  <div className="platform-operacoes-empty-state">
                    <p>Nenhuma automação disponível para o seu usuário nesta equipe.</p>
                    <p className="subtitle">
                      Peça ao administrador para confirmar seu setor como <b>Operações</b> e liberar o cliente correto em
                      Configurações → Acesso a clientes.
                    </p>
                  </div>
                )}

                {clientFilter !== "all" && !hasVisibleContent && totalAutomations > 0 && (
                  <div className="platform-operacoes-empty-state">
                    <p>Nenhuma automação neste filtro.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
