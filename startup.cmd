@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   正在启动「奕霖古诗词」…
echo.
rem 参数原样转给启动脚本（例如 --no-open 只起服务不开浏览器）
node scripts\app.mjs %*
if errorlevel 1 goto failed
exit /b 0

:failed
rem 注意：失败提示放在标签后面，不写进 if (...) 括号块——
rem 括号块里的中文会被 cmd.exe 按当前代码页拆坏，出现"'xx失败' 不是内部或外部命令"
echo.
echo   启动失败。上面那行就是原因；如果看不懂，把这个窗口截图发我。
pause
exit /b 1
