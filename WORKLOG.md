# WORKLOG — 文件夹换装 Windows 版

> ub-mode「Keep a Log」：记录每个动作与原因。新条目加在顶部。

## 2026-10-30

- **调研**：moonvy dir-hz = 「文件夹换装」，macOS 应用，功能为：色相滑杆 + 文字/Emoji 压印生成文件夹图标、76 张分类预设、导入单张图片、应用到文件夹。已下载官方预览图确认 UI 布局（左生成器 / 右图库）。
- **技能安装**：ub-mode（工程纪律）、impeccable（UI 打磨）已装入 `~/.agents/skills/`。
- **推文沉淀**：Tw93 的 20 条 AI 编码规则已提炼进 `AGENTS.md`。
- **技术选型**：Electron。理由：Node 24 可用、npm 已配 npmmirror 镜像（Electron 二进制下载快）、HTML/CSS 能快速复刻 moonvy 观感、Node 侧可直接写 desktop.ini/ico；Tauri 需要更长的 Rust 编译链路，本机无 .NET SDK。画图标用 Canvas 2D，绘制函数放 `lib/draw-folder.js` 纯模块（渲染器与生成应用图标脚本共用，单一事实来源）。
- **Windows 集成方案**：图标写入目标文件夹内隐藏文件 `.diricon.ico`；`desktop.ini`（UTF-16LE BOM）写 `IconResource`；文件夹加 System 属性、desktop.ini 加隐藏+系统属性；PowerShell 调 `SHChangeNotify(SHCNE_UPDATEDIR)` 让 Explorer 立即刷新；还原时删除图标文件并移除 IconResource 行（保留 desktop.ini 其他内容）。
