"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  username: string;
  isAdmin: boolean;
};

type CardDraft = {
  name: string;
  description: string;
  script_path: string;
  client_slug: string;
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

export function OperacoesPanel({ apiFetch, operationsView, username, isAdmin }: OperacoesPanelProps) {
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;

  const [cards, setCards] = useState<SectorAutomation[]>([]);
  const [clients, setClients] = useState<AutomationClient[]>([]);
  const [runs, setRuns] = useState<SectorRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [formMode, setFormMode] = useState<"none" | "automation" | "client">("none");
  const [clientFilter, setClientFilter] = useState<ClientFilter>("all");
  const [draft, setDraft] = useState<CardDraft>({
    name: "",
    description: "",
    script_path: defaultScriptPath(operationsView, ""),
    client_slug: "",
  });
  const [clientDraft, setClientDraft] = useState<ClientDraft>({ name: "", slug: "" });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filesByCard, setFilesByCard] = useState<Record<string, File[]>>({});

  const flowLabel = operationsView === "importacao" ? "Importação" : "Exportação";

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
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

        setCards((await cardsRes.json()) as SectorAutomation[]);
        setRuns((await runsRes.json()) as SectorRun[]);
        setClients((await clientsRes.json()) as AutomationClient[]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar Operações.");
        }
      } finally {
        if (!cancelled) setLoading(false);
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
    });
    setFormMode("none");
    setClientFilter("all");
    setFilesByCard({});
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
        clientSections: grouped.clientSections,
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

  async function reloadCards() {
    const res = await apiFetchRef.current(`/sector-automations?sector=operacoes&flow=${operationsView}`);
    if (!res.ok) throw new Error(await parseError(res, "Erro ao carregar automações."));
    setCards((await res.json()) as SectorAutomation[]);
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
    setFormMode("automation");
    setDraft({
      name: "",
      description: "",
      client_slug: clientSlug,
      script_path: defaultScriptPath(operationsView, clientSlug),
    });
    setError("");
  }

  async function handleCreateCard(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
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
      }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Não foi possível criar o card."));
      return;
    }
    setMessage(
      draft.client_slug
        ? "Automação cadastrada. Usuários do setor Operações enxergam este cliente; restrinja em Configurações → Acesso a clientes, se necessário."
        : "Automação cadastrada.",
    );
    setFormMode("none");
    if (draft.client_slug) setClientFilter(draft.client_slug);
    await reloadCards();
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
    const files = filesByCard[card.key] ?? [];
    if (files.length === 0) {
      setError("Anexe pelo menos um arquivo antes de executar.");
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
      formData.append("parameters_json", "{}");
      files.forEach((file) => formData.append("files", file));

      const res = await apiFetchRef.current("/sector-runs/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await parseError(res, "Falha ao executar automação."));
      const created = (await res.json()) as SectorRun;
      setMessage(`Execução #${created.id} iniciada.`);
      setFilesByCard((prev) => ({ ...prev, [card.key]: [] }));
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
    const files = filesByCard[card.key] ?? [];
    const scriptFile = card.script_path.split("/").pop() || card.script_path;
    const runStatus = lastRun?.status?.toLowerCase() ?? "";

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
            {(isAdmin || card.created_by === username) && (
              <button
                type="button"
                className="platform-operacoes-card-remove"
                onClick={() => handleDeactivate(card)}
                aria-label={`Remover ${card.name}`}
              >
                ×
              </button>
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

        <footer className="platform-operacoes-card-footer">
          <label className="platform-operacoes-upload-btn">
            +
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const selected = e.target.files ? Array.from(e.target.files) : [];
                setFilesByCard((prev) => ({ ...prev, [card.key]: selected }));
              }}
            />
          </label>
          <span className={`platform-operacoes-files-count ${files.length > 0 ? "has-files" : ""}`}>
            {files.length} arq.
          </span>
          <button
            type="button"
            className="platform-operacoes-run-btn"
            disabled={busyKey === card.key}
            onClick={() => handleRun(card)}
          >
            {busyKey === card.key ? "…" : "Executar"}
          </button>
        </footer>
      </article>
    );
  }

  function renderSection(title: string, meta: string, sectionCards: SectorAutomation[], clientSlug?: string) {
    return (
      <section className="platform-operacoes-section" key={title}>
        <header className="platform-operacoes-section-head">
          <div>
            <h3>{title}</h3>
            <span>{meta}</span>
          </div>
          <button
            type="button"
            className="platform-operacoes-section-add"
            onClick={() => openAutomationForm(clientSlug ?? "")}
          >
            + Automação
          </button>
        </header>
        {sectionCards.length > 0 ? (
          <div className="platform-operacoes-cards">{sectionCards.map(renderCard)}</div>
        ) : (
          <p className="platform-operacoes-section-empty">Nenhuma automação cadastrada.</p>
        )}
      </section>
    );
  }

  const totalAutomations = cards.length;

  return (
    <div className="platform-operacoes-layout" aria-label={`Automações de ${flowLabel}`}>
      <header className="platform-operacoes-toolbar">
        <div className="platform-operacoes-toolbar-stats">
          <span>
            <strong>{clients.length}</strong> clientes
          </span>
          <span className="platform-operacoes-toolbar-divider" aria-hidden="true" />
          <span>
            <strong>{totalAutomations}</strong> automações
          </span>
        </div>
        <div className="platform-operacoes-toolbar-actions">
          {isAdmin && (
            <button
              type="button"
              className="platform-operacoes-btn platform-operacoes-btn--ghost"
              onClick={() => setFormMode((m) => (m === "client" ? "none" : "client"))}
            >
              {formMode === "client" ? "Fechar" : "+ Cliente"}
            </button>
          )}
          <button
            type="button"
            className="platform-operacoes-btn platform-operacoes-btn--primary"
            onClick={() => (formMode === "automation" ? setFormMode("none") : openAutomationForm())}
          >
            {formMode === "automation" ? "Fechar" : "+ Automação"}
          </button>
        </div>
      </header>

      <nav className="platform-operacoes-filters" aria-label="Filtrar por cliente">
        <button
          type="button"
          className={`platform-operacoes-filter ${clientFilter === "all" ? "is-active" : ""}`}
          onClick={() => setClientFilter("all")}
        >
          Todos
          <span>{totalAutomations}</span>
        </button>
        {grouped.globals.length > 0 && (
          <button
            type="button"
            className={`platform-operacoes-filter ${clientFilter === "global" ? "is-active" : ""}`}
            onClick={() => setClientFilter("global")}
          >
            Globais
            <span>{countsByClient.global}</span>
          </button>
        )}
        {clients.map((client) => (
          <button
            key={client.id}
            type="button"
            className={`platform-operacoes-filter ${clientFilter === client.slug ? "is-active" : ""}`}
            onClick={() => setClientFilter(client.slug)}
          >
            {client.name}
            <span>{countsByClient[client.slug] ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={`platform-operacoes-filter ${clientFilter === "geral" ? "is-active" : ""}`}
          onClick={() => setClientFilter("geral")}
        >
          Geral
          <span>{countsByClient.geral}</span>
        </button>
      </nav>

      {(error || message) && (
        <div className="platform-operacoes-alerts">
          {error && <p className="platform-operacoes-alert platform-operacoes-alert--error">{error}</p>}
          {message && <p className="platform-operacoes-alert platform-operacoes-alert--ok">{message}</p>}
        </div>
      )}

      {loading && <p className="platform-operacoes-loading">Carregando…</p>}

      {formMode === "client" && isAdmin && (
        <form className="platform-operacoes-form-panel" onSubmit={handleCreateClient}>
          <h3>Novo cliente · {flowLabel}</h3>
          <div className="platform-operacoes-form-grid">
            <label>
              Nome
              <input
                required
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
            <button type="button" className="platform-operacoes-btn platform-operacoes-btn--ghost" onClick={() => setFormMode("none")}>
              Cancelar
            </button>
            <button type="submit" className="platform-operacoes-btn platform-operacoes-btn--primary">
              Salvar cliente
            </button>
          </div>
        </form>
      )}

      {formMode === "automation" && (
        <form className="platform-operacoes-form-panel" onSubmit={handleCreateCard}>
          <h3>Nova automação · {flowLabel}</h3>
          <div className="platform-operacoes-form-grid">
            <label>
              Nome
              <input
                required
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
              <input
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="O que esta rotina faz?"
              />
            </label>
          </div>
          <div className="platform-operacoes-form-actions">
            <button type="button" className="platform-operacoes-btn platform-operacoes-btn--ghost" onClick={() => setFormMode("none")}>
              Cancelar
            </button>
            <button type="submit" className="platform-operacoes-btn platform-operacoes-btn--primary">
              Salvar automação
            </button>
          </div>
        </form>
      )}

      {!loading && (
        <div className="platform-operacoes-sections">
          {visibleSections.globals.length > 0 &&
            renderSection("Globais", "Todos os setores", visibleSections.globals)}

          {visibleSections.clientSections.map((section) =>
            renderSection(section.title, flowLabel, section.cards, section.slug),
          )}

          {(clientFilter === "all" || clientFilter === "geral") &&
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
        </div>
      )}
    </div>
  );
}
