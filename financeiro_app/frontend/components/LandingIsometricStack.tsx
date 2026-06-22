"use client";

import "./landing-isometric-stack.css";

type LandingModuleKey = "financeiro" | "rh" | "fila";

type StackLayer = {
  key: LandingModuleKey;
  label: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  anchor: string;
};

const STACK_LAYERS: StackLayer[] = [
  {
    key: "financeiro",
    label: "Financeiro",
    src: "/brand/landing/financeiro-painel.png",
    alt: "Painel Financeiro: conciliação Banco do Brasil e Itaú/SIGRA",
    width: 3200,
    height: 1800,
    anchor: "lp-mod-financeiro",
  },
  {
    key: "rh",
    label: "Recursos Humanos",
    src: "/brand/landing/rh-painel.png",
    alt: "Módulo RH: dashboard de pessoas, setores e folha",
    width: 3200,
    height: 1800,
    anchor: "lp-mod-rh",
  },
  {
    key: "fila",
    label: "Fila de Automações",
    src: "/brand/landing/fila-painel.png",
    alt: "Fila de Automações: solicitações e acompanhamento em tempo real",
    width: 1024,
    height: 494,
    anchor: "lp-mod-fila",
  },
];

export function LandingIsometricStack() {
  const scrollToModule = (anchor: string) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="lp-iso-stack" aria-label="Prévia dos módulos KIVO">
      <div className="lp-iso-stack-scene">
        <span className="lp-iso-stack-backdrop" aria-hidden="true" />
        <div className="lp-iso-stack-stage">
          {STACK_LAYERS.map((layer, index) => (
            <button
              key={layer.key}
              type="button"
              className={`lp-iso-stack-card lp-iso-stack-card--${layer.key}`}
              onClick={() => scrollToModule(layer.anchor)}
              aria-label={`Ver módulo ${layer.label}`}
            >
              <div className="lp-iso-stack-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={layer.src}
                  alt={layer.alt}
                  width={layer.width}
                  height={layer.height}
                  className="lp-iso-stack-img"
                  decoding="async"
                  loading={index === STACK_LAYERS.length - 1 ? "eager" : "lazy"}
                  draggable={false}
                />
                <span className="lp-iso-stack-shimmer" aria-hidden="true" />
                <span className="lp-iso-stack-gloss" aria-hidden="true" />
              </div>
              <span className="lp-iso-stack-label">{layer.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
