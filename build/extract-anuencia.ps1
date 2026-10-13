# Extrai tratamento administrativo / orgaos anuentes -> data/anuencia.json
# Fontes: ta-imp-anuenteweb.xlsx (aba 01b = regime de licenciamento por NCM)
#         ta_lpco_att_imp.xlsx  (aba 03 = camada LPCO/DUIMP do Portal Unico)
$ErrorActionPreference = 'Stop'
$DATA = "C:\Users\Leonardo Heusi\AppData\Local\Temp\claude\C--Users-Leonardo-Heusi\018ddca4-5b32-4fc3-9673-cda32d693c18\scratchpad\data"
$OUT  = "C:\Users\Leonardo Heusi\canton-scout\data"

function JStr([string]$s) {
  if ($null -eq $s) { return '""' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append([char]34)
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($ch -eq [char]34)     { [void]$sb.Append('\"') }
    elseif ($ch -eq [char]92) { [void]$sb.Append('\\') }
    elseif ($c -eq 10)        { [void]$sb.Append('\n') }
    elseif ($c -eq 13)        { [void]$sb.Append('\r') }
    elseif ($c -eq 9)         { [void]$sb.Append('\t') }
    elseif ($c -lt 32)        { [void]$sb.Append('\u' + $c.ToString('x4')) }
    else                      { [void]$sb.Append($ch) }
  }
  [void]$sb.Append([char]34)
  return $sb.ToString()
}
function Clean($raw) {
  if ($null -eq $raw) { return '' }
  return (([string]$raw) -replace '\s+', ' ').Trim()
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false

# ---------- 1. Dicionario de orgaos ----------
Write-Host "Lendo dicionario de orgaos..."
$orgaos = @{}
$wbA = $xl.Workbooks.Open((Join-Path $DATA 'ta-imp-anuenteweb.xlsx'), $null, $true)
$wsO = $wbA.Worksheets.Item('03')
$nO = $wsO.UsedRange.Rows.Count
$vO = $wsO.Range($wsO.Cells.Item(1,1), $wsO.Cells.Item($nO,2)).Value2
for ($r = 2; $r -le $nO; $r++) {
  $sig = (Clean $vO[$r,1])
  $nom = (Clean $vO[$r,2])
  if ($sig -eq '' -or $nom -eq '') { continue }
  $sig = ($sig -replace '[^A-Za-z0-9/\.\-]', '')   # tira marca de nota de rodape (ANM^1 -> ANM)
  # linhas de rodape trazem o texto inteiro na coluna A: aceita so sigla curta
  if ($sig -notmatch '^[A-Za-z][A-Za-z0-9/\.\-]{1,11}$') { continue }
  if (-not $orgaos.ContainsKey($sig)) { $orgaos[$sig] = $nom }
}
Write-Host ("  orgaos: " + $orgaos.Count)

# ---------- 2. Aba 01b : regime de licenciamento por NCM ----------
Write-Host "Lendo aba 01b (tratamento administrativo por NCM)..."
$ws = $wbA.Worksheets.Item('01b')
$n = $ws.UsedRange.Rows.Count
$v = $ws.Range($ws.Cells.Item(1,1), $ws.Cells.Item($n,12)).Value2
$regras = New-Object System.Collections.ArrayList
for ($r = 2; $r -le $n; $r++) {
  $cod = (Clean $v[$r,1])
  if ($cod -eq '') { continue }
  $cod = $cod -replace '[^\d]', ''
  if ($cod.Length -lt 2 -or $cod.Length -gt 8) { continue }
  $anu = (Clean $v[$r,10])
  $reg = (Clean $v[$r,11])
  if ($anu -eq '' -and $reg -eq '') { continue }
  [void]$regras.Add([pscustomobject]@{
    p    = $cod                 # prefixo NCM
    desc = (Clean $v[$r,2])
    trat = (Clean $v[$r,8])       # tratamento administrativo (Mercadoria/Material usado/...)
    exc  = (Clean $v[$r,9])       # excecoes
    anu  = $anu
    reg  = $reg                 # regime: automatico / nao-automatico / impedida
    ex   = (Clean $v[$r,6])       # destaque / EX
  })
}
Write-Host ("  regras de TA: " + $regras.Count)
$wbA.Close($false)

# ---------- 3. Camada LPCO / DUIMP (Portal Unico) ----------
Write-Host "Lendo camada LPCO/DUIMP..."
$wbB = $xl.Workbooks.Open((Join-Path $DATA 'ta_lpco_att_imp.xlsx'), $null, $true)
$wsL = $wbB.Worksheets.Item('03')
$nL = $wsL.UsedRange.Rows.Count
Write-Host ("  linhas na aba 03: " + $nL)
$lpco = New-Object System.Collections.ArrayList
$step = 8000
for ($base = 2; $base -le $nL; $base += $step) {
  $top = [math]::Min($base + $step - 1, $nL)
  $vL = $wsL.Range($wsL.Cells.Item($base,1), $wsL.Cells.Item($top,10)).Value2
  for ($r = $base; $r -le $top; $r++) {
    $i = $r - $base + 1          # Value2 do bloco volta com indice 1
    if ((Clean $vL[$i,8]) -ne 'NCM') { continue }
    $cod = (Clean $vL[$i,9]) -replace '[^\d]', ''
    if ($cod.Length -lt 2 -or $cod.Length -gt 8) { continue }
    [void]$lpco.Add([pscustomobject]@{
      p      = $cod
      org    = (Clean $vL[$i,1])
      ta     = (Clean $vL[$i,2])
      modelo = (Clean $vL[$i,4])
      tipo   = (Clean $vL[$i,5])    # Alerta / Bloqueio / ...
      imped  = (Clean $vL[$i,6])
      campo  = (Clean $vL[$i,7])
    })
  }
  Write-Host ("    ...$top / $nL  (acumulado: " + $lpco.Count + ")")
}
Write-Host ("  regras LPCO por NCM: " + $lpco.Count)
$wbB.Close($false)
$xl.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null

# ---------- 4. JSON ----------
Write-Host "Gerando anuencia.json ..."
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"meta":{"gerado":"' + (Get-Date -Format 'yyyy-MM-dd') + '",')
[void]$sb.Append('"fonte":"Siscomex - Tratamento Administrativo na Importacao (Anuente Web + Portal Unico LPCO)"},')

[void]$sb.Append('"orgaos":{')
$f = $true
foreach ($k in ($orgaos.Keys | Sort-Object)) {
  if (-not $f) { [void]$sb.Append(',') }
  $f = $false
  [void]$sb.Append((JStr $k) + ':' + (JStr $orgaos[$k]))
}
[void]$sb.Append('},')

[void]$sb.Append('"colsTa":["p","anu","reg","trat","exc","ex","desc"],"ta":[')
$f = $true
foreach ($x in $regras) {
  if (-not $f) { [void]$sb.Append(',') }
  $f = $false
  [void]$sb.Append('[' + (JStr $x.p) + ',' + (JStr $x.anu) + ',' + (JStr $x.reg) + ',' + (JStr $x.trat) + ',' + (JStr $x.exc) + ',' + (JStr $x.ex) + ',' + (JStr $x.desc) + ']')
}
[void]$sb.Append('],')

[void]$sb.Append('"colsLpco":["p","org","ta","modelo","tipo","imped"],"lpco":[')
$f = $true
foreach ($x in $lpco) {
  if (-not $f) { [void]$sb.Append(',') }
  $f = $false
  [void]$sb.Append('[' + (JStr $x.p) + ',' + (JStr $x.org) + ',' + (JStr $x.ta) + ',' + (JStr $x.modelo) + ',' + (JStr $x.tipo) + ',' + (JStr $x.imped) + ']')
}
[void]$sb.Append(']}')

if (-not (Test-Path $OUT)) { New-Item -ItemType Directory $OUT | Out-Null }
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $OUT 'anuencia.json'), $sb.ToString(), $enc)
$fi = Get-Item (Join-Path $OUT 'anuencia.json')
Write-Host ("OK -> anuencia.json  " + [math]::Round($fi.Length/1KB,1) + " KB | ta=" + $regras.Count + " | lpco=" + $lpco.Count + " | orgaos=" + $orgaos.Count)
