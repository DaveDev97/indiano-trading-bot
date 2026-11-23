<#
  Indiano Trading Bot - avvio su Windows.
    .\start.ps1                 aiuto e controlli
    .\start.ps1 installa        registra motore, scansione e dashboard nell'Utilità di pianificazione
    .\start.ps1 motore          motore in primo piano (un tick ogni 30 s), senza pianificazione
    .\start.ps1 dashboard       webapp su http://127.0.0.1:8787
    .\start.ps1 <comando> ...   tick, once, scan, review, status, probe, test (le opzioni passano a bun, es. --fake)
  Da cmd.exe o con doppio clic: start.cmd <comando>
#>
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) { $bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe" }
if (-not (Test-Path $bun)) {
    Write-Host "Manca bun. Installalo con:  powershell -c `"irm bun.sh/install.ps1 | iex`"   (poi riapri il terminale)" -ForegroundColor Red
    exit 1
}
$env:PATH = (Join-Path $env:USERPROFILE ".local\bin") + ";" + (Split-Path $bun) + ";" + $env:PATH

$cmd = if ($args.Count -gt 0) { [string]$args[0] } else { "aiuto" }
# sempre una lista: con un solo argomento PowerShell darebbe una stringa, e @resto la spezzerebbe in caratteri
$resto = @($args | Select-Object -Skip 1)

if (-not (Test-Path "secrets.ts") -and $cmd -notin @("aiuto", "help", "test") -and -not ($resto -contains "--fake")) {
    Copy-Item "secrets.example.ts" "secrets.ts"
    Write-Host "Ho creato secrets.ts dal modello: compilalo (chiavi Alpaca PAPER, Telegram, Finnhub, password della dashboard) e rilancia." -ForegroundColor Yellow
    Write-Host "Per provare senza chiavi aggiungi --fake (broker, dati e cervello finti)."
    exit 1
}

switch ($cmd) {
    { $_ -in @("aiuto", "help") } {
        Write-Host "Indiano Trading Bot - bun $(& $bun --version)"
        $c = Get-Command claude -ErrorAction SilentlyContinue
        if ($c) { Write-Host "claude: $(& $c.Source --version)" } else { Write-Host "claude: NON trovato (serve al cervello: irm https://claude.ai/install.ps1 | iex)" }
        Write-Host ("secrets.ts: " + $(if (Test-Path "secrets.ts") { "presente" } else { "assente (verrà creato dal modello al primo comando)" }))
        Write-Host "Comandi: installa, disinstalla, motore, dashboard, tick, once, scan, review, status, probe, test, build"
        exit 0
    }
    "installa" { & powershell -ExecutionPolicy Bypass -File ".\scripts\installa-pianificazione.ps1"; exit $LASTEXITCODE }
    "disinstalla" { & powershell -ExecutionPolicy Bypass -File ".\scripts\installa-pianificazione.ps1" -Rimuovi; exit $LASTEXITCODE }
    "motore" { & $bun run schedule @resto; exit $LASTEXITCODE }
    "test" { & $bun test @resto; exit $LASTEXITCODE }
    { $_ -in @("dashboard", "tick", "once", "scan", "review", "status", "probe", "schedule", "build") } { & $bun run $cmd @resto; exit $LASTEXITCODE }
    default { Write-Host "Comando sconosciuto: $cmd (.\start.ps1 aiuto)" -ForegroundColor Red; exit 1 }
}
