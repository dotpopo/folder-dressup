'use strict';

// 原生 shell 小工具：首次运行用 Add-Type 编译成 exe（约 2s，一次性），
// 之后每次换肤只是一次原生进程调用（约 20ms），远快于 PowerShell 冷启动。
// cmd 无法直接调用 SHChangeNotify，这是等价速度下的正确做法。

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileP = promisify(execFile);

const HELPER_VERSION = 'v1';

const HELPER_SOURCE = `
using System;
using System.IO;
using System.Runtime.InteropServices;

class DirShell
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetFileAttributes(string lpFileName, uint dwFileAttributes);

    const uint READONLY = 1, HIDDEN = 2, SYSTEM = 4, DIRECTORY = 16;

    static int Main(string[] args)
    {
        if (args.Length < 2) { Console.Error.WriteLine("usage: dirshell <folder> [ini] [ico]"); return 2; }
        string folder = args[0];
        bool restore = args[1] == "-";
        try
        {
            if (!restore)
            {
                SetFileAttributes(args[1], SYSTEM | HIDDEN);
                if (args.Length > 2) SetFileAttributes(args[2], HIDDEN);
                SetFileAttributes(folder, SYSTEM | DIRECTORY);
            }
            else
            {
                SetFileAttributes(folder, DIRECTORY);
            }
            IntPtr pf = Marshal.StringToHGlobalUni(folder);
            IntPtr pp = Marshal.StringToHGlobalUni(Path.GetDirectoryName(folder) ?? folder);
            SHChangeNotify(0x00002000, 0x0005, pf, IntPtr.Zero);   // UPDATEITEM folder
            SHChangeNotify(0x00001000, 0x0005, pf, IntPtr.Zero);   // UPDATEDIR folder
            SHChangeNotify(0x00001000, 0x0005, pp, IntPtr.Zero);   // UPDATEDIR parent
            SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero); // ASSOCCHANGED
            Marshal.FreeHGlobal(pf);
            Marshal.FreeHGlobal(pp);
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.Message);
            return 1;
        }
    }
}
`;

let helperPromise = null;
let binRoot = path.join(require('node:os').tmpdir(), 'folder-dressup-bin');

function setBinRoot(dir) {
  if (typeof dir === 'string' && dir && dir !== binRoot) {
    binRoot = dir;
    helperPromise = null;
  }
}

function helperPath() {
  return path.join(binRoot, `dirshell-${HELPER_VERSION}.exe`);
}

async function compileHelper(target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmpSrc = path.join(path.dirname(target), 'dirshell.cs');
  await fsp.writeFile(tmpSrc, HELPER_SOURCE, 'utf8');
  await execFileP(
    'powershell.exe',
    [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Add-Type -Path '${tmpSrc.replace(/'/g, "''")}' -OutputAssembly '${target.replace(/'/g, "''")}' -OutputType ConsoleApplication`,
    ],
    { timeout: 60000, windowsHide: true }
  );
  await fsp.unlink(tmpSrc).catch(() => {});
  const st = await fsp.stat(target);
  if (st.size < 1024) throw new Error('helper 编译产物异常');
}

// 确保 helper 可用（首次编译）；返回 exe 路径
function ensureHelper() {
  if (helperPromise) return helperPromise;
  const target = helperPath();
  helperPromise = (async () => {
    try {
      await fsp.access(target);
      return target;
    } catch {}
    await compileHelper(target);
    return target;
  })().catch((err) => {
    helperPromise = null;
    throw err;
  });
  return helperPromise;
}

async function runHelper(args) {
  const exe = await ensureHelper();
  try {
    await execFileP(exe, args, { timeout: 15000, windowsHide: true });
    return { refreshed: true };
  } catch (err) {
    return { refreshed: false, error: String(err.stderr || err.message || err).trim() };
  }
}

module.exports = { ensureHelper, runHelper, setBinRoot, HELPER_VERSION };
