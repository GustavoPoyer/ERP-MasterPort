"use client";

import type { AutomationFormField } from "../lib/operacoesAutomationSchema";

type OperacoesCardPreviewProps = {
  name: string;
  description: string;
  scriptPath: string;
  fields: AutomationFormField[];
};

export function OperacoesCardPreview({ name, description, scriptPath, fields }: OperacoesCardPreviewProps) {
  const schema = fields;
  const displayName = name.trim() || "Nome da automação";
  const scriptFile = scriptPath.split("/").pop() || scriptPath || "run.py";
  const hasFileFields = schema.some((field) => field.type === "file");
  const textOnly = schema.length > 0 && schema.every((field) => field.type === "text");

  return (
    <div className="platform-operacoes-card-preview-wrap">
      <article className="platform-operacoes-card platform-operacoes-card--preview" aria-hidden="true">
        <header className="platform-operacoes-card-head">
          <div className="platform-operacoes-card-title-row">
            <div className="platform-operacoes-card-title-block">
              <h3 className={!name.trim() ? "platform-operacoes-card-preview-placeholder" : undefined}>
                {displayName}
              </h3>
              <code className="platform-operacoes-card-path" title={scriptPath || undefined}>
                {scriptFile}
              </code>
            </div>
            <div className="platform-operacoes-card-actions platform-operacoes-card-actions--preview">
              <span className="platform-operacoes-card-edit" aria-hidden="true">
                ✎
              </span>
              <span className="platform-operacoes-card-remove" aria-hidden="true">
                ×
              </span>
            </div>
          </div>
          {description.trim() ? (
            <p className="platform-operacoes-card-desc">{description.trim()}</p>
          ) : (
            <p className="platform-operacoes-card-desc platform-operacoes-card-preview-placeholder">
              Descrição opcional da automação
            </p>
          )}
        </header>

        {schema.length > 0 ? (
          <div className="platform-operacoes-card-fields">
            {schema.map((field) => {
              if (field.type === "text") {
                return (
                  <div key={field.key} className="platform-operacoes-card-field">
                    <span>
                      {field.label.trim() || "Campo de texto"}
                      {field.required ? <em className="platform-operacoes-required">*</em> : null}
                    </span>
                    <input
                      type="text"
                      readOnly
                      tabIndex={-1}
                      value={field.default_value || ""}
                      placeholder={field.placeholder || "Digite aqui…"}
                    />
                  </div>
                );
              }

              return (
                <div key={field.key} className="platform-operacoes-card-field platform-operacoes-card-field--file">
                  <span>
                    {field.label.trim() || "Anexar arquivo"}
                    {field.required ? <em className="platform-operacoes-required">*</em> : null}
                  </span>
                  <div className="platform-operacoes-card-file-row">
                    <span className="platform-operacoes-upload-btn platform-operacoes-upload-btn--inline">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M12 16V6m0 0l-3.5 3.5M12 6l3.5 3.5" />
                        <path d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2" />
                      </svg>
                      <span className="platform-operacoes-upload-label">Anexar</span>
                    </span>
                    <span className="platform-operacoes-files-count">Nenhum arquivo</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="platform-operacoes-card-preview-empty-fields">
            <p>Card sem campos — só nome, descrição e botão executar.</p>
          </div>
        )}

        <footer className="platform-operacoes-card-footer">
          {schema.length === 0 ? (
            <span className="platform-operacoes-files-count">Sem campos de entrada</span>
          ) : textOnly ? (
            <span className="platform-operacoes-files-count">Somente campos de texto</span>
          ) : hasFileFields ? (
            <span className="platform-operacoes-files-count">Nenhum arquivo anexado</span>
          ) : (
            <span className="platform-operacoes-files-count">Pronto para executar</span>
          )}
          <span className="platform-operacoes-run-btn platform-operacoes-run-btn--preview">Executar</span>
        </footer>
      </article>
      <p className="platform-operacoes-card-preview-note">Atualiza em tempo real conforme você edita.</p>
    </div>
  );
}
