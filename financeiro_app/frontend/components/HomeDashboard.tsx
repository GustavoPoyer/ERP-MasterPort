"use client";

import { useEffect, useMemo, useState } from "react";
import { KivoRobot } from "./KivoRobot";

export type HomeSectorKey = "financeiro" | "pedro" | "rh" | "operacoes";

type HomeSector = {
  key: HomeSectorKey;
  label: string;
  subtitle: string;
};

type HomeRun = {
  id: number;
  automation_key: string;
  status: string;
  triggered_by: string;
  created_at: string;
};

type HomeTotals = {
  total: number;
  completed: number;
  running: number;
  failed: number;
};

type HomeDashboardProps = {
  username: string;
  sectors: HomeSector[];
  filaLabel: string;
  filaSubtitle: string;
  totals: HomeTotals;
  recentRuns: HomeRun[];
  onSelectSector: (key: HomeSectorKey) => void;
  onSelectFila: () => void;
};

function SectorIcon({ sector }: { sector: HomeSectorKey }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5 };
  if (sector === "financeiro") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
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

function runStatusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "completed") return "Concluída";
  if (normalized === "running") return "Em andamento";
  if (normalized === "failed") return "Falhou";
  if (normalized === "queued") return "Na fila";
  return status;
}

function automationLabel(key: string) {
  if (key === "bb") return "Banco do Brasil";
  if (key === "itau_sigra") return "Itaú / SIGRA";
  return key;
}

function formatRunTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function HomeDashboard({
  username,
  sectors,
  filaLabel,
  filaSubtitle,
  totals,
  recentRuns,
  onSelectSector,
  onSelectFila,
}: HomeDashboardProps) {
  const clock = useClock();
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const completionRate = useMemo(() => {
    if (totals.total === 0) return 0;
    return Math.round((totals.completed / totals.total) * 100);
  }, [totals.completed, totals.total]);

  const statItems = [
    { label: "Execuções", value: totals.total, tone: "neutral" as const },
    { label: "Concluídas", value: totals.completed, tone: "ok" as const },
    { label: "Em andamento", value: totals.running, tone: "active" as const },
    { label: "Falhas", value: totals.failed, tone: "warn" as const },
  ];

  const chartBars = [
    { label: "Concluídas", value: totals.completed, tone: "ok" as const },
    { label: "Em andamento", value: totals.running, tone: "active" as const },
    { label: "Falhas", value: totals.failed, tone: "warn" as const },
  ];

  const chartMax = Math.max(totals.total, totals.completed, totals.running, totals.failed, 1);

  return (
    <section className="spatial-home" aria-label="Painel inicial ERP">
      <header className="spatial-home-top">
        <div className="spatial-home-pills">
          <span className="spatial-pill spatial-pill--brand">
            <span className="spatial-pill-dot" aria-hidden="true" />
            KIVO ERP
          </span>
          <span className="spatial-pill">
            <span className="spatial-pill-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
              </svg>
            </span>
            {username}
          </span>
          <span className="spatial-pill spatial-pill--muted">{today}</span>
        </div>
        <span className="spatial-pill spatial-pill--time">{clock}</span>
      </header>

      <div className="spatial-home-layout">
        <div className="spatial-home-col spatial-home-col--main">
          <article className="spatial-glass spatial-hero">
            <div className="spatial-hero-copy">
              <p className="spatial-eyebrow">Spatial workspace</p>
              <h2 className="spatial-hero-title">Central operacional corporativa</h2>
              <p className="spatial-hero-lead">
                Painel unificado para analytics, status de execução e navegação rápida entre módulos do ecossistema
                KIVO.
              </p>
            </div>
            <div className="spatial-hero-mascot" aria-hidden="true">
              <div className="spatial-hero-mascot-glow" />
              <KivoRobot mood="idle" className="spatial-hero-robot" title="" />
            </div>
          </article>

          <div className="spatial-section">
            <header className="spatial-section-label">
              <div>
                <span>Analytics</span>
                <p>Visão geral de performance operacional</p>
              </div>
              <span className="spatial-section-metric">
                {completionRate}% <small>conclusão</small>
              </span>
            </header>
            <article className="spatial-glass spatial-analytics">
              <div className="spatial-stats-grid" aria-label="Indicadores">
                {statItems.map((item) => (
                  <div key={item.label} className={`spatial-stat spatial-stat--${item.tone}`}>
                    <span className="spatial-stat-label">{item.label}</span>
                    <strong className="spatial-stat-value">{item.value}</strong>
                  </div>
                ))}
              </div>
              <div className="spatial-chart" aria-label="Distribuição de execuções">
                <p className="spatial-chart-title">Distribuição por status</p>
                <div className="spatial-chart-bars">
                  {chartBars.map((bar) => (
                    <div key={bar.label} className="spatial-chart-row">
                      <span className="spatial-chart-label">{bar.label}</span>
                      <div className="spatial-chart-track">
                        <div
                          className={`spatial-chart-fill spatial-chart-fill--${bar.tone}`}
                          style={{ width: `${Math.max(6, (bar.value / chartMax) * 100)}%` }}
                        />
                      </div>
                      <span className="spatial-chart-value">{bar.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </div>

          <div className="spatial-section">
            <header className="spatial-section-label">
              <div>
                <span>Quick navigation</span>
                <p>Acesso rápido aos módulos liberados</p>
              </div>
              <span className="spatial-panel-badge">{sectors.length} setores</span>
            </header>
            <article className="spatial-glass spatial-modules-panel">
              <div className="spatial-modules-grid">
                {sectors.map((sector) => (
                  <button
                    key={sector.key}
                    type="button"
                    className={`spatial-module spatial-module--${sector.key}`}
                    onClick={() => onSelectSector(sector.key)}
                  >
                    <span className="spatial-module-icon" aria-hidden="true">
                      <SectorIcon sector={sector.key} />
                    </span>
                    <span className="spatial-module-body">
                      <strong>{sector.label}</strong>
                      <span>{sector.subtitle}</span>
                    </span>
                    <span className="spatial-module-chevron" aria-hidden="true">
                      →
                    </span>
                  </button>
                ))}
                <button type="button" className="spatial-module spatial-module--fila" onClick={onSelectFila}>
                  <span className="spatial-module-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M5 6h14v12H5z" />
                      <path d="M8 10h8M8 14h5" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </span>
                  <span className="spatial-module-body">
                    <strong>{filaLabel}</strong>
                    <span>{filaSubtitle}</span>
                  </span>
                  <span className="spatial-module-chevron" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>
            </article>
          </div>
        </div>

        <aside className="spatial-home-col spatial-home-col--aside">
          <div className="spatial-section">
            <header className="spatial-section-label">
              <div>
                <span>Execution status</span>
                <p>Monitoramento em tempo real</p>
              </div>
              {totals.running > 0 ? (
                <span className="spatial-live-badge">
                  <span className="spatial-live-dot" aria-hidden="true" />
                  Live
                </span>
              ) : null}
            </header>
            <article className="spatial-glass spatial-activity">
              {recentRuns.length > 0 ? (
                <ul className="spatial-activity-list">
                  {recentRuns.map((run) => (
                    <li
                      key={run.id}
                      className={`spatial-activity-item spatial-activity-item--${run.status.toLowerCase()}`}
                    >
                      <div className="spatial-activity-item-head">
                        <strong>#{run.id}</strong>
                        <span className="spatial-activity-status">{runStatusLabel(run.status)}</span>
                      </div>
                      <p className="spatial-activity-meta">{automationLabel(run.automation_key)}</p>
                      <time className="spatial-activity-time" dateTime={run.created_at}>
                        {formatRunTime(run.created_at)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="spatial-empty">Nenhuma execução registrada ainda.</p>
              )}
            </article>
          </div>

          <div className="spatial-section">
            <header className="spatial-section-label">
              <div>
                <span>Control widgets</span>
                <p>Atalhos do ambiente</p>
              </div>
            </header>
            <article className="spatial-glass spatial-widget">
              <div className="spatial-widget-actions">
                {sectors[0] ? (
                  <button type="button" className="spatial-widget-btn spatial-widget-btn--primary" onClick={() => onSelectSector(sectors[0].key)}>
                    <span className="spatial-widget-icon" aria-hidden="true">
                      <SectorIcon sector={sectors[0].key} />
                    </span>
                    <span className="spatial-widget-label">
                      <span className="spatial-widget-step">1</span>
                      Ir para {sectors[0].label}
                    </span>
                  </button>
                ) : null}
                <button type="button" className="spatial-widget-btn" onClick={onSelectFila}>
                  <span className="spatial-widget-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 6h16M4 12h10M4 18h14" />
                    </svg>
                  </span>
                  <span className="spatial-widget-label">
                    {sectors[0] ? <span className="spatial-widget-step">2</span> : null}
                    Abrir fila de automações
                  </span>
                </button>
              </div>
              <p className="spatial-assistant-hint">
                <KivoRobot mood="peek" className="spatial-hint-robot" />
                Assistente KIVO disponível no canto da tela.
              </p>
            </article>
          </div>
        </aside>
      </div>
    </section>
  );
}
