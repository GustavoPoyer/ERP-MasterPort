# ERP-MasterPort

## App Financeiro de Conciliações

Aplicativo web para o time financeiro operar conciliações com arquitetura preparada para:

- múltiplas automações (`BB`, `Itaú/SIGRA`, etc.);
- evolução visual sem mexer no motor das rotinas;
- adição de novas automações por plugin/registry no backend.

## Stack

- Frontend: Next.js + TypeScript
- Backend: FastAPI + SQLAlchemy
- Banco: PostgreSQL
- Fila/cache (futuro): Redis

## Estrutura

- `backend/`: API, persistência e execução das automações
- `frontend/`: interface operacional para o financeiro
- `automations/`: scripts por setor (ex.: `automations/financeiro/`)
- `docker-compose.yml`: sobe app completo local

## Como subir

### Opção rápida (Windows)

No PowerShell, dentro de `financeiro_app`:

```powershell
.\start_app.ps1
```

Para parar:

```powershell
.\stop_app.ps1
```

### Opção Docker

No diretório `financeiro_app`:

```bash
docker compose up --build
```

Serviços:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Docs API: `http://localhost:8000/docs`

## Fluxo atual

1. Seleciona tipo de conciliação (`bb` ou `itau_sigra`)
2. Faz upload dos arquivos da rodada
3. Dispara execução no app
4. Acompanha status e logs na tela

Validações de upload:

- `bb`: exige arquivo de extrato BB + arquivo PGTO/PGTOS
- `itau_sigra`: exige arquivo de extrato Itaú + arquivo PGTO/SIGRA
- não permite execução sem arquivo
- não permite duplicar execução da mesma automação enquanto houver `queued/running`

## Como adicionar uma nova automação

1. Criar novo adapter em `backend/app/automations/` implementando `AutomationAdapter`.
2. Registrar no `backend/app/automations/registry.py`.
3. Atualizar (opcional) label/descrição no frontend.

Sem alterar o core da API.
