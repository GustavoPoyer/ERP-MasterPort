import "./kivo-loader.css";

/** Atraso mínimo só para visualizar o loader — zerar em produção */
export const KIVO_LOADER_PREVIEW_MS = 2500;

export async function waitMinLoaderTime(startedAt: number): Promise<void> {
  if (!KIVO_LOADER_PREVIEW_MS) return;
  const remaining = KIVO_LOADER_PREVIEW_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export type KivoLoaderSize = "sm" | "md" | "lg";

type KivoLoaderProps = {
  /** Texto para leitores de tela */
  label?: string;
  size?: KivoLoaderSize;
  className?: string;
  /** Centraliza e cobre o container pai (position: relative) */
  overlay?: boolean;
  /** Exibe legenda abaixo do logotipo animado */
  showLabel?: boolean;
};

/**
 * Loader KIVO — animação inspirada em Uiverse (jack0237), adaptada à marca:
 * K, I, V em branco e O como anel verde limão.
 */
export function KivoLoader({
  label = "Carregando…",
  size = "md",
  className = "",
  overlay = false,
  showLabel = false,
}: KivoLoaderProps) {
  const wrapClass = [
    "kivo-loader-wrap",
    overlay ? "kivo-loader-wrap--overlay" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClass} role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <div className={`kivo-loader kivo-loader--${size}`}>
        <span className="kivo-loader-char" aria-hidden>
          K
        </span>
        <span className="kivo-loader-char" aria-hidden>
          I
        </span>
        <span className="kivo-loader-char" aria-hidden>
          V
        </span>
        <span className="kivo-loader-o" aria-hidden />
      </div>
      {showLabel && label ? <p className="kivo-loader-label">{label}</p> : null}
    </div>
  );
}
