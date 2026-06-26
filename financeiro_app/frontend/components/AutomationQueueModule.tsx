"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

type FilaView = "fila" | "minhas" | "nova" | "tecnico";

type FilaMeta = {
  statuses: Record<string, string>;
  priorities: Record<string, string>;
  sectors: Record<string, string>;
  counts_by_status: Record<string, number>;
  open_count: number;
  my_open_count: number;
  email_notifications_enabled: boolean;
};

type FilaComment = {
  id: number;
  ticket_id: number;
  author_username: string;
  author_role: string;
  body: string;
  is_internal: boolean;
  created_at: string;
};

type FilaTicket = {
  id: number;
  title: string;
  description: string;
  request_sector: string;
  request_sector_label: string;
  requester_user_id: number;
  requester_username: string;
  requester_email?: string;
  status: string;
  status_label: string;
  priority: string;
  priority_label: string;
  assigned_to: string;
  resolution_notes: string;
  is_mine: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comment_count: number;
  comments?: FilaComment[];
};

type AutomationQueueModuleProps = {
  apiBase: string;
  authToken: string;
  username: string;
  userSector: string;
  isAdmin: boolean;
};

const STATUS_ACCENTS: Record<string, string> = {
  aberto: "#818cf8",
  em_analise: "#38bdf8",
  em_desenvolvimento: "#facc15",
  aguardando_usuario: "#fb923c",
  concluido: "#4ade80",
  cancelado: "#94a3b8",
};

const PRIORITY_ACCENTS: Record<string, string> = {
  baixa: "#94a3b8",
  normal: "#d9f99d",
  alta: "#fb923c",
  urgente: "#f87171",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

export function AutomationQueueModule({
  apiBase,
  authToken,
  username,
  userSector,
  isAdmin,
}: AutomationQueueModuleProps) {
  const [view, setView] = useState<FilaView>("fila");
  const [meta, setMeta] = useState<FilaMeta | null>(null);
  const [tickets, setTickets] = useState<FilaTicket[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<FilaTicket | null>(null);
  const [technicians, setTechnicians] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newSector, setNewSector] = useState(userSector || "financeiro");
  const [newPriority, setNewPriority] = useState("normal");
  const [newContactEmail, setNewContactEmail] = useState("");

  const [editStatus, setEditStatus] = useState("aberto");
  const [editPriority, setEditPriority] = useState("normal");
  const [editAssigned, setEditAssigned] = useState("");
  const [editResolution, setEditResolution] = useState("");

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }),
    [authToken],
  );

  const apiFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: { ...authHeaders, ...(init?.headers ?? {}) },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.detail === "string" ? payload.detail : "Falha na requisição.");
      }
      return payload as T;
    },
    [apiBase, authHeaders],
  );

  const loadMeta = useCallback(async () => {
    const data = await apiFetch<FilaMeta>("/fila/meta");
    setMeta(data);
  }, [apiFetch]);

  const loadTickets = useCallback(async () => {
    const scope = view === "minhas" ? "mine" : view === "tecnico" ? "open" : "all";
    const query = new URLSearchParams({ scope });
    if (statusFilter) query.set("status", statusFilter);
    const data = await apiFetch<FilaTicket[]>(`/fila/tickets?${query.toString()}`);
    setTickets(data);
    if (selectedId && !data.some((t) => t.id === selectedId)) {
      setSelectedId(null);
      setSelectedTicket(null);
    }
  }, [apiFetch, view, statusFilter, selectedId]);

  const loadTicketDetail = useCallback(
    async (ticketId: number) => {
      const data = await apiFetch<FilaTicket>(`/fila/tickets/${ticketId}`);
      setSelectedTicket(data);
      setEditStatus(data.status);
      setEditPriority(data.priority);
      setEditAssigned(data.assigned_to || "");
      setEditResolution(data.resolution_notes || "");
    },
    [apiFetch],
  );

  const refreshAll = useCallback(async () => {
    setError("");
    try {
      await Promise.all([loadMeta(), loadTickets()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar fila.");
    } finally {
      setLoading(false);
    }
  }, [loadMeta, loadTickets]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedId) return;
    void loadTicketDetail(selectedId).catch((err) => {
      setError(err instanceof Error ? err.message : "Erro ao carregar solicitação.");
    });
  }, [selectedId, loadTicketDetail]);

  useEffect(() => {
    const allowed = meta?.sectors ? Object.keys(meta.sectors) : ["financeiro", "pedro", "rh", "operacoes"];
    if (!allowed.includes(newSector)) {
      setNewSector(allowed.includes(userSector) ? userSector : allowed[0]);
    }
  }, [meta, newSector, userSector]);

  useEffect(() => {
    if (!isAdmin) return;
    void apiFetch<string[]>("/fila/technicians")
      .then(setTechnicians)
      .catch(() => setTechnicians([]));
  }, [isAdmin, apiFetch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshAll();
      if (selectedId) void loadTicketDetail(selectedId).catch(() => null);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [refreshAll, selectedId, loadTicketDetail]);

  const handleCreate = async () => {
    setSubmitting(true);
    setError("");
    try {
      const created = await apiFetch<FilaTicket>("/fila/tickets", {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim(),
          request_sector: newSector,
          priority: newPriority,
          contact_email: newContactEmail.trim(),
        }),
      });
      setNewTitle("");
      setNewDescription("");
      setNewPriority("normal");
      setView("minhas");
      setSelectedId(created.id);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao abrir solicitação.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddComment = async () => {
    if (!selectedId || !commentBody.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/fila/tickets/${selectedId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentBody.trim(), is_internal: commentInternal }),
      });
      setCommentBody("");
      setCommentInternal(false);
      await Promise.all([loadTicketDetail(selectedId), loadTickets(), loadMeta()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao comentar.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminUpdate = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/fila/tickets/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: editStatus,
          priority: editPriority,
          assigned_to: editAssigned,
          resolution_notes: editResolution,
        }),
      });
      await Promise.all([loadTicketDetail(selectedId), loadTickets(), loadMeta()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar solicitação.");
    } finally {
      setSubmitting(false);
    }
  };

  const canComment =
    selectedTicket &&
    (isAdmin || selectedTicket.is_mine) &&
    (isAdmin || !["concluido", "cancelado"].includes(selectedTicket.status));

  const sectorOptions = meta?.sectors ?? {
    financeiro: "Financeiro",
    pedro: "Importação",
    rh: "RH",
    operacoes: "Operações",
  };

  if (loading && !meta) {
    return (
      <section className="app-shell app-shell--fila">
        <div className="fila-loading panel">
          <p className="subtitle">Carregando fila de automações…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="app-shell app-shell--fila">
      <header className="fila-head panel">
        <div className="fila-head-copy">
          <span className="fila-head-eyebrow">Central de demandas</span>
          <h2 className="fila-head-title">Fila de Automações</h2>
          <p className="subtitle">
            Solicite novas automações, acompanhe o andamento em tempo real e interaja com a equipe técnica.
          </p>
        </div>
        <div className="fila-head-stats">
          <div className="fila-stat">
            <span className="fila-stat-value">{meta?.open_count ?? 0}</span>
            <span className="fila-stat-label">Em aberto</span>
          </div>
          <div className="fila-stat">
            <span className="fila-stat-value">{meta?.my_open_count ?? 0}</span>
            <span className="fila-stat-label">Suas abertas</span>
          </div>
        </div>
      </header>

      <nav className="fila-subnav" aria-label="Visões da fila">
        <button type="button" className={`module-subnav-btn${view === "fila" ? " active" : ""}`} onClick={() => setView("fila")}>
          Fila geral
        </button>
        <button type="button" className={`module-subnav-btn${view === "minhas" ? " active" : ""}`} onClick={() => setView("minhas")}>
          Minhas solicitações
        </button>
        <button type="button" className={`module-subnav-btn${view === "nova" ? " active" : ""}`} onClick={() => setView("nova")}>
          Nova solicitação
        </button>
        {isAdmin ? (
          <button type="button" className={`module-subnav-btn${view === "tecnico" ? " active" : ""}`} onClick={() => setView("tecnico")}>
            Painel técnico
          </button>
        ) : null}
      </nav>

      {error ? <p className="fila-error">{error}</p> : null}

      {view === "nova" ? (
        <section className="fila-new panel">
          <h3>Abrir nova solicitação</h3>
          <p className="subtitle">Descreva a automação desejada. A equipe técnica receberá na fila.</p>
          {meta?.email_notifications_enabled ? (
            <p className="fila-email-hint">Você receberá e-mail quando o status da solicitação mudar.</p>
          ) : (
            <p className="fila-email-hint fila-email-hint--muted">
              Notificações por e-mail desativadas (SMTP não configurado no servidor).
            </p>
          )}
          <div className="fila-form-grid">
            <label>
              Título
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Ex.: Conciliar extrato X com planilha Y" maxLength={200} />
            </label>
            <label>
              Setor
              <select value={newSector} onChange={(e) => setNewSector(e.target.value)}>
                {Object.entries(sectorOptions).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridade
              <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)}>
                {Object.entries(meta?.priorities ?? { normal: "Normal" }).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              E-mail para atualizações
              <input
                type="email"
                value={newContactEmail}
                onChange={(e) => setNewContactEmail(e.target.value)}
                placeholder="seu.email@empresa.com"
                autoComplete="email"
              />
            </label>
            <label className="fila-form-grid--wide">
              Descrição
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={6}
                placeholder="Contexto, arquivos envolvidos, frequência, resultado esperado…"
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitting || newTitle.trim().length < 3 || newDescription.trim().length < 10}
            onClick={() => void handleCreate()}
          >
            {submitting ? "Enviando…" : "Enviar solicitação"}
          </button>
        </section>
      ) : (
        <div className="fila-layout">
          <section className="fila-list panel">
            <header className="fila-list-head">
              <div>
                <h3>{view === "minhas" ? "Minhas solicitações" : view === "tecnico" ? "Chamados em aberto" : "Fila geral"}</h3>
                <p>{tickets.length} registro{tickets.length === 1 ? "" : "s"} · atualiza a cada 20s</p>
              </div>
              <label className="fila-filter">
                Status
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Todos</option>
                  {Object.entries(meta?.statuses ?? {}).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </header>

            {tickets.length === 0 ? (
              <p className="fila-empty">Nenhuma solicitação nesta visão.</p>
            ) : (
              <ul className="fila-ticket-list">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      className={`fila-ticket-item${selectedId === ticket.id ? " active" : ""}${ticket.is_mine ? " mine" : ""}`}
                      onClick={() => setSelectedId(ticket.id)}
                    >
                      <div className="fila-ticket-item-top">
                        <strong>#{ticket.id} · {ticket.title}</strong>
                        {ticket.is_mine ? <span className="fila-mine-pill">Sua</span> : null}
                      </div>
                      <div className="fila-ticket-item-meta">
                        <span className="fila-status-pill" style={{ "--fila-accent": STATUS_ACCENTS[ticket.status] || "#94a3b8" } as CSSProperties}>
                          {ticket.status_label}
                        </span>
                        <span className="fila-priority-pill" style={{ "--fila-accent": PRIORITY_ACCENTS[ticket.priority] || "#d9f99d" } as CSSProperties}>
                          {ticket.priority_label}
                        </span>
                        <span>{ticket.request_sector_label}</span>
                        <span>{ticket.requester_username}</span>
                      </div>
                      <p className="fila-ticket-item-time">Atualizado {formatDateTime(ticket.updated_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="fila-detail panel">
            {!selectedTicket ? (
              <p className="fila-empty">Selecione uma solicitação para ver detalhes.</p>
            ) : (
              <>
                <header className="fila-detail-head">
                  <div>
                    <span className="fila-detail-id">#{selectedTicket.id}</span>
                    <h3>{selectedTicket.title}</h3>
                    <p>
                      {selectedTicket.request_sector_label} · {selectedTicket.requester_username} · aberto{" "}
                      {formatDateTime(selectedTicket.created_at)}
                    </p>
                    {selectedTicket.requester_email ? (
                      <p className="fila-detail-email">
                        E-mail de atualizações: <strong>{selectedTicket.requester_email}</strong>
                      </p>
                    ) : (
                      <p className="fila-detail-email fila-detail-email--warn">
                        Nenhum e-mail cadastrado — a pessoa não receberá avisos automáticos.
                      </p>
                    )}
                  </div>
                  <div className="fila-detail-badges">
                    <span className="fila-status-pill" style={{ "--fila-accent": STATUS_ACCENTS[selectedTicket.status] || "#94a3b8" } as CSSProperties}>
                      {selectedTicket.status_label}
                    </span>
                    <span className="fila-priority-pill" style={{ "--fila-accent": PRIORITY_ACCENTS[selectedTicket.priority] || "#d9f99d" } as CSSProperties}>
                      {selectedTicket.priority_label}
                    </span>
                  </div>
                </header>

                <div className="fila-detail-body">
                  <h4>Descrição</h4>
                  <p className="fila-description">{selectedTicket.description}</p>

                  {selectedTicket.assigned_to ? (
                    <p className="fila-assigned">
                      Responsável técnico: <strong>{selectedTicket.assigned_to}</strong>
                    </p>
                  ) : null}

                  {selectedTicket.resolution_notes ? (
                    <div className="fila-resolution">
                      <h4>Resolução</h4>
                      <p>{selectedTicket.resolution_notes}</p>
                    </div>
                  ) : null}

                  {isAdmin ? (
                    <div className="fila-tech-panel">
                      <h4>Painel do técnico</h4>
                      <p className="fila-tech-note">
                        O e-mail é enviado quando o <strong>status</strong> mudar (para o e-mail acima e os admins).
                      </p>
                      <div className="fila-form-grid">
                        <label>
                          Status
                          <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                            {Object.entries(meta?.statuses ?? {}).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Prioridade
                          <select value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                            {Object.entries(meta?.priorities ?? {}).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Responsável
                          <select value={editAssigned} onChange={(e) => setEditAssigned(e.target.value)}>
                            <option value="">Não atribuído</option>
                            {technicians.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="fila-form-grid--wide">
                          Notas de resolução
                          <textarea value={editResolution} onChange={(e) => setEditResolution(e.target.value)} rows={4} />
                        </label>
                      </div>
                      <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => void handleAdminUpdate()}>
                        {submitting ? "Salvando…" : "Salvar alterações"}
                      </button>
                    </div>
                  ) : null}

                  <div className="fila-timeline">
                    <h4>Histórico</h4>
                    <ul>
                      {(selectedTicket.comments ?? []).map((comment) => (
                        <li key={comment.id} className={comment.is_internal ? "internal" : ""}>
                          <header>
                            <strong>{comment.author_username}</strong>
                            <span>{formatDateTime(comment.created_at)}</span>
                            {comment.is_internal ? <span className="fila-internal-pill">Interno</span> : null}
                          </header>
                          <p>{comment.body}</p>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {canComment ? (
                    <div className="fila-comment-compose">
                      <label>
                        Novo comentário
                        <textarea value={commentBody} onChange={(e) => setCommentBody(e.target.value)} rows={3} placeholder="Escreva uma atualização ou dúvida…" />
                      </label>
                      {isAdmin ? (
                        <label className="fila-internal-check">
                          <input type="checkbox" checked={commentInternal} onChange={(e) => setCommentInternal(e.target.checked)} />
                          Nota interna (só admins)
                        </label>
                      ) : null}
                      <button type="button" className="btn btn-secondary" disabled={submitting || !commentBody.trim()} onClick={() => void handleAddComment()}>
                        Enviar comentário
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
