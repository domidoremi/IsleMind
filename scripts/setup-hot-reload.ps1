# IsleMind 热更新连接脚本 (PowerShell)
# 用途: 一键配置 Metro bundler 连接和热更新

$ErrorActionPreference = "Continue"

# 配置
$DEVICE = "10.0.0.172:38669"
$COMPUTER_IP = "10.0.0.133"
$METRO_PORT = 8081
$APP_PACKAGE = "com.islemind.app"
$APP_ACTIVITY = ".MainActivity"

Write-Host "`n════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  IsleMind 热更新连接配置" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# 步骤 1: 检查设备连接
Write-Host "📱 步骤 1: 检查设备连接" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────"
$devices = adb devices -l
if ($devices -match $DEVICE) {
    Write-Host "✅ 设备已连接: $DEVICE" -ForegroundColor Green
} else {
    Write-Host "❌ 设备未连接！" -ForegroundColor Red
    Write-Host "`n尝试重新连接..."
    adb connect $DEVICE
    Start-Sleep -Seconds 2
    $devices = adb devices -l
    if ($devices -match $DEVICE) {
        Write-Host "✅ 设备连接成功！" -ForegroundColor Green
    } else {
        Write-Host "❌ 无法连接设备，请检查:" -ForegroundColor Red
        Write-Host "  • 设备上的无线调试是否启用"
        Write-Host "  • 设备和电脑是否在同一网络"
        Write-Host "  • IP 地址是否正确"
        pause
        exit 1
    }
}
Write-Host ""

# 步骤 2: 设置端口转发
Write-Host "🔧 步骤 2: 设置 ADB 端口转发" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────"
$result = adb -s $DEVICE reverse tcp:$METRO_PORT tcp:$METRO_PORT
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 端口转发已设置: tcp:$METRO_PORT" -ForegroundColor Green
} else {
    Write-Host "⚠️  端口转发警告（可能已存在）" -ForegroundColor Yellow
}
Write-Host ""

# 步骤 3: 检查 Metro Bundler
Write-Host "🚀 步骤 3: 检查 Metro Bundler" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────"
$metroRunning = netstat -ano | Select-String ":$METRO_PORT" | Select-String "LISTENING"
if ($metroRunning) {
    Write-Host "✅ Metro Bundler 正在运行 (端口 $METRO_PORT)" -ForegroundColor Green
} else {
    Write-Host "⚠️  Metro Bundler 未运行" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "请在另一个终端运行以下命令之一:" -ForegroundColor Cyan
    Write-Host "  cd G:\Project\IsleMind" -ForegroundColor White
    Write-Host "  npm start" -ForegroundColor White
    Write-Host ""
    Write-Host "或者:" -ForegroundColor Cyan
    Write-Host "  npx expo start" -ForegroundColor White
    Write-Host ""

    # 询问是否打开项目目录
    $open = Read-Host "是否打开项目目录? (Y/N)"
    if ($open -eq "Y" -or $open -eq "y") {
        explorer "G:\Project\IsleMind"
    }

    Write-Host ""
    Write-Host "启动 Metro 后按 Enter 继续..." -ForegroundColor Yellow
    Read-Host
}
Write-Host ""

# 步骤 4: 配置开发服务器地址（备用）
Write-Host "⚙️  步骤 4: 开发服务器配置" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────"
Write-Host "如果应用无法连接，请手动配置:" -ForegroundColor Cyan
Write-Host "  1. 在设备上摇晃手机打开开发者菜单"
Write-Host "  2. 点击 'Settings'"
Write-Host "  3. 点击 'Debug server host & port for device'"
Write-Host "  4. 输入: $COMPUTER_IP`:$METRO_PORT"
Write-Host "  5. 返回菜单，点击 'Reload'"
Write-Host ""

# 步骤 5: 重启应用
Write-Host "🔄 步骤 5: 重启应用" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────"
Write-Host "正在停止应用..."
adb -s $DEVICE shell am force-stop $APP_PACKAGE
Start-Sleep -Milliseconds 500

Write-Host "正在启动应用..."
$startResult = adb -s $DEVICE shell am start -W -n "$APP_PACKAGE/$APP_ACTIVITY"
Write-Host $startResult
Write-Host "✅ 应用已重启" -ForegroundColor Green
Write-Host ""

# 步骤 6: 快速测试
Write-Host "🧪 步骤 6: 连接测试" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────"
Write-Host "检查应用日志中的连接信息..."
Start-Sleep -Seconds 2
$logs = adb -s $DEVICE logcat -d -s ReactNativeJS:* | Select-String -Pattern "Metro|Bundler|Connection" | Select-Object -Last 5
if ($logs) {
    Write-Host $logs
} else {
    Write-Host "（暂无相关日志）"
}
Write-Host ""

# 完成
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ 配置完成！" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "🎉 热更新已启用！" -ForegroundColor Green
Write-Host ""
Write-Host "接下来:" -ForegroundColor Cyan
Write-Host "  • 确认 Metro Bundler 正在运行"
Write-Host "  • 在设备上查看应用是否正常显示"
Write-Host "  • 尝试修改代码，应该会自动刷新"
Write-Host ""
Write-Host "常用命令:" -ForegroundColor Cyan
Write-Host "  查看实时日志:"
Write-Host "    adb -s $DEVICE logcat | Select-String ReactNativeJS"
Write-Host ""
Write-Host "  重启应用:"
Write-Host "    adb -s $DEVICE shell am start -n $APP_PACKAGE/$APP_ACTIVITY"
Write-Host ""
Write-Host "  打开开发者菜单:"
Write-Host "    adb -s $DEVICE shell input keyevent 82"
Write-Host ""

# 询问是否查看日志
$viewLogs = Read-Host "是否查看实时日志? (Y/N)"
if ($viewLogs -eq "Y" -or $viewLogs -eq "y") {
    Write-Host ""
    Write-Host "显示实时日志（按 Ctrl+C 退出）..." -ForegroundColor Yellow
    Write-Host "────────────────────────────────────────────────────────────────"
    adb -s $DEVICE logcat -s ReactNativeJS:* -s IsleMind:*
} else {
    Write-Host ""
    Write-Host "提示: 可以运行此脚本查看实时日志:" -ForegroundColor Cyan
    Write-Host "  adb -s $DEVICE logcat | Select-String ReactNativeJS"
    Write-Host ""
}
