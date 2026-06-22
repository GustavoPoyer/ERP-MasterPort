"use client";

type ModuleSpotlight = {
  key: string;
  anchor: string;
  tag: string;
  title: string;
  lead: string;
  features: string[];
};

const MODULES: ModuleSpotlight[] = [
  {
    key: "financeiro",
    anchor: "lp-mod-financeiro",
    tag: "Financeiro",
    title: "Conciliações automatizadas de ponta a ponta",
    lead:
      "Monte rodadas por banco e conta, anexe extratos e comprovantes, e execute conciliações do Banco do Brasil e Itaú/SIGRA sem sair do painel.",
    features: [
      "Upload organizado por tipo de documento e conta",
      "Execução em um clique com status em tempo real",
      "Histórico de execuções, logs e auditoria de rodadas",
    ],
  },
  {
    key: "rh",
    anchor: "lp-mod-rh",
    tag: "Recursos Humanos",
    title: "Gestão de pessoas com visão consolidada",
    lead:
      "Dashboard de folha, setores, calendário e movimentações de RH integrado ao restante da operação — da admissão à folha salarial.",
    features: [
      "Visão geral de colaboradores e folha por setor",
      "Calendário de férias, admissões e demissões",
      "Fluxos de admissão, demissão e controle de folha",
    ],
  },
  {
    key: "fila",
    anchor: "lp-mod-fila",
    tag: "Fila de Automações",
    title: "Solicite e acompanhe automações em tempo real",
    lead:
      "Central de demandas para pedir novas automações, acompanhar o andamento e interagir com a equipe técnica — com prioridade, status e responsável.",
    features: [
      "Abertura de solicitações por setor e prioridade",
      "Comentários, histórico e painel técnico integrado",
      "Atualização automática da fila a cada 20 segundos",
    ],
  },
];

export function LandingModulesShowcase() {
  return (
    <section className="lp-modules-showcase" id="lp-modules" aria-labelledby="lp-modules-title">
      <header className="lp-modules-showcase-intro">
        <span className="lp-modules-kicker">MÓDULOS DA PLATAFORMA</span>
        <h2 id="lp-modules-title">Cada área da operação com sua própria tela.</h2>
        <p>
          Financeiro, RH e fila de automações em módulos dedicados — com a mesma identidade visual e navegação
          unificada. Passe o mouse nas telas acima para explorar.
        </p>
      </header>

      <div className="lp-modules-spotlights">
        {MODULES.map((module, index) => (
          <article
            key={module.key}
            id={module.anchor}
            className={`lp-module-spotlight lp-module-spotlight--${module.key} lp-module-spotlight--copy-only`}
          >
            <div className="lp-module-spotlight-copy">
              <div className="lp-module-spotlight-meta">
                <span className="lp-module-spotlight-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="lp-module-spotlight-tag">{module.tag}</span>
              </div>
              <h3>{module.title}</h3>
              <p className="lp-module-spotlight-lead">{module.lead}</p>
              <ul className="lp-module-spotlight-features">
                {module.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
