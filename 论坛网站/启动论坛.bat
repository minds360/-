@echo off
chcp 65001 >nul
setlocal
title 青柚社区 · 论坛服务

cd /d "%~dp0"

echo.
echo   ============================================
echo     青柚社区 · 动态论坛 启动中
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 未检测到 Node.js
  echo.
  echo   本项目需要 Node.js v22.5 或更高版本（推荐 v22 LTS / v24）。
  echo   请先到 https://nodejs.org 下载安装，然后重新双击本文件。
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo   Node.js 版本：%NODE_VER%
echo.

echo   启动后浏览器会自动打开 http://127.0.0.1:3000
echo   关闭本窗口即停止服务，数据保存在 data\forum.db
echo.
echo   --------------------------------------------

start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:3000"

node src\server.js

echo.
echo   服务已停止。
pause
endlocal
