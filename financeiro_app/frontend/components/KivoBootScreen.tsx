"use client";

import Image from "next/image";
import { KivoLoader } from "./KivoLoader";
import "./kivo-boot.css";

export const KIVO_BOOT_MIN_MS = 720;
export const KIVO_BOOT_EXIT_MS = 180;

export async function waitMinBootTime(startedAt: number): Promise<void> {
  const remaining = KIVO_BOOT_MIN_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

type KivoBootScreenProps = {
  title?: string;
  subtitle?: string;
  exiting?: boolean;
};

export function KivoBootScreen({
  title = "Carregando…",
  subtitle = "Preparando ambiente de autenticação",
  exiting = false,
}: KivoBootScreenProps) {
  return (
    <main className={`kivo-boot-screen ${exiting ? "kivo-boot-screen--exit" : ""}`} aria-busy={!exiting}>
      <div className="kivo-boot-card">
        <div className="kivo-boot-glow" aria-hidden="true" />
        <div className="kivo-boot-logo">
          <Image
            src="/brand/kivo-logotipo.png"
            alt="KIVO"
            width={168}
            height={48}
            className="kivo-boot-logo-img"
            priority
          />
        </div>
        <KivoLoader size="lg" label={title} showLabel />
        <p className="kivo-boot-subtitle">{subtitle}</p>
        <div className="kivo-boot-progress" aria-hidden="true">
          <span className="kivo-boot-progress-bar" />
        </div>
      </div>
    </main>
  );
}
