@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 台股觀察室：啟動本機盤中報價
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 scripts\live_server.py
) else (
  python scripts\live_server.py
)
echo.
echo 若顯示找不到 Python，請先安裝 Python 3.11 以上版本：https://www.python.org/downloads/
pause
