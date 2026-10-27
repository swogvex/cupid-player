# Measures private working set (what Task Manager shows as "Memory") and CPU
# for cupid-player.exe plus all its child processes (WebView2).
param(
  [int]$Seconds = 60,
  [int]$Interval = 2,
  [string]$Label = "sample"
)

$cores = [Environment]::ProcessorCount
$rows = @()
$end = (Get-Date).AddSeconds($Seconds)
$first = $true

while ((Get-Date) -lt $end) {
  $procs = Get-CimInstance Win32_Process
  $roots = $procs | Where-Object { $_.Name -eq 'cupid-player.exe' }
  if (-not $roots) {
    Write-Host "cupid-player.exe no esta en ejecucion" -ForegroundColor Red
    exit 1
  }

  # Collect the whole process tree under cupid-player.exe
  $ids = [System.Collections.Generic.HashSet[uint32]]::new()
  $queue = [System.Collections.Generic.Queue[uint32]]::new()
  foreach ($r in $roots) {
    [void]$ids.Add([uint32]$r.ProcessId)
    $queue.Enqueue([uint32]$r.ProcessId)
  }
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    foreach ($c in ($procs | Where-Object { $_.ParentProcessId -eq $parent })) {
      if ($ids.Add([uint32]$c.ProcessId)) { $queue.Enqueue([uint32]$c.ProcessId) }
    }
  }

  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
    Where-Object { $ids.Contains([uint32]$_.IDProcess) }
  $mem = ($perf | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB
  $cpu = ($perf | Measure-Object PercentProcessorTime -Sum).Sum / $cores

  # The first CPU reading is always 0: discard it
  if ($first) { $first = $false } else {
    $rows += [pscustomobject]@{
      Label = $Label
      MemMB = [math]::Round($mem, 1)
      CpuPct = [math]::Round($cpu, 1)
      Procs = $perf.Count
    }
  }
  Start-Sleep -Seconds $Interval
}

$summary = [pscustomobject]@{
  Label = $Label
  MemAvgMB = [math]::Round(($rows | Measure-Object MemMB -Average).Average, 1)
  MemMaxMB = ($rows | Measure-Object MemMB -Maximum).Maximum
  CpuAvgPct = [math]::Round(($rows | Measure-Object CpuPct -Average).Average, 2)
  CpuMaxPct = ($rows | Measure-Object CpuPct -Maximum).Maximum
  Procs = ($rows | Measure-Object Procs -Maximum).Maximum
}
$summary | Format-Table -AutoSize
$summary | Export-Csv -Path "$PSScriptRoot\results.csv" -Append -NoTypeInformation