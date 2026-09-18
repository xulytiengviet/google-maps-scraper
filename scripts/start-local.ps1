param(
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Chọn thư mục lưu dữ liệu POI (CSV, JSON, GeoJSON)"
$dialog.ShowNewFolderButton = $true

if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Đã hủy."
    exit 0
}

$saveDir = $dialog.SelectedPath
$repoRoot = Split-Path -Parent $PSScriptRoot
$imageName = "longngo/google-maps-poi-local:latest"
$containerName = "longngo-google-maps-poi"

Write-Host ""
Write-Host "Thu muc luu: $saveDir"
Write-Host "Kiem tra Docker Desktop..."

try {
    docker info | Out-Null
} catch {
    [System.Windows.Forms.MessageBox]::Show(
        "Cần cài và mở Docker Desktop trước khi chạy Local Mode.",
        "Google Maps POI Local",
        "OK",
        "Warning"
    ) | Out-Null
    exit 1
}

Push-Location $repoRoot
try {
    Write-Host "Dang build ung dung local..."
    docker build -t $imageName . | Out-Host

    docker rm -f $containerName 2>$null | Out-Null

    Write-Host "Dang khoi dong tren http://127.0.0.1:$Port ..."
    docker run -d --name $containerName -e DISABLE_TELEMETRY=1 -p "127.0.0.1:${Port}:8080" -v "${saveDir}:/data" $imageName -data-folder /data -addr :8080 | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    if (-not $ready) {
        throw "Ứng dụng chưa khởi động thành công. Chạy: docker logs $containerName"
    }

    Write-Host "San sang."
    Write-Host "CSV / JSON / GeoJSON se luu vao: $saveDir"
    Start-Process "http://127.0.0.1:$Port/"
} finally {
    Pop-Location
}
