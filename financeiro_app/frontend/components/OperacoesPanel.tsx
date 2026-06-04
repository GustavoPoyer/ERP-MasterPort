"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type OperationsView = "importacao" | "exportacao";

type SectorAutomation = {
  id: number;
  sector: string;
  flow: string;
  key: string;
  name: string;
  description: string;
  script_path: string;
  sort_order: number;
  is_active: number;
  created_by: string;
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
};

const EMPTY_DRAFT: CardDraft = {
  name: "",
  description: "",
  script_path: "automations/operacoes/importacao/",
};

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

export function OperacoesPanel({ apiFetch, operationsView, username, isAdmin }: OperacoesPanelProps) {
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;

  const [cards, setCards] = useState<SectorAutomation[]>([]);
  const [runs, setRuns] = useState<SectorRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<CardDraft>(EMPTY_DRAFT);
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
        const [cardsRes, runsRes] = await Promise.all([
          fetcher(`/sector-automations?sector=operacoes&flow=${operationsView}`),
          fetcher(`/sector-runs?sector=operacoes&flow=${operationsView}`),
        ]);
        if (cancelled) return;

        if (!cardsRes.ok) {
          throw new Error(await parseError(cardsRes, "Erro ao carregar automações."));
        }
        if (!runsRes.ok) {
          throw new Error(await parseError(runsRes, "Erro ao carregar execuções."));
        }

        setCards((await cardsRes.json()) as SectorAutomation[]);
        setRuns((await runsRes.json()) as SectorRun[]);
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
    setDraft({
      ...EMPTY_DRAFT,
      script_path:
        operationsView === "importacao"
          ? "automations/operacoes/importacao/"
          : "automations/operacoes/exportacao/",
    });
    setShowForm(false);
    setFilesByCard({});
  }, [operationsView]);

  const latestRunByKey = useMemo(() => {
    const map: Record<string, SectorRun> = {};
    runs.forEach((run) => {
      if (!map[run.automation_key]) map[run.automation_key] = run;
    });
    return map;
  }, [runs]);

  async function reloadCards() {
    const res = await apiFetchRef.current(`/sector-automations?sector=operacoes&flow=${operationsView}`);
    if (!res.ok) throw new Error(await parseError(res, "Erro ao carregar automações."));
    setCards((await res.json()) as SectorAutomation[]);
  }

  async function reloadRuns() {
    const res = await apiFetchRef.current(`/sector-runs?sector=operacoes&flow=${operationsView}`);
    if (!res.ok) throw new Error(await parseError(res, "Erro ao carregar execuções."));
    setRuns((await res.json()) as SectorRun[]);
  }

  async function handleCreateCard(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const res = await apiFetchRef.current("/sector-automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sector: "operacoes",
        flow: operationsView,
        name: draft.name,
        description: draft.description,
        script_path: draft.script_path,
      }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Não foi possível criar o card."));
      return;
    }
    setMessage("Automação cadastrada. O card já aparece na lista.");
    setDraft({
      ...EMPTY_DRAFT,
      script_path:
        operationsView === "importacao"
          ? "automations/operacoes/importacao/"
          : "automations/operacoes/exportacao/",
    });
    setShowForm(false);
    await reloadCards();
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
      setMessage(`Execução #${created.id} iniciada para "${card.name}".`);
      setFilesByCard((prev) => ({ ...prev, [card.key]: [] }));
      await reloadRuns();
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

  return (
    <section className="platform-operacoes-automations" aria-label={`Automações de ${flowLabel}`}>
      <div className="platform-operacoes-automations-head">
        <p className="platform-operacoes-intro">
          Cadastre pelo site com a <b>rota do script</b> em <code>automations/</code>.
        </p>
        <button type="button" className="platform-settings-approve-btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancelar" : "+ Nova automação"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="info-note">{message}</p>}
      {loading && <p className="subtitle">Carregando automações…</p>}

      {showForm && (
        <form className="panel platform-operacoes-form" onSubmit={handleCreateCard}>
          <h3>Nova automação — {flowLabel}</h3>
          <label>
            Nome do card
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Ex.: Relatório DI"
            />
          </label>
          <label>
            Descrição
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="O que esta rotina faz?"
            />
          </label>
          <label>
            Rota do script (.py)
            <input
              required
              value={draft.script_path}
              onChange={(e) => setDraft((d) => ({ ...d, script_path: e.target.value }))}
              placeholder="automations/operacoes/importacao/meu_script.py"
            />
          </label>
          <p className="subtitle">
            O arquivo precisa existir nesse caminho antes de salvar. Use barras <code>/</code> (não use <code>..</code>
            ).
          </p>
          <button type="submit" className="platform-settings-approve-btn">
            Salvar card
          </button>
        </form>
      )}

      {!loading && !error && cards.length === 0 && (
        <p className="info-note">
          Nenhuma automação em <b>{flowLabel}</b>. Clique em <b>+ Nova automação</b>, coloque o script na pasta e
          informe a rota.
        </p>
      )}

      <div className="platform-operacoes-cards">
        {cards.map((card) => {
          const lastRun = latestRunByKey[card.key];
          const files = filesByCard[card.key] ?? [];
          const scriptFile = card.script_path.split("/").pop() || card.script_path;
          const runStatus = lastRun?.status?.toLowerCase() ?? "";
          return (
            <article key={card.id} className="platform-operacoes-card">
              <div className="platform-operacoes-card-accent" aria-hidden="true" />

              <header className="platform-operacoes-card-head">
                <div className="platform-operacoes-card-title-row">
                  <span className="platform-operacoes-card-badge">
                    {operationsView === "importacao" ? "IN" : "EX"}
                  </span>
                  <h3>{card.name}</h3>
                  {(isAdmin || card.created_by === username) && (
                    <button
                      type="button"
                      className="platform-operacoes-card-remove"
                      onClick={() => handleDeactivate(card)}
                      aria-label={`Remover ${card.name}`}
                    >
                      Remover
                    </button>
                  )}
                </div>

                <p className="platform-operacoes-card-desc">
                  {card.description || "Sem descrição."}
                </p>

                <div className="platform-operacoes-card-path-wrap" title={card.script_path}>
                  <span className="platform-operacoes-card-path-label">Script</span>
                  <code className="platform-operacoes-card-path">{scriptFile}</code>
                  <span className="platform-operacoes-card-path-dir">{card.script_path}</span>
                </div>
              </header>

              {lastRun && (
                <div
                  className={`platform-operacoes-run-status platform-operacoes-run-status--${runStatus || "default"}`}
                >
                  <span className="platform-operacoes-run-status-dot" aria-hidden="true" />
                  <span>
                    Execução #{lastRun.id} · <strong>{lastRun.status}</strong>
                    {lastRun.output_path ? ` · ${lastRun.output_path.split(/[/\\]/).pop()}` : ""}
                  </span>
                </div>
              )}

              <footer className="platform-operacoes-card-footer">
                <div className="platform-operacoes-card-files">
                  <label className="platform-operacoes-upload-btn">
                    <span className="platform-operacoes-upload-icon" aria-hidden="true">
                      +
                    </span>
                    Anexar arquivos
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
                  <span
                    className={`platform-operacoes-files-count ${files.length > 0 ? "has-files" : ""}`}
                  >
                    {files.length === 0
                      ? "Nenhum arquivo selecionado"
                      : `${files.length} arquivo${files.length > 1 ? "s" : ""}`}
                  </span>
                </div>
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
        })}
      </div>
    </section>
  );
}
