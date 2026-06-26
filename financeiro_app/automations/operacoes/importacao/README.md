# Importação — automações por cliente

## Estrutura recomendada

```
importacao/
  yaro/           ← cliente Yaro
    run.py
  tahara/         ← cliente Tahara
    planilhatahara.py
  _geral/         ← scripts da equipe (sem cliente)
```

Cadastre o cliente em **Operações → Importação → + Novo cliente** (admin) antes de vincular automações.

## Pelo site (recomendado)

1. Coloque o `.py` na pasta do cliente (ex.: `yaro/run.py`).
2. Em **Operações → Importação**, clique em **+ Nova automação**.
3. Escolha o **cliente**, preencha nome/descrição e rota: `automations/operacoes/importacao/yaro/run.py`.
4. Use o card para anexar arquivos e **Executar**.

Não é necessário editar o backend.

## Passo 1 — Copiar o script (manual)

Copie seu `.py` pronto para esta pasta com o nome:

**`run_importacao.py`**

(O adapter do backend está configurado para esse nome. Se preferir outro nome, altere em `backend/app/automations/operacoes_importacao.py`.)

## Passo 2 — Ajustar o script para rodar pelo KIVO

No final do arquivo, garanta algo assim:

```python
def main():
    from runtime_paths import (
        get_form_value,
        get_slot_files,
        operacoes_app_root,
        resolve_input_folder,
        resolve_output_path,
    )

    app_root = operacoes_app_root()
    pasta_entrada = resolve_input_folder()  # arquivos enviados pela plataforma
    arquivo_saida = resolve_output_path(app_root=app_root, default_name="saida_importacao.xlsx")
    fornecedor = get_form_value("fornecedor", "auto")
    pdfs = get_slot_files("arquivo") or get_slot_files("anexo")

    # TODO: use pasta_entrada, arquivo_saida, fornecedor e pdfs na sua lógica
    # ...

    print(f"Arquivo Excel gerado: {arquivo_saida}")  # o app detecta o caminho de saída


if __name__ == "__main__":
    main()
```

Adicione no topo (se ainda não tiver):

```python
import os, sys
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)
```

## Passo 3 — Testar no terminal (antes da tela)

Na raiz `financeiro_app`:

```powershell
$env:FINANCEIRO_APP_ROOT = (Get-Location).Path
$env:OPERACOES_INPUT_FOLDER = "$env:FINANCEIRO_APP_ROOT\downloads\2026-06-03"  # pasta com seus arquivos
python automations\operacoes\importacao\run_importacao.py
```

Se terminar sem erro, a integração com o backend funcionará.

## Variáveis que o KIVO envia na execução

| Variável | Uso |
|----------|-----|
| `FINANCEIRO_APP_ROOT` | Raiz do app (`financeiro_app/`) |
| `OPERACOES_INPUT_FOLDER` | Pasta com arquivos da rodada |
| `OPERACOES_OUTPUT_PATH` | Caminho sugerido para o resultado |
| `OPERACOES_RUN_ID` | ID da execução (se houver) |
| `SECTOR_AUTOMATION_KEY` | Chave da automação cadastrada |
| `OPERACOES_PARAMETERS_JSON` | Campos de texto do formulário (`{"fornecedor":"auto",...}`) |
| `OPERACOES_FILES_JSON` | Arquivos por slot (`{"arquivo":["/caminho/a.pdf"]}`) |
| `OPERACOES_RUN_MANIFEST` | Caminho do `operacoes_run_manifest.json` na pasta da rodada |
| `OPERACOES_PARAM_<CAMPO>` | Atalho por campo (ex.: `OPERACOES_PARAM_FORNECEDOR`) |

Helpers em `automations/operacoes/runtime_paths.py`: `get_form_value()`, `get_slot_files()`, `get_files_by_slot()`, `load_run_manifest()`.
