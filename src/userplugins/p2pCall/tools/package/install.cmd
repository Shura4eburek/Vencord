@echo off
chcp 65001 >nul
set "D=%~dp0"
set "D=%D:~0,-1%"
set "VENCORD_USER_DATA_DIR=%D%"
set "VENCORD_DEV_INSTALL=1"
echo Установка Vencord с плагином P2PCall из папки:
echo   %D%
echo Папку после установки НЕ перемещать и НЕ удалять — Discord грузит Vencord отсюда.
echo.
"%D%\dist\Installer\VencordInstallerCli.exe" --install
echo.
echo Готово. Полностью перезапусти Discord (трей - Выйти), затем Настройки - Vencord - Плагины - включи P2PCall.
pause
