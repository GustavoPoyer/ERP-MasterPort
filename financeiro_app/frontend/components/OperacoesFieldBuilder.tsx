"use client";

import type { AutomationFormField } from "../lib/operacoesAutomationSchema";
import { newFileField, newTextField, slugifyFieldKey } from "../lib/operacoesAutomationSchema";

type OperacoesFieldBuilderProps = {
  fields: AutomationFormField[];
  onChange: (fields: AutomationFormField[]) => void;
};

export function OperacoesFieldBuilder({ fields, onChange }: OperacoesFieldBuilderProps) {
  const existingKeys = new Set(fields.map((field) => field.key));

  function updateField(index: number, patch: Partial<AutomationFormField>) {
    onChange(
      fields.map((field, idx) => {
        if (idx !== index) return field;
        return { ...field, ...patch } as AutomationFormField;
      }),
    );
  }

  function removeField(index: number) {
    onChange(fields.filter((_, idx) => idx !== index));
  }

  function moveField(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  }

  function addTextField() {
    onChange([...fields, newTextField(existingKeys)]);
  }

  function addFileField() {
    onChange([...fields, newFileField(existingKeys)]);
  }

  function updateLabel(index: number, label: string) {
    const otherKeys = new Set(fields.filter((_, idx) => idx !== index).map((field) => field.key));
    updateField(index, {
      label,
      key: slugifyFieldKey(label, otherKeys),
    });
  }

  return (
    <section className="platform-operacoes-field-builder" aria-labelledby="operacoes-form-fields">
      <div className="platform-operacoes-field-builder-head">
        <div>
          <div className="platform-operacoes-form-section-title-row">
            <h4 id="operacoes-form-fields" className="platform-operacoes-form-section-title">
              Campos do card
            </h4>
            {fields.length > 0 ? (
              <span className="platform-operacoes-field-count">{fields.length}</span>
            ) : null}
          </div>
          <p>O que o usuário preenche ou anexa ao executar esta automação.</p>
        </div>
        <div className="platform-operacoes-field-builder-add">
          <button
            type="button"
            className="platform-operacoes-btn platform-operacoes-btn--ghost platform-operacoes-btn--sm"
            onClick={addTextField}
          >
            + Texto
          </button>
          <button
            type="button"
            className="platform-operacoes-btn platform-operacoes-btn--ghost platform-operacoes-btn--sm"
            onClick={addFileField}
          >
            + Arquivo
          </button>
        </div>
      </div>

      {fields.length === 0 ? (
        <div className="platform-operacoes-field-builder-empty">
          <p>Nenhum campo no card.</p>
          <p className="platform-operacoes-field-builder-empty-hint">
            Adicione campos de texto ou arquivo se a automação precisar de entrada do usuário.
          </p>
          <div className="platform-operacoes-field-builder-empty-actions">
            <button type="button" className="platform-operacoes-btn platform-operacoes-btn--ghost" onClick={addTextField}>
              Adicionar texto
            </button>
            <button type="button" className="platform-operacoes-btn platform-operacoes-btn--primary" onClick={addFileField}>
              Adicionar arquivo
            </button>
          </div>
        </div>
      ) : (
        <ul className="platform-operacoes-field-list">
          {fields.map((field, index) => (
            <li key={`${field.key}-${index}`} className="platform-operacoes-field-item">
              <div className="platform-operacoes-field-item-head">
                <div className="platform-operacoes-field-item-meta">
                  <span className="platform-operacoes-field-index">Campo {index + 1}</span>
                  <span className={`platform-operacoes-field-type platform-operacoes-field-type--${field.type}`}>
                    {field.type === "text" ? "Texto" : "Arquivo"}
                  </span>
                </div>
                <div className="platform-operacoes-field-item-actions">
                  <button
                    type="button"
                    className="platform-operacoes-field-icon-btn"
                    onClick={() => moveField(index, -1)}
                    disabled={index === 0}
                    aria-label="Mover para cima"
                    title="Mover para cima"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="platform-operacoes-field-icon-btn"
                    onClick={() => moveField(index, 1)}
                    disabled={index === fields.length - 1}
                    aria-label="Mover para baixo"
                    title="Mover para baixo"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="platform-operacoes-field-icon-btn platform-operacoes-field-icon-btn--danger"
                    onClick={() => removeField(index)}
                    aria-label="Remover campo"
                    title="Remover campo"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="platform-operacoes-field-item-grid">
                <label className="platform-operacoes-form-span2">
                  Nome do campo
                  <input
                    required
                    value={field.label}
                    onChange={(e) => updateLabel(index, e.target.value)}
                    placeholder={field.type === "text" ? "Ex.: Número do processo" : "Ex.: Planilha de entrada"}
                  />
                </label>

                <details className="platform-operacoes-field-advanced platform-operacoes-form-span2">
                  <summary>Chave interna (avançado)</summary>
                  <label>
                    Identificador no script
                    <input
                      required
                      value={field.key}
                      onChange={(e) =>
                        updateField(index, {
                          key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                        })
                      }
                      placeholder="numero_processo"
                    />
                    <span className="platform-operacoes-field-hint">Gerada automaticamente a partir do nome do campo</span>
                  </label>
                </details>

                {field.type === "text" ? (
                  <>
                    <label className="platform-operacoes-form-span2">
                      Placeholder <span className="platform-operacoes-optional">opcional</span>
                      <input
                        value={field.placeholder}
                        onChange={(e) => updateField(index, { placeholder: e.target.value })}
                        placeholder="Texto de ajuda no campo"
                      />
                    </label>
                    <label className="platform-operacoes-field-check">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                      />
                      Obrigatório
                    </label>
                  </>
                ) : (
                  <>
                    <label className="platform-operacoes-form-span2">
                      Tipos aceitos <span className="platform-operacoes-optional">opcional</span>
                      <input
                        value={field.accept}
                        onChange={(e) => updateField(index, { accept: e.target.value })}
                        placeholder=".xlsx,.pdf ou image/*"
                      />
                    </label>
                    <label className="platform-operacoes-field-check">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                      />
                      Obrigatório
                    </label>
                    <label className="platform-operacoes-field-check">
                      <input
                        type="checkbox"
                        checked={field.multiple}
                        onChange={(e) => updateField(index, { multiple: e.target.checked })}
                      />
                      Vários arquivos
                    </label>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
