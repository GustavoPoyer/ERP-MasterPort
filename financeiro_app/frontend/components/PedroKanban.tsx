"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

type PedroKanbanCard = {
  id: number;
  importador: string;
  codigo: string;
  ref_cliente: string;
  modal: string;
  dt_registro: string | null;
  registro: string | null;
  hawb: string | null;
  dt_embarque: string | null;
  dt_desembaraco: string | null;
  previsao_chegada: string | null;
  dt_criacao: string | null;
  processo_link: string | null;
};

type PedroKanbanColumn = {
  key: string;
  title: string;
  count: number;
  cards: PedroKanbanCard[];
};

type PedroKanbanPayload = {
  synced_at: string;
  empresa_id: number;
  empresa_nome: string;
  total: number;
  counters: Record<string, number>;
  columns: PedroKanbanColumn[];
  source: string;
  source_board_url: string;
};

type PedroKanbanProps = {
  apiBase: string;
  authToken: string;
};

const COLUMN_ACCENTS: Record<string, string> = {
  geral: "#818cf8",
  ag_embarque: "#38bdf8",
  ag_chegada: "#2dd4bf",
  ag_registro: "#4ade80",
  ag_desembaraco: "#facc15",
  ag_liberacao_carregamento: "#fb923c",
  ag_saida_recinto: "#f87171",
  ag_fechamento: "#c084fc",
  encerrados: "#94a3b8",
};

function formatSigraDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatSyncedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

export function PedroKanban({ apiBase, authToken }: PedroKanbanProps) {
  const [data, setData] = useState<PedroKanbanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeColumn, setActiveColumn] = useState("geral");

  const loadKanban = useCallback(
    async (refresh = false) => {
      setError("");
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const query = refresh ? "?refresh=true" : "";
        const response = await fetch(`${apiBase}/pedro/kanban${query}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.detail === "string" ? payload.detail : "Falha ao sincronizar processos.");
        }
        setData(payload as PedroKanbanPayload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar processos.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiBase, authToken],
  );

  useEffect(() => {
    void loadKanban(false);
  }, [loadKanban]);

  const selectedColumn = useMemo(
    () => data?.columns.find((column) => column.key === activeColumn) ?? data?.columns[0] ?? null,
    [activeColumn, data],
  );

  if (loading && !data) {
    return (
      <section className="app-shell app-shell--pedro">
        <div className="pedro-loading panel">
          <p className="subtitle">Sincronizando processos de importação com SigraWeb…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="app-shell app-shell--pedro">
      <header className="pedro-head panel">
        <div className="pedro-head-copy">
          <span className="pedro-head-eyebrow">SigraWeb · Importação</span>
          <h2 className="pedro-head-title">Processos de Importação</h2>
          <p className="subtitle">
            {data?.empresa_nome || "MASTERPORT"} · espelho de{" "}
            <a href="https://app.sigraweb.com/#/importacao/relatorios" target="_blank" rel="noreferrer">
              Processos de Importação
            </a>
          </p>
        </div>
        <div className="pedro-head-actions">
          {selectedColumn && data ? (
            <div className="pedro-head-meta">
              <span className="pedro-head-meta-value">{selectedColumn.count}</span>
              <span className="pedro-head-meta-label">
                processos em {selectedColumn.title} · {formatSyncedAt(data.synced_at)}
              </span>
            </div>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={refreshing} onClick={() => void loadKanban(true)}>
            {refreshing ? "Sincronizando…" : "Atualizar do Sigra"}
          </button>
          {data?.source_board_url ? (
            <a className="btn btn-secondary" href={data.source_board_url} target="_blank" rel="noreferrer">
              Abrir no Sigra
            </a>
          ) : null}
        </div>
      </header>

      {error ? <p className="pedro-error">{error}</p> : null}

      <label className="pedro-phase-select-wrap">
        <span className="pedro-phase-select-label">Fase do processo</span>
        <select
          className="pedro-phase-select"
          value={activeColumn}
          onChange={(event) => setActiveColumn(event.target.value)}
        >
          {(data?.columns ?? []).map((column) => (
            <option key={column.key} value={column.key}>
              {column.title} ({column.count})
            </option>
          ))}
        </select>
      </label>

      <nav className="pedro-phase-nav pedro-phase-nav--desktop" aria-label="Fases do processo">
        {(data?.columns ?? []).map((column) => (
          <button
            key={column.key}
            type="button"
            className={`pedro-phase-tab${activeColumn === column.key ? " active" : ""}`}
            style={{ "--pedro-accent": COLUMN_ACCENTS[column.key] || "#94a3b8" } as CSSProperties}
            onClick={() => setActiveColumn(column.key)}
          >
            <span className="pedro-phase-tab-label">{column.title}</span>
            <span className="pedro-phase-tab-count">{column.count}</span>
          </button>
        ))}
      </nav>

      {selectedColumn ? (
        <section className="pedro-import-panel panel">
          <header className="pedro-import-panel-header">
            <div>
              <h3>{selectedColumn.title}</h3>
              <p>
                Exibindo {selectedColumn.cards.length} de {selectedColumn.count} processo
                {selectedColumn.count === 1 ? "" : "s"}
              </p>
            </div>
            {selectedColumn.count > selectedColumn.cards.length ? (
              <span className="pedro-import-panel-note">Primeiros 50 registros (como no Sigra)</span>
            ) : null}
          </header>

          {selectedColumn.cards.length === 0 ? (
            <p className="pedro-empty">Nenhum processo nesta fase.</p>
          ) : (
            <>
              <div className="pedro-import-cards" aria-label="Lista de processos">
                {selectedColumn.cards.map((card) => (
                  <article key={card.id} className="pedro-import-card">
                    <header className="pedro-import-card-head">
                      <div>
                        {card.processo_link ? (
                          <a className="pedro-link pedro-import-card-code" href={card.processo_link} target="_blank" rel="noreferrer">
                            {card.codigo || `#${card.id}`}
                          </a>
                        ) : (
                          <strong className="pedro-import-card-code">{card.codigo || `#${card.id}`}</strong>
                        )}
                        <p className="pedro-import-card-importador">{card.importador || "—"}</p>
                      </div>
                      {card.modal ? <span className="pedro-modal-pill">{card.modal}</span> : null}
                    </header>
                    <dl className="pedro-import-card-grid">
                      <div>
                        <dt>Ref. Cliente</dt>
                        <dd>{card.ref_cliente || "—"}</dd>
                      </div>
                      <div>
                        <dt>Registro</dt>
                        <dd>{card.registro || "—"}</dd>
                      </div>
                      <div>
                        <dt>HAWB</dt>
                        <dd>{card.hawb || "—"}</dd>
                      </div>
                      <div>
                        <dt>Embarque</dt>
                        <dd>{formatSigraDate(card.dt_embarque)}</dd>
                      </div>
                      <div>
                        <dt>Desembaraço</dt>
                        <dd>{formatSigraDate(card.dt_desembaraco)}</dd>
                      </div>
                      <div>
                        <dt>Prev. Chegada</dt>
                        <dd>{formatSigraDate(card.previsao_chegada)}</dd>
                      </div>
                      <div className="pedro-import-card-grid--wide">
                        <dt>Criação</dt>
                        <dd>{formatSigraDate(card.dt_criacao)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <div className="pedro-import-table-wrap table-wrapper table-wrapper--scroll pedro-import-table-desktop">
                <table className="pedro-import-table">
                  <thead>
                    <tr>
                      <th>Importador</th>
                      <th>Código</th>
                      <th>Ref. Cliente</th>
                      <th>Modal</th>
                      <th>Registro</th>
                      <th>HAWB</th>
                      <th>Embarque</th>
                      <th>Desembaraço</th>
                      <th>Prev. Chegada</th>
                      <th>Criação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedColumn.cards.map((card) => (
                      <tr key={card.id}>
                        <td className="pedro-col-importador" title={card.importador}>
                          {card.importador || "—"}
                        </td>
                        <td>
                          {card.processo_link ? (
                            <a className="pedro-link" href={card.processo_link} target="_blank" rel="noreferrer">
                              {card.codigo || `#${card.id}`}
                            </a>
                          ) : (
                            card.codigo || `#${card.id}`
                          )}
                        </td>
                        <td>{card.ref_cliente || "—"}</td>
                        <td>
                          {card.modal ? <span className="pedro-modal-pill">{card.modal}</span> : "—"}
                        </td>
                        <td className="pedro-col-mono">{card.registro || "—"}</td>
                        <td className="pedro-col-mono">{card.hawb || "—"}</td>
                        <td>{formatSigraDate(card.dt_embarque)}</td>
                        <td>{formatSigraDate(card.dt_desembaraco)}</td>
                        <td>{formatSigraDate(card.previsao_chegada)}</td>
                        <td>{formatSigraDate(card.dt_criacao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}
    </section>
  );
}
