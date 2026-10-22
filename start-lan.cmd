@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS first: https://nodejs.org/en/download
  echo Then run this file again. No npm install is needed.
  pause
  exit /b 1
)
echo Por2D - two-player LAN server
echo Keep this window open while playing. Press Ctrl+C to stop.
echo This computer: http://127.0.0.1:8000
echo.
echo 请根据连接方式选择发给队友的地址，不要直接选列表第一项：
echo   同一 Wi-Fi / 路由器：选择 WLAN、Wi-Fi 或实际连接的以太网网卡。
echo   同一 Radmin VPN 网络：选择 Radmin VPN 网卡。
echo   VMware / VMnet / VirtualBox / vEthernet 通常是虚拟机网卡，不要发给普通局域网队友。
echo   127.0.0.1 仅供本机访问，0.0.0.0 是监听地址，都不能作为队友连接地址。
echo 地址会随网络变化，以下列表为当前网卡地址：
powershell.exe -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | ForEach-Object { $hint = if ($_.InterfaceAlias -match 'VMware|VMnet|VirtualBox|vEthernet') { '[VM ONLY - not normal LAN]' } elseif ($_.InterfaceAlias -match 'Radmin') { '[Radmin VPN peers only]' } else { '[LAN - check active Wi-Fi/Ethernet]' }; '  {0}  http://{1}:8000  {2}' -f $_.InterfaceAlias,$_.IPAddress,$hint }"
echo.
echo 地址正确仍无法连接时，请检查双方网络是否互通，以及 Windows 防火墙是否允许 Node.js 入站。
echo.
node runtime/server.cjs --host 0.0.0.0 --port 8000
if errorlevel 1 pause
