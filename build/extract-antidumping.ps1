# Converte a tabela de medidas de defesa comercial em vigor -> data/antidumping.json
$ErrorActionPreference = 'Stop'
$SRC = "C:\Users\Leonardo Heusi\AppData\Local\Temp\claude\C--Users-Leonardo-Heusi\018ddca4-5b32-4fc3-9673-cda32d693c18\scratchpad\data\ad_rows.psv"
$OUT = "C:\Users\Leonardo Heusi\canton-scout\data"

function JStr([string]$s) {
  if ($null -eq $s) { return '""' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append([char]34)
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($ch -eq [char]34)     { [void]$sb.Append('\"') }
    elseif ($ch -eq [char]92) { [void]$sb.Append('\\') }
    elseif ($c -lt 32)        { [void]$sb.Append(' ') }
    else                      { [void]$sb.Append($ch) }
  }
  [void]$sb.Append([char]34)
  return $sb.ToString()
}

$linhas = [System.IO.File]::ReadAllLines($SRC, [System.Text.Encoding]::UTF8)
$medidas = New-Object System.Collections.ArrayList
foreach ($l in $linhas) {
  $p = $l.Split('|')
  if ($p.Count -lt 5) { continue }
  $prod = $p[1].Trim()
  $med  = $p[2].Trim()
  $orig = $p[3].Trim()
  $praz = $p[4].Trim()
  if ($prod -eq '' -or $prod -eq 'PRODUTO') { continue }
  $china = ($orig -match 'China')
  [void]$medidas.Add([pscustomobject]@{
    prod   = $prod
    medida = $med
    origem = $orig
    prazo  = $praz
    china  = $china
    # "Cobranca suspensa" = medida existe mas nao esta sendo cobrada
    susp   = ($praz -match 'suspens')
    # "*" = prazo em revisao
    rev    = ($praz -match '\*')
  })
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"meta":{"gerado":"' + (Get-Date -Format 'yyyy-MM-dd') + '",')
[void]$sb.Append('"fonte":"MDIC/SECEX - DECOM: medidas de defesa comercial em vigor",')
[void]$sb.Append('"url":"https://www.gov.br/mdic/pt-br/assuntos/comercio-exterior/defesa-comercial-e-interesse-publico/medidas-em-vigor/medidas-em-vigor",')
[void]$sb.Append('"total":' + $medidas.Count + ',')
[void]$sb.Append('"total_china":' + (($medidas | Where-Object { $_.china }) | Measure-Object).Count + '},')
[void]$sb.Append('"cols":["prod","medida","origem","prazo","china","susp","rev"],"medidas":[')
$f = $true
foreach ($m in $medidas) {
  if (-not $f) { [void]$sb.Append(',') }
  $f = $false
  $cJ = if ($m.china) { 'true' } else { 'false' }
  $sJ = if ($m.susp)  { 'true' } else { 'false' }
  $rJ = if ($m.rev)   { 'true' } else { 'false' }
  [void]$sb.Append('[' + (JStr $m.prod) + ',' + (JStr $m.medida) + ',' + (JStr $m.origem) + ',' + (JStr $m.prazo) + ',' + $cJ + ',' + $sJ + ',' + $rJ + ']')
}
[void]$sb.Append(']}')

$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $OUT 'antidumping.json'), $sb.ToString(), $enc)
$nc = (($medidas | Where-Object { $_.china }) | Measure-Object).Count
Write-Host ("OK -> antidumping.json | total=" + $medidas.Count + " | com China=" + $nc + " | suspensas=" + (($medidas | Where-Object { $_.susp }) | Measure-Object).Count)
