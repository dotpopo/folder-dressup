'use strict';

// 外壳验证：用 SHGetFileInfo 提取某文件夹当前显示的图标并存成 PNG。
// 用法：node scripts/check-shell-icon.mjs <文件夹路径> <输出.png>

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { psQuote } = require('../lib/apply.js');

const folder = process.argv[2];
const outPng = process.argv[3];
if (!folder || !outPng) {
  console.error('用法：node scripts/check-shell-icon.mjs <文件夹路径> <输出.png>');
  process.exit(1);
}

const cs = `
using System;
using System.Runtime.InteropServices;
namespace W {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEINFO {
    public IntPtr hIcon; public int iIcon; public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
  }
  public static class Native {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SHGetFileInfo(string pszPath, uint attr, ref SHFILEINFO psi, uint cb, uint flags);
  }
}
`.trim();

const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
${cs}
'@
$info = New-Object W.SHFILEINFO
$ptr = [W.Native]::SHGetFileInfo(${psQuote(folder)}, 0, [ref]$info, [System.Runtime.InteropServices.Marshal]::SizeOf([type][W.SHFILEINFO]), 0x100)
if ($ptr -eq [IntPtr]::Zero) { Write-Output 'EMPTY'; exit 1 }
$icon = [System.Drawing.Icon]::FromHandle($info.hIcon)
$bmp = $icon.ToBitmap()
$bmp.Save(${psQuote(path.resolve(outPng))}, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output ('OK ' + $bmp.Width + 'x' + $bmp.Height)
`.trim();

const tmpPs = path.join(os.tmpdir(), 'check-shell-icon.ps1');
// UTF-8 BOM：Windows PowerShell 5.1 无 BOM 会按 ANSI 读取，中文路径乱码
fs.writeFileSync(tmpPs, '\ufeff' + ps, 'utf8');
const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpPs], { encoding: 'utf8' }).trim();
console.log(out, '→', outPng);
process.exit(out.includes('OK') ? 0 : 1);
