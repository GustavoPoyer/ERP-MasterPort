$ErrorActionPreference = "SilentlyContinue"

Write-Host "Parando serviços do Financeiro App..." -ForegroundColor Yellow

function Stop-PortProcesses {
  param(
    [int]$Port,
    [string]$Name
  )

  $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  if (-not $pids) {
    Write-Host "$Name não estava em execução na porta $Port." -ForegroundColor DarkYellow
    return
  }

  foreach ($processId in $pids) {
    try {
      $existingProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if (-not $existingProcess) {
        Write-Host "$Name na porta $Port estava com PID residual ($processId). Nada para encerrar." -ForegroundColor DarkYellow
        continue
      }

      Stop-Process -Id $processId -Force -ErrorAction Stop
      Start-Sleep -Milliseconds 200

      if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
        Write-Host "Não foi possível parar $Name (PID $processId)." -ForegroundColor Red
      } else {
        Write-Host "$Name parado (PID $processId)." -ForegroundColor Green
      }
    } catch {
      Write-Host "Falha ao parar $Name (PID $processId): $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}

Stop-PortProcesses -Port 8000 -Name "Backend"
Stop-PortProcesses -Port 3000 -Name "Frontend"

Write-Host "Concluído." -ForegroundColor Cyan
