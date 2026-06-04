"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type RhView =
  | "visao"
  | "colaboradores"
  | "solicitacoes"
  | "documentos"
  | "calendario"
  | "onboarding";

export const RH_VIEW_LABELS: Record<RhView, string> = {
  visao: "Visão geral",
  colaboradores: "Colaboradores",
  solicitacoes: "Solicitações",
  documentos: "Documentos",
  calendario: "Calendário",
  onboarding: "Admissão",
};

type HrDashboard = {
  active_employees: number;
  total_employees: number;
  pending_requests: number;
  birthdays_this_month: number;
  documents_due_soon: number;
  recent_hires: number;
};

type HrEmployee = {
  id: number;
  full_name: string;
  job_title: string;
  department: string;
  email: string;
  phone: string;
  hire_date: string;
  birth_date: string;
  status: string;
  manager_name: string;
  notes: string;
};

type HrRequest = {
  id: number;
  employee_id: number;
  employee_name: string;
  request_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  reviewed_by: string;
};

type HrDocument = {
  id: number;
  employee_id: number;
  employee_name: string;
  doc_type: string;
  status: string;
  due_date: string;
  notes: string;
};

type HrCalendarEvent = {
  kind: string;
  title: string;
  date: string;
  detail: string;
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  ferias: "Férias",
  atestado: "Atestado médico",
  folga: "Folga / banco de horas",
  home_office: "Home office",
  licenca: "Licença",
  outro: "Outro",
};

const STATUS_LABELS: Record<string, string> = {
  ativo: "Ativo",
  afastado: "Afastado",
  ferias: "Em férias",
  desligado: "Desligado",
  pendente: "Pendente",
  aprovado: "Aprovado",
  recusado: "Recusado",
  ok: "Em dia",
  vencido: "Vencido",
  nao_aplica: "Não se aplica",
};

const ONBOARDING_STEPS = [
  "Coletar documentos pessoais (RG, CPF, comprovante de residência)",
  "Assinatura do contrato e ficha de registro",
  "Cadastro no eSocial e folha de pagamento",
  "Exame admissional (ASO) e integração de segurança",
  "Entrega de equipamentos e acessos (e-mail, sistemas)",
  "Apresentação à equipe e definição do gestor",
];

type RhPanelProps = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onViewChange?: (view: RhView) => void;
};

function parseError(res: Response, fallback: string): Promise<string> {
  return res
    .json()
    .then((data) => {
      const detail = data?.detail;
      if (typeof detail === "string") {
        if (detail === "Not Found" && res.status === 404) {
          return "API de RH indisponível. Reinicie o backend (start_app.ps1) e recarregue a página.";
        }
        if (res.status === 403) {
          return `${detail} Use o login rh/rh123 ou admin/admin123.`;
        }
        return detail;
      }
      return fallback;
    })
    .catch(() => fallback);
}

function formatBrDate(iso: string): string {
  if (!iso || iso.length < 10) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function RhPanel({ apiFetch, onViewChange }: RhPanelProps) {
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;

  const [rhView, setRhView] = useState<RhView>("visao");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [dashboard, setDashboard] = useState<HrDashboard | null>(null);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [requests, setRequests] = useState<HrRequest[]>([]);
  const [documents, setDocuments] = useState<HrDocument[]>([]);
  const [calendar, setCalendar] = useState<HrCalendarEvent[]>([]);

  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);

  const [newEmployee, setNewEmployee] = useState({
    full_name: "",
    job_title: "",
    department: "",
    email: "",
    hire_date: "",
    birth_date: "",
  });

  const [newRequest, setNewRequest] = useState({
    employee_id: "",
    request_type: "ferias",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const changeView = (view: RhView) => {
    setRhView(view);
    onViewChange?.(view);
    setMessage("");
    setError("");
  };

  const loadDashboard = useCallback(async () => {
    const res = await apiFetchRef.current("/hr/dashboard");
    if (!res.ok) throw new Error(await parseError(res, "Falha ao carregar indicadores."));
    setDashboard((await res.json()) as HrDashboard);
  }, []);

  const loadEmployees = useCallback(async () => {
    const q = employeeSearch.trim();
    const res = await apiFetchRef.current(`/hr/employees${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (!res.ok) throw new Error(await parseError(res, "Falha ao carregar colaboradores."));
    setEmployees((await res.json()) as HrEmployee[]);
  }, [employeeSearch]);

  const loadRequests = useCallback(async () => {
    const res = await apiFetchRef.current("/hr/requests");
    if (!res.ok) throw new Error(await parseError(res, "Falha ao carregar solicitações."));
    setRequests((await res.json()) as HrRequest[]);
  }, []);

  const loadDocuments = useCallback(async () => {
    const res = await apiFetchRef.current("/hr/documents");
    if (!res.ok) throw new Error(await parseError(res, "Falha ao carregar documentos."));
    setDocuments((await res.json()) as HrDocument[]);
  }, []);

  const loadCalendar = useCallback(async () => {
    const res = await apiFetchRef.current("/hr/calendar");
    if (!res.ok) throw new Error(await parseError(res, "Falha ao carregar calendário."));
    setCalendar((await res.json()) as HrCalendarEvent[]);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await loadDashboard();
      if (rhView === "colaboradores" || rhView === "solicitacoes" || rhView === "onboarding") {
        await loadEmployees();
      }
      if (rhView === "solicitacoes") await loadRequests();
      if (rhView === "documentos") await loadDocuments();
      if (rhView === "calendario" || rhView === "visao") await loadCalendar();
      if (rhView === "documentos" && employees.length === 0) await loadEmployees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar módulo RH.");
    } finally {
      setLoading(false);
    }
  }, [rhView, loadDashboard, loadEmployees, loadRequests, loadDocuments, loadCalendar, employees.length]);

  useEffect(() => {
    refresh().catch(() => null);
  }, [rhView]);

  useEffect(() => {
    onViewChange?.(rhView);
  }, [rhView, onViewChange]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );

  async function handleCreateEmployee(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await apiFetchRef.current("/hr/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newEmployee,
        status: "ativo",
      }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Não foi possível cadastrar o colaborador."));
      return;
    }
    setMessage("Colaborador cadastrado. Checklist de documentos criado automaticamente.");
    setNewEmployee({ full_name: "", job_title: "", department: "", email: "", hire_date: "", birth_date: "" });
    await loadEmployees();
    await loadDashboard();
  }

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await apiFetchRef.current("/hr/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: Number(newRequest.employee_id),
        request_type: newRequest.request_type,
        start_date: newRequest.start_date,
        end_date: newRequest.end_date,
        reason: newRequest.reason,
      }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Não foi possível registrar a solicitação."));
      return;
    }
    setMessage("Solicitação registrada e aguardando análise.");
    setNewRequest({ employee_id: "", request_type: "ferias", start_date: "", end_date: "", reason: "" });
    await loadRequests();
    await loadDashboard();
  }

  async function handleRequestStatus(id: number, status: "aprovado" | "recusado") {
    const res = await apiFetchRef.current(`/hr/requests/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Falha ao atualizar solicitação."));
      return;
    }
    setMessage(status === "aprovado" ? "Solicitação aprovada." : "Solicitação recusada.");
    await loadRequests();
    await loadDashboard();
  }

  async function handleDocumentStatus(id: number, status: string) {
    const res = await apiFetchRef.current(`/hr/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError(await parseError(res, "Falha ao atualizar documento."));
      return;
    }
    await loadDocuments();
    await loadDashboard();
  }

  return (
    <section className="platform-rh" aria-label="Módulo de Recursos Humanos">
      <nav className="platform-rh-nav" aria-label="Áreas do RH">
        {(Object.keys(RH_VIEW_LABELS) as RhView[]).map((view) => (
          <button
            key={view}
            type="button"
            className={`platform-rh-nav-btn ${rhView === view ? "active" : ""}`}
            onClick={() => changeView(view)}
          >
            {RH_VIEW_LABELS[view]}
          </button>
        ))}
      </nav>

      {error && <p className="error platform-rh-alert">{error}</p>}
      {message && <p className="info-note platform-rh-alert">{message}</p>}

      {loading && <p className="subtitle">Carregando módulo RH…</p>}

      {!loading && rhView === "visao" && dashboard && (
        <div className="platform-rh-body">
          <p className="platform-rh-intro">
            Central do RH: cadastro de pessoas, férias e ausências, documentos obrigatórios e rotinas de admissão.
            Os dados abaixo são de demonstração — ajuste conforme a política da sua empresa.
          </p>
          <div className="platform-rh-kpi-grid">
            <article className="platform-rh-kpi">
              <span className="platform-rh-kpi-label">Colaboradores ativos</span>
              <strong>{dashboard.active_employees}</strong>
              <span className="muted">de {dashboard.total_employees} no quadro</span>
            </article>
            <article className="platform-rh-kpi">
              <span className="platform-rh-kpi-label">Solicitações pendentes</span>
              <strong>{dashboard.pending_requests}</strong>
              <span className="muted">férias, atestados, etc.</span>
            </article>
            <article className="platform-rh-kpi">
              <span className="platform-rh-kpi-label">Aniversariantes do mês</span>
              <strong>{dashboard.birthdays_this_month}</strong>
            </article>
            <article className="platform-rh-kpi">
              <span className="platform-rh-kpi-label">Docs. pendentes/vencidos</span>
              <strong>{dashboard.documents_due_soon}</strong>
            </article>
          </div>

          <div className="platform-rh-split">
            <article className="panel platform-rh-card">
              <h3>Próximos eventos</h3>
              <ul className="platform-rh-event-list">
                {calendar.slice(0, 8).map((ev, idx) => (
                  <li key={`${ev.kind}-${ev.date}-${idx}`}>
                    <span className={`platform-rh-event-kind platform-rh-event-kind--${ev.kind}`}>
                      {ev.kind === "aniversario" ? "Aniv." : ev.kind === "ausencia" ? "Ausência" : "Admissão"}
                    </span>
                    <div>
                      <strong>{ev.title}</strong>
                      <span className="muted">
                        {formatBrDate(ev.date)}
                        {ev.detail ? ` · ${ev.detail}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
                {calendar.length === 0 && <li className="muted">Nenhum evento neste período.</li>}
              </ul>
            </article>
            <article className="panel platform-rh-card">
              <h3>O que o RH costuma fazer aqui</h3>
              <ul className="platform-rh-checklist">
                <li>Manter cadastro atualizado de colaboradores e gestores</li>
                <li>Aprovar férias, atestados e ausências</li>
                <li>Controlar ASO, eSocial e treinamentos obrigatórios</li>
                <li>Conduzir admissão com checklist padronizado</li>
                <li>Acompanhar aniversários e datas de contrato</li>
              </ul>
            </article>
          </div>
        </div>
      )}

      {!loading && rhView === "colaboradores" && (
        <div className="platform-rh-body">
          <div className="platform-rh-toolbar">
            <input
              type="search"
              placeholder="Buscar por nome, cargo, setor ou e-mail…"
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadEmployees().catch(() => null)}
            />
            <button type="button" className="btn-secondary" onClick={() => loadEmployees().catch(() => null)}>
              Buscar
            </button>
          </div>

          <div className="platform-rh-split platform-rh-split--wide">
            <div className="table-wrapper table-wrapper--scroll">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Cargo</th>
                    <th>Setor</th>
                    <th>Status</th>
                    <th>Admissão</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr
                      key={emp.id}
                      className={selectedEmployeeId === emp.id ? "clickable selected" : "clickable"}
                      onClick={() => setSelectedEmployeeId(emp.id)}
                    >
                      <td>{emp.full_name}</td>
                      <td>{emp.job_title || "—"}</td>
                      <td>{emp.department || "—"}</td>
                      <td>
                        <span className={`platform-rh-pill platform-rh-pill--${emp.status}`}>
                          {STATUS_LABELS[emp.status] ?? emp.status}
                        </span>
                      </td>
                      <td>{formatBrDate(emp.hire_date)}</td>
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={5}>Nenhum colaborador encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <aside className="panel platform-rh-card platform-rh-detail">
              {selectedEmployee ? (
                <>
                  <h3>{selectedEmployee.full_name}</h3>
                  <dl className="platform-rh-dl">
                    <div>
                      <dt>Cargo</dt>
                      <dd>{selectedEmployee.job_title || "—"}</dd>
                    </div>
                    <div>
                      <dt>Setor</dt>
                      <dd>{selectedEmployee.department || "—"}</dd>
                    </div>
                    <div>
                      <dt>E-mail</dt>
                      <dd>{selectedEmployee.email || "—"}</dd>
                    </div>
                    <div>
                      <dt>Telefone</dt>
                      <dd>{selectedEmployee.phone || "—"}</dd>
                    </div>
                    <div>
                      <dt>Gestor</dt>
                      <dd>{selectedEmployee.manager_name || "—"}</dd>
                    </div>
                    <div>
                      <dt>Nascimento</dt>
                      <dd>{formatBrDate(selectedEmployee.birth_date)}</dd>
                    </div>
                  </dl>
                  {selectedEmployee.notes && <p className="subtitle">{selectedEmployee.notes}</p>}
                </>
              ) : (
                <p className="subtitle">Selecione um colaborador na tabela para ver detalhes.</p>
              )}
            </aside>
          </div>
        </div>
      )}

      {!loading && rhView === "solicitacoes" && (
        <div className="platform-rh-body">
          <div className="platform-rh-split">
            <form className="panel platform-rh-card platform-rh-form" onSubmit={handleCreateRequest}>
              <h3>Nova solicitação</h3>
              <label>
                Colaborador
                <select
                  required
                  value={newRequest.employee_id}
                  onChange={(e) => setNewRequest((s) => ({ ...s, employee_id: e.target.value }))}
                >
                  <option value="">Selecione…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo
                <select
                  value={newRequest.request_type}
                  onChange={(e) => setNewRequest((s) => ({ ...s, request_type: e.target.value }))}
                >
                  {Object.entries(REQUEST_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="platform-rh-form-row">
                <label>
                  Início
                  <input
                    type="date"
                    required
                    value={newRequest.start_date}
                    onChange={(e) => setNewRequest((s) => ({ ...s, start_date: e.target.value }))}
                  />
                </label>
                <label>
                  Fim
                  <input
                    type="date"
                    required
                    value={newRequest.end_date}
                    onChange={(e) => setNewRequest((s) => ({ ...s, end_date: e.target.value }))}
                  />
                </label>
              </div>
              <label>
                Motivo / observação
                <textarea
                  rows={3}
                  value={newRequest.reason}
                  onChange={(e) => setNewRequest((s) => ({ ...s, reason: e.target.value }))}
                />
              </label>
              <button type="submit" className="platform-settings-approve-btn">
                Registrar solicitação
              </button>
            </form>

            <div className="table-wrapper table-wrapper--scroll">
              <table>
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Tipo</th>
                    <th>Período</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id}>
                      <td>{req.employee_name}</td>
                      <td>{REQUEST_TYPE_LABELS[req.request_type] ?? req.request_type}</td>
                      <td>
                        {formatBrDate(req.start_date)} — {formatBrDate(req.end_date)}
                      </td>
                      <td>
                        <span className={`platform-rh-pill platform-rh-pill--${req.status}`}>
                          {STATUS_LABELS[req.status] ?? req.status}
                        </span>
                      </td>
                      <td className="platform-rh-actions">
                        {req.status === "pendente" ? (
                          <>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => handleRequestStatus(req.id, "aprovado")}
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => handleRequestStatus(req.id, "recusado")}
                            >
                              Recusar
                            </button>
                          </>
                        ) : (
                          <span className="muted">{req.reviewed_by || "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading && rhView === "documentos" && (
        <div className="platform-rh-body">
          <p className="subtitle">
            Controle de documentos trabalhistas e de segurança (ASO, eSocial, NR-35, contrato). Marque o status conforme
            receber cada item.
          </p>
          <div className="table-wrapper table-wrapper--scroll planilha-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Documento</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th>Atualizar</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.employee_name}</td>
                    <td>{doc.doc_type}</td>
                    <td>{doc.due_date ? formatBrDate(doc.due_date) : "—"}</td>
                    <td>
                      <span className={`platform-rh-pill platform-rh-pill--${doc.status}`}>
                        {STATUS_LABELS[doc.status] ?? doc.status}
                      </span>
                    </td>
                    <td>
                      <select
                        className={`platform-rh-status-select platform-rh-status-select--${doc.status}`}
                        value={doc.status}
                        onChange={(e) => handleDocumentStatus(doc.id, e.target.value)}
                        aria-label={`Status de ${doc.doc_type}`}
                      >
                        <option value="pendente">Pendente</option>
                        <option value="ok">Em dia</option>
                        <option value="vencido">Vencido</option>
                        <option value="nao_aplica">Não se aplica</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && rhView === "calendario" && (
        <div className="platform-rh-body">
          <ul className="platform-rh-event-list platform-rh-event-list--full">
            {calendar.map((ev, idx) => (
              <li key={`${ev.kind}-${ev.date}-${idx}`}>
                <span className={`platform-rh-event-kind platform-rh-event-kind--${ev.kind}`}>
                  {ev.kind === "aniversario" ? "Aniversário" : ev.kind === "ausencia" ? "Ausência" : "Admissão"}
                </span>
                <div>
                  <strong>{ev.title}</strong>
                  <span className="muted">
                    {formatBrDate(ev.date)}
                    {ev.detail ? ` · ${ev.detail}` : ""}
                  </span>
                </div>
              </li>
            ))}
            {calendar.length === 0 && <li className="muted">Nenhum evento cadastrado.</li>}
          </ul>
        </div>
      )}

      {!loading && rhView === "onboarding" && (
        <div className="platform-rh-body">
          <div className="platform-rh-split">
            <article className="panel platform-rh-card">
              <h3>Checklist de admissão</h3>
              <p className="subtitle">Use este roteiro ao integrar um novo colaborador na empresa.</p>
              <ol className="platform-rh-onboarding-steps">
                {ONBOARDING_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>

            <form className="panel platform-rh-card platform-rh-form" onSubmit={handleCreateEmployee}>
              <h3>Cadastrar novo colaborador</h3>
              <label>
                Nome completo
                <input
                  required
                  value={newEmployee.full_name}
                  onChange={(e) => setNewEmployee((s) => ({ ...s, full_name: e.target.value }))}
                />
              </label>
              <label>
                Cargo
                <input
                  value={newEmployee.job_title}
                  onChange={(e) => setNewEmployee((s) => ({ ...s, job_title: e.target.value }))}
                />
              </label>
              <label>
                Setor
                <input
                  value={newEmployee.department}
                  onChange={(e) => setNewEmployee((s) => ({ ...s, department: e.target.value }))}
                />
              </label>
              <label>
                E-mail
                <input
                  type="email"
                  value={newEmployee.email}
                  onChange={(e) => setNewEmployee((s) => ({ ...s, email: e.target.value }))}
                />
              </label>
              <div className="platform-rh-form-row">
                <label>
                  Data de admissão
                  <input
                    type="date"
                    value={newEmployee.hire_date}
                    onChange={(e) => setNewEmployee((s) => ({ ...s, hire_date: e.target.value }))}
                  />
                </label>
                <label>
                  Data de nascimento
                  <input
                    type="date"
                    value={newEmployee.birth_date}
                    onChange={(e) => setNewEmployee((s) => ({ ...s, birth_date: e.target.value }))}
                  />
                </label>
              </div>
              <p className="subtitle">
                Ao salvar, o sistema cria automaticamente o checklist de documentos para este colaborador.
              </p>
              <button type="submit" className="platform-settings-approve-btn">
                Cadastrar e iniciar admissão
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
