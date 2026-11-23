<#
  Indiano Trading Bot - registra le attività nell'Utilità di pianificazione di Windows.
  Lancialo TU, da PowerShell, nella cartella del progetto:
      powershell -ExecutionPolicy Bypass -File .\scripts\installa-pianificazione.ps1
  Per rimuovere le attività:
      powershell -ExecutionPolicy Bypass -File .\scripts\installa-pianificazione.ps1 -Rimuovi

  Attività create (per l'utente corrente, solo quando è connesso: nessuna password salvata):
    1. "Indiano Trading - tick": bun run tick ogni 5 minuti, lun-ven 09:00-23:00 (ora del PC),
       riattiva il computer, tempo massimo 20 minuti, una sola istanza alla volta.
    2. "Indiano Trading - scansione": sabato alle 10:00 bun run scan (che poi controlla la review),
       tempo massimo 3 ore.
    3. "Indiano Trading - dashboard": all'accesso, bun run dashboard, con riavvio automatico se si chiude.
#>
param([switch]$Rimuovi)

$ErrorActionPreference = "Stop"
$progetto = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nomi = @("Indiano Trading - tick", "Indiano Trading - scansione", "Indiano Trading - dashboard")

if ($Rimuovi) {
    foreach ($n in $nomi) {
        if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $n -Confirm:$false
            Write-Host "Rimossa: $n"
        }
    }
    return
}

# bun: dal PATH, altrimenti dal percorso standard dell'installer
$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) { $bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe" }
if (-not (Test-Path $bun)) { throw "bun non trovato. Installalo con: powershell -c `"irm bun.sh/install.ps1 | iex`"" }
if (-not (Test-Path (Join-Path $progetto "secrets.ts"))) { Write-Warning "secrets.ts non trovato: le attività partiranno ma il bot si rifiuterà di lavorare finché non lo compili." }

# claude deve essere raggiungibile anche dall'Utilità di pianificazione: aggiungiamo ~/.local/bin al PATH dell'attività
$claudeDir = Join-Path $env:USERPROFILE ".local\bin"
$utente = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $utente -LogonType Interactive -RunLevel Limited

function Avvio([string]$comando) {
    # PowerShell come contenitore: imposta il PATH (bun e claude) e la cartella di lavoro, poi lancia bun
    $cmd = "`$env:PATH = '$claudeDir;' + (Split-Path '$bun') + ';' + `$env:PATH; Set-Location '$progetto'; $comando"
    return New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`"" -WorkingDirectory $progetto
}

# 1. tick ogni 5 minuti, lun-ven 09:00-23:00
$giorni = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
$trigTick = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $giorni -At "09:00"
$rep = (New-ScheduledTaskTrigger -Once -At "09:00" -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 14)).Repetition
$trigTick.Repetition = $rep
$setTick = New-ScheduledTaskSettingsSet -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $nomi[0] -Description "Indiano Trading: sveglie (bun run tick ogni 5 minuti)" -Action (Avvio "& '$bun' run tick") -Trigger $trigTick -Settings $setTick -Principal $principal -Force | Out-Null
Write-Host "Registrata: $($nomi[0])"

# 2. scansione del sabato alle 10:00 (poi controllo della review), tempo massimo 3 ore
$trigScan = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At "10:00"
$setScan = New-ScheduledTaskSettingsSet -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $nomi[1] -Description "Indiano Trading: scansione fondamentale del sabato e review" -Action (Avvio "& '$bun' run scan") -Trigger $trigScan -Settings $setScan -Principal $principal -Force | Out-Null
Write-Host "Registrata: $($nomi[1])"

# 3. dashboard all'accesso, con riavvio automatico se si chiude (ciclo con attesa di 15 secondi)
$trigDash = New-ScheduledTaskTrigger -AtLogOn -User $utente
$setDash = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $nomi[2] -Description "Indiano Trading: dashboard su 127.0.0.1 e lettura dei pulsanti Telegram" -Action (Avvio "while (`$true) { & '$bun' run dashboard; Start-Sleep -Seconds 15 }") -Trigger $trigDash -Settings $setDash -Principal $principal -Force | Out-Null
Write-Host "Registrata: $($nomi[2])"

Write-Host ""
Write-Host "Fatto. Nota: le attività girano solo con l'utente connesso (nessuna password salvata)."
Write-Host "Perché 'riattiva il computer' funzioni, in Opzioni risparmio energia deve essere consentito l'uso dei timer di riattivazione."
Write-Host "Avvia subito la dashboard con: Start-ScheduledTask -TaskName '$($nomi[2])'"
