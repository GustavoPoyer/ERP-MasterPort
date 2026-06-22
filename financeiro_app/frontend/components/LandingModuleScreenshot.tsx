"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import "./landing-module-screenshot.css";

export type LandingModuleKey = "financeiro" | "rh" | "fila";

type LandingModuleScreenshotProps = {
  module: LandingModuleKey;
};

const SCREENSHOT_CONFIG: Record<
  LandingModuleKey,
  { src: string; alt: string; width: number; height: number; layer: number }
> = {
  financeiro: {
    src: "/brand/landing/financeiro-painel.png",
    alt: "Painel Financeiro: conciliação Banco do Brasil e Itaú/SIGRA",
    width: 3200,
    height: 1800,
    layer: 1,
  },
  rh: {
    src: "/brand/landing/rh-painel.png",
    alt: "Módulo RH: dashboard de pessoas, setores e folha",
    width: 3200,
    height: 1800,
    layer: 2,
  },
  fila: {
    src: "/brand/landing/fila-painel.png",
    alt: "Fila de Automações: solicitações e acompanhamento em tempo real",
    width: 1024,
    height: 496,
    layer: 3,
  },
};

export function LandingModuleScreenshot({ module }: LandingModuleScreenshotProps) {
  const config = SCREENSHOT_CONFIG[module];

  return (
    <div
      className={`lp-iso-shot lp-iso-shot--${module}`}
      style={{ "--lp-iso-layer": config.layer } as CSSProperties}
    >
      <div className="lp-iso-shot-stage">
        <span className="lp-iso-shot-plate lp-iso-shot-plate--far" aria-hidden="true" />
        <span className="lp-iso-shot-plate lp-iso-shot-plate--near" aria-hidden="true" />
        <div className="lp-iso-shot-tilt">
          <div className="lp-module-shot-frame">
            <Image
              src={config.src}
              alt={config.alt}
              width={config.width}
              height={config.height}
              quality={100}
              unoptimized
              sizes="(min-width: 1200px) 620px, (min-width: 768px) 50vw, 100vw"
              className="lp-module-shot-img"
            />
            <span className="lp-module-shot-gloss" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
