@echo off
call "D:\Tools\CODE\VS2022BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d D:\work\me\gym\folder-dressup
npx --yes @tauri-apps/cli@2 build 2>&1
