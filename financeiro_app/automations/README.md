# Estrutura de automações

Este diretório centraliza as automações executadas pelo aplicativo.

## Organização atual

- `financeiro/`: conciliações e rotinas financeiras
  - `conciliar_bb.py`
  - `conciliar_itau_sigra.py`
  - `numerario_itau.py`
- `shared/`: utilitários compartilhados
  - `acessar_drive.py`

## Próximos setores

- `comex/`: importação e exportação (comércio exterior)
- `rh/`: rotinas de pessoal e folha

No backend, os runners já priorizam os scripts em `automations/financeiro/` e mantêm fallback para os caminhos antigos.
Os scripts financeiros buscam arquivos em `financeiro_app/downloads/`.
