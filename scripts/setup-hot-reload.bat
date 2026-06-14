@echo off
REM IsleMind 热更新连接脚本
REM 用途: 一键配置 Metro bundler 连接和热更新

echo ════════════════════════════════════════════════════════════════
echo   IsleMind 热更新连接配置
echo ════════════════════════════════════════════════════════════════
echo.

REM 设置变量
set DEVICE_IP=10.0.0.172:38669
set COMPUTER_IP=10.0.0.133
set METRO_PORT=8081

echo 📱 设备信息
echo ────────────────────────────────────────────────────────────────
echo   设备 IP: %DEVICE_IP%
echo   电脑 IP: %COMPUTER_IP%
echo   Metro 端口: %METRO_PORT%
echo.

echo 步骤 1: 检查设备连接
echo ────────────────────────────────────────────────────────────────
adb devices -l | findstr %DEVICE_IP%
if errorlevel 1 (
    echo ❌ 设备未连接！
    echo.
    echo 请先连接设备:
    echo   adb connect %DEVICE_IP%
    echo.
    pause
    exit /b 1
) else (
    echo ✅ 设备已连接
    echo.
)

echo 步骤 2: 设置端口转发
echo ────────────────────────────────────────────────────────────────
adb -s %DEVICE_IP% reverse tcp:%METRO_PORT% tcp:%METRO_PORT%
if errorlevel 1 (
    echo ❌ 端口转发失败！
    pause
    exit /b 1
) else (
    echo ✅ 端口转发已设置 (tcp:%METRO_PORT%)
    echo.
)

echo 步骤 3: 检查 Metro Bundler
echo ────────────────────────────────────────────────────────────────
netstat -ano | findstr ":%METRO_PORT%" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo ⚠️  Metro Bundler 未运行
    echo.
    echo 请在另一个终端运行:
    echo   cd G:\Project\IsleMind
    echo   npm start
    echo.
    echo 或者:
    echo   npx expo start
    echo.
    echo 按任意键打开项目目录...
    pause >nul
    explorer G:\Project\IsleMind
    echo.
    echo 启动 Metro 后，按任意键继续...
    pause >nul
) else (
    echo ✅ Metro Bundler 正在运行
    echo.
)

echo 步骤 4: 重新加载应用
echo ────────────────────────────────────────────────────────────────
echo 正在重启应用...
adb -s %DEVICE_IP% shell am force-stop com.islemind.app
timeout /t 1 /nobreak >nul
adb -s %DEVICE_IP% shell am start -n com.islemind.app/.MainActivity
echo ✅ 应用已重启
echo.

echo 步骤 5: 监控日志（可选）
echo ────────────────────────────────────────────────────────────────
echo.
echo 是否要查看应用日志？(Y/N)
set /p SHOW_LOGS=
if /i "%SHOW_LOGS%"=="Y" (
    echo.
    echo 显示应用日志（按 Ctrl+C 退出）...
    echo ────────────────────────────────────────────────────────────────
    adb -s %DEVICE_IP% logcat -s ReactNativeJS:* -s IsleMind:*
) else (
    echo.
    echo ════════════════════════════════════════════════════════════════
    echo   ✅ 配置完成！
    echo ════════════════════════════════════════════════════════════════
    echo.
    echo 🎉 热更新已启用！
    echo.
    echo 现在你可以:
    echo   • 修改代码，Metro 会自动重新编译
    echo   • 应用会自动刷新（Fast Refresh）
    echo   • 摇晃设备打开开发者菜单
    echo.
    echo 常用命令:
    echo   • 查看日志: adb -s %DEVICE_IP% logcat ^| findstr ReactNativeJS
    echo   • 重启应用: adb -s %DEVICE_IP% shell am start -n com.islemind.app/.MainActivity
    echo   • 打开菜单: adb -s %DEVICE_IP% shell input keyevent 82
    echo.
    pause
)
