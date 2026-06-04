# Estrutura de automações

Este diretório centraliza as automações executadas pelo aplicativo.

## Organização atual

- `financeiro/`: conciliações e rotinas financeiras
  - `conciliar_bb.py`
  - `conciliar_itau_sigra.py`
  - `numerario_itau.py`
- `shared/`: utilitários compartilhados
  - `acessar_drive.py`

## Operações (Comex)

- `operacoes/importacao/`: coloque `run_importacao.py` (sua automação de importação)
- `operacoes/exportacao/`: rotinas de exportação (futuro)
- Adapter registrado no backend: chave `operacoes_importacao`

## Outros setores

- `rh/`: rotinas de pessoal e folha (módulo RH na plataforma)

No backend, os runners já priorizam os scripts em `automations/financeiro/` e mantêm fallback para os caminhos antigos.
Os scripts financeiros buscam arquivos em `financeiro_app/downloads/`.
