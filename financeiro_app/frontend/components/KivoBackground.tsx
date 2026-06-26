/** Fundo fixo — gradiente (visitante) ou sala ambient (logado) */
export function KivoBackground() {
  return (
    <div className="kivo-bg-root" aria-hidden="true">
      <div className="kivo-bg-layer kivo-bg-layer--degrade" />
      <div className="kivo-bg-layer kivo-bg-layer--home" />
      <div className="kivo-bg-layer kivo-bg-layer--config" />
      <div className="kivo-bg-layer kivo-bg-layer--ambient" />
    </div>
  );
}
