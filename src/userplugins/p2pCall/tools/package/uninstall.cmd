@echo off
chcp 65001 >nul
"%~dp0dist\Installer\VencordInstallerCli.exe" --uninstall
echo Vencord удалён из Discord. Перезапусти Discord.
pause
