/** Camadas de fundo fixas — crossfade via data-kivo-bg no html */
export function KivoBackground() {
  return (
    <div className="kivo-bg-root" aria-hidden="true">
      <div className="kivo-bg-layer kivo-bg-layer--degrade" />
      <div className="kivo-bg-layer kivo-bg-layer--config" />
    </div>
  );
}
