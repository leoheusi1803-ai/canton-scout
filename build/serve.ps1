# Servidor local estatico (sem Node). Uso: .\build\serve.ps1 [porta]
# -Raiz serve outra pasta: util p/ testar o app em subpasta, como o GitHub Pages faz
param([int]$Porta = 8099, [string]$Raiz = "C:\Users\Leonardo Heusi\canton-scout")
$RAIZ = $Raiz

$MIME = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.csv'  = 'text/csv; charset=utf-8'
}

$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Porta/")
$l.Prefixes.Add("http://127.0.0.1:$Porta/")
try { $l.Start() } catch { Write-Host "ERRO ao abrir a porta $Porta : $($_.Exception.Message)"; exit 1 }
Write-Host "servindo $RAIZ em http://localhost:$Porta/  (Ctrl+C para parar)"

while ($l.IsListening) {
  try {
    $ctx = $l.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $rel = $rel -replace '/', '\'
    $caminho = Join-Path $RAIZ $rel
    # nao deixa escapar da raiz
    $full = [System.IO.Path]::GetFullPath($caminho)
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($RAIZ), 'OrdinalIgnoreCase')) {
      $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue
    }
    # pasta -> index.html, como fazem GitHub Pages / Netlify
    if (Test-Path $full -PathType Container) { $full = Join-Path $full 'index.html' }
    if (Test-Path $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = $MIME[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentType = $ct
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("200 {0,-34} {1,9:N0} B" -f $rel, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('404 ' + $rel)
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "404 $rel"
    }
    $ctx.Response.Close()
  } catch {
    Write-Host "erro: $($_.Exception.Message)"
  }
}
