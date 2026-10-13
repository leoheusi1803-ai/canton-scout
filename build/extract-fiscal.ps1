# Extrai TEC (Anexo I), aliquota aplicada (Anexo II) e TIPI -> data/fiscal.json
$ErrorActionPreference = 'Stop'
$DATA = "C:\Users\Leonardo Heusi\AppData\Local\Temp\claude\C--Users-Leonardo-Heusi\018ddca4-5b32-4fc3-9673-cda32d693c18\scratchpad\data"
$OUT  = "C:\Users\Leonardo Heusi\canton-scout\data"

function JStr([string]$s) {
  if ($null -eq $s) { return '""' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append([char]34)
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($ch -eq [char]34)      { [void]$sb.Append('\"') }
    elseif ($ch -eq [char]92)  { [void]$sb.Append('\\') }
    elseif ($c -eq 10)         { [void]$sb.Append('\n') }
    elseif ($c -eq 13)         { [void]$sb.Append('\r') }
    elseif ($c -eq 9)          { [void]$sb.Append('\t') }
    elseif ($c -lt 32)         { [void]$sb.Append('\u' + $c.ToString('x4')) }
    else                       { [void]$sb.Append($ch) }
  }
  [void]$sb.Append([char]34)
  return $sb.ToString()
}

function Num($raw) {
  if ($null -eq $raw) { return $null }
  if ($raw -is [double]) { return [double]$raw }
  $t = ([string]$raw).Trim()
  if ($t -eq '') { return $null }
  if ($t -match '^[Nn][Tt]$') { return 'NT' }
  $t = $t -replace '%', ''
  $t = $t -replace '\s', ''
  if ($t -match '^-?[\d\.]*,\d+$') { $t = ($t -replace '\.', '') -replace ',', '.' }
  $v = 0.0
  if ([double]::TryParse($t, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$v)) { return $v }
  return $null
}

function Clean($raw) {
  if ($null -eq $raw) { return '' }
  return (([string]$raw) -replace '\s+', ' ').Trim()
}

Write-Host "Abrindo Excel..."
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false

# ---------- 1. Anexo I - TEC : codigo, descricao, hierarquia ----------
Write-Host "Lendo Anexo I - TEC ..."
$wb = $xl.Workbooks.Open((Join-Path $DATA 'tec.xlsx'), $null, $true)
$ws = $wb.Worksheets.Item('Anexo I - TEC')
$n  = $ws.UsedRange.Rows.Count
$vals = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($n, 3)).Value2

$itens = New-Object System.Collections.ArrayList
$stack = New-Object System.Collections.ArrayList
$capitulos = @{}
$capNum = ''
$capDesc = ''
$secDesc = ''
$pendingSec = $false
$pendingCap = $false

for ($r = 1; $r -le $n; $r++) {
  $a = Clean $vals[$r, 1]
  $b = Clean $vals[$r, 2]
  $cTxt = Clean $vals[$r, 3]
  # celulas vem como "12,6BK" / "14BIT" : aliquota + marcador de bem de capital/informatica
  $mark = ''
  if ($cTxt -match '(BIT/BK|BK/BIT|BIT|BK)\s*$') {
    $mark = $Matches[1]
    $cTxt = ($cTxt -replace '(BIT/BK|BK/BIT|BIT|BK)\s*$', '').Trim()
  }
  $c = $cTxt
  if ($a -eq '') { continue }

  # padroes ASCII-only: o arquivo .ps1 pode ser lido como ANSI e acentos no padrao quebram
  if ($pendingSec) { $secDesc = $a; $pendingSec = $false; continue }
  if ($pendingCap) { $capDesc = $a; $pendingCap = $false; continue }
  if ($a -match '^Se..o\s+[IVXL]') { $pendingSec = $true; continue }
  if ($a -match '^Cap.{0,2}tulo\s+(\d+)') {
    $capNum = $Matches[1].PadLeft(2, '0')
    $pendingCap = $true
    $stack.Clear()          # hierarquia nao atravessa capitulo
    continue
  }
  if ($a -match '^(Nota|SUBCAP|Subcap)') { continue }

  $isCode = ($a -match '^\d{2}$') -or ($a -match '^\d{2}\.\d{2}$') -or ($a -match '^\d{4}\.\d{1,2}$') -or ($a -match '^\d{4}\.\d{2}\.\d{2}$')
  if (-not $isCode) { continue }
  $norm = $a -replace '\.', ''
  if ($norm.Length -lt 2 -or $norm.Length -gt 8) { continue }

  # mantem na pilha somente ancestrais reais (prefixos do codigo atual)
  while ($stack.Count -gt 0 -and -not $norm.StartsWith($stack[$stack.Count - 1].code)) { $stack.RemoveAt($stack.Count - 1) }
  while ($stack.Count -gt 0 -and $stack[$stack.Count - 1].code -eq $norm) { $stack.RemoveAt($stack.Count - 1) }
  $descTxt = ($b -replace '^[-\s]+', '').Trim()
  if ($descTxt -eq '') { $descTxt = $b }

  if ($norm.Length -eq 8) {
    if ($capNum -ne '' -and -not $capitulos.ContainsKey($capNum)) { $capitulos[$capNum] = $capDesc }
    $path = New-Object System.Collections.ArrayList
    foreach ($s in $stack) { if ($s.desc -ne '') { [void]$path.Add($s.desc) } }
    [void]$itens.Add([pscustomobject]@{
      ncm  = $norm
      desc = $descTxt
      path = ($path -join ' > ')
      cap  = $capNum
      mark = $mark
      tec  = (Num $c)
    })
  } else {
    [void]$stack.Add(@{ code = $norm; desc = $descTxt })
  }
}
Write-Host ("  itens NCM-8 do Anexo I: " + $itens.Count)
Write-Host ("  capitulos detectados: " + (($itens | Select-Object -ExpandProperty cap -Unique) | Measure-Object).Count)

# ---------- 2. Anexo II - aliquota efetivamente aplicada pelo Brasil ----------
Write-Host "Lendo Anexo II - Diferentes da TEC ..."
$ws2 = $wb.Worksheets.Item('Anexo II - Diferentes da TEC')
$n2  = $ws2.UsedRange.Rows.Count
$v2  = $ws2.Range($ws2.Cells.Item(1, 1), $ws2.Cells.Item($n2, 8)).Value2
$aplic = @{}
for ($r = 4; $r -le $n2; $r++) {
  $cod = Clean $v2[$r, 1]
  if ($cod -notmatch '^\d{4}\.\d{2}\.\d{2}$') { continue }
  $norm = $cod -replace '\.', ''
  $ap = Num $v2[$r, 6]
  if ($null -eq $ap) { continue }
  $aplic[$norm] = @{ ii = $ap; fund = (Clean $v2[$r, 7]); bitbk = (Clean $v2[$r, 4]) }
}
Write-Host ("  NCM com aliquota aplicada no Anexo II: " + $aplic.Count)
$wb.Close($false)

# ---------- 3. TIPI - IPI ----------
Write-Host "Lendo TIPI ..."
$wb3 = $xl.Workbooks.Open((Join-Path $DATA 'tipi.xlsx'), $null, $true)
$ws3 = $wb3.Worksheets.Item('Tabela Completa')
$n3  = $ws3.UsedRange.Rows.Count
$v3  = $ws3.Range($ws3.Cells.Item(1, 1), $ws3.Cells.Item($n3, 4)).Value2
$ipi = @{}
for ($r = 1; $r -le $n3; $r++) {
  $cod = Clean $v3[$r, 1]
  if ($cod -notmatch '^\d{4}\.\d{2}\.\d{2}$') { continue }
  $ex = Clean $v3[$r, 2]
  if ($ex -ne '') { continue }
  $norm = $cod -replace '\.', ''
  if (-not $ipi.ContainsKey($norm)) { $ipi[$norm] = (Num $v3[$r, 4]) }
}
Write-Host ("  NCM com IPI: " + $ipi.Count)
$wb3.Close($false)
$xl.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null

# ---------- 4. JSON compacto ----------
Write-Host "Gerando fiscal.json ..."
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"meta":{"gerado":"' + (Get-Date -Format 'yyyy-MM-dd') + '",')
[void]$sb.Append('"tec_ato":"Res. Gecex 272/2021, atualizada ate Res. Gecex 926, de 24/06/2026",')
[void]$sb.Append('"tipi_ato":"Decreto 11.158/2022, atualizado ate ADE RFB 1, de 30/01/2026"},')
[void]$sb.Append('"capitulos":{')
$fc = $true
foreach ($k in ($capitulos.Keys | Sort-Object)) {
  if (-not $fc) { [void]$sb.Append(',') }
  $fc = $false
  [void]$sb.Append((JStr $k) + ':' + (JStr $capitulos[$k]))
}
[void]$sb.Append('},')
[void]$sb.Append('"cols":["ncm","desc","path","cap","ii","iiFonte","ipi","mark"],')
[void]$sb.Append('"itens":[')
$first = $true
$cOverride = 0
$semII = 0
foreach ($it in $itens) {
  $ii = $it.tec
  $fonte = 'TEC'
  if ($aplic.ContainsKey($it.ncm)) {
    $a = $aplic[$it.ncm]
    if ($null -ne $a.ii) {
      if (($null -eq $ii) -or ($ii -is [string]) -or ([math]::Abs([double]$a.ii - [double]$ii) -gt 0.0001)) { $cOverride++ }
      $ii = $a.ii
      if ($a.fund -ne '') { $fonte = 'Anexo II: ' + $a.fund } else { $fonte = 'Anexo II' }
    }
  }
  if ($null -eq $ii) { $semII++; if ($semII -le 12) { Write-Host ("    SEM II: " + $it.ncm + "  " + $it.desc) } }
  $ipiV = $null
  if ($ipi.ContainsKey($it.ncm)) { $ipiV = $ipi[$it.ncm] }

  if ($null -eq $ii) { $iiJ = 'null' } elseif ($ii -is [string]) { $iiJ = (JStr $ii) } else { $iiJ = ([double]$ii).ToString($inv) }
  if ($null -eq $ipiV) { $ipiJ = 'null' } elseif ($ipiV -is [string]) { $ipiJ = (JStr $ipiV) } else { $ipiJ = ([double]$ipiV).ToString($inv) }

  if (-not $first) { [void]$sb.Append(',') }
  $first = $false
  [void]$sb.Append('[' + (JStr $it.ncm) + ',' + (JStr $it.desc) + ',' + (JStr $it.path) + ',' + (JStr $it.cap) + ',' + $iiJ + ',' + (JStr $fonte) + ',' + $ipiJ + ',' + (JStr $it.mark) + ']')
}
[void]$sb.Append(']}')

if (-not (Test-Path $OUT)) { New-Item -ItemType Directory $OUT | Out-Null }
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $OUT 'fiscal.json'), $sb.ToString(), $enc)
$fi = Get-Item (Join-Path $OUT 'fiscal.json')
Write-Host ("OK -> fiscal.json  " + [math]::Round($fi.Length / 1KB, 1) + " KB | itens=" + $itens.Count + " | override Anexo II=" + $cOverride + " | sem II=" + $semII)
