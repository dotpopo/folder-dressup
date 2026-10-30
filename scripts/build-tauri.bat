@echo off
call "D:\Tools\CODE\VS2022BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d D:\work\me\gym\folder-dressup\src-tauri
cargo build --release 2>&1
