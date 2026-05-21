$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$stopScript = Join-Path $root "stop_app.ps1"
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$venvPip = Join-Path $root ".venv\Scripts\pip.exe"

Write-Host "Iniciando Financeiro App..." -ForegroundColor Cyan

if (Test-Path $stopScript) {
  Write-Host "Limpando instâncias antigas nas portas 8000/3000..." -ForegroundColor Yellow
  & $stopScript
}

function Test-PortInUse {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$connections
}

if (-not (Test-Path $venvPython)) {
  Write-Host "Criando ambiente virtual..." -ForegroundColor Yellow
  python -m venv (Join-Path $root ".venv")
}

Write-Host "Instalando dependências backend..." -ForegroundColor Yellow
& $venvPip install -r (Join-Path $backend "requirements.txt") | Out-Null

Write-Host "Instalando dependências frontend..." -ForegroundColor Yellow
Push-Location $frontend
npm install | Out-Null
Pop-Location

if (Test-PortInUse -Port 8000) {
  Write-Host "Backend já está em execução na porta 8000. Pulando nova inicialização." -ForegroundColor DarkYellow
} else {
  Write-Host "Subindo backend em http://localhost:8000" -ForegroundColor Green
  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
  "Set-Location '$backend'; `$env:AUTOMATION_WORKSPACE='$root'; & '$venvPython' -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
  )
}

if (Test-PortInUse -Port 3000) {
  Write-Host "Frontend já está em execução na porta 3000. Pulando nova inicialização." -ForegroundColor DarkYellow
} else {
  Write-Host "Subindo frontend em http://localhost:3000" -ForegroundColor Green
  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$frontend'; npm run dev"
  )
}

Write-Host "Pronto. Abra http://localhost:3000" -ForegroundColor Cyan
