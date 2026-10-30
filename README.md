# 文件夹换装 · Windows 版

![文件夹换装](film/out/share/film-v5.gif)

<sub>发布片由 <a href="https://github.com/alchaincyf/huashu-motion">huashu-motion</a> 全代码生成</sub>

给 Windows 文件夹换上喜欢的颜色与造型 —— moonvy [「文件夹换装」](https://moonvy.com/apps/dir-hz/) 的 Windows 原生实现。

![预览](docs/app-shot.png)

## 功能

- **生成器**：彩虹色相滑杆 + 文字压印（支持 Emoji、中文、英文、数字），实时预览
- **预设图库**：9 个分类 · 49 张预设（经典/物品/游戏/美食/海洋/宇宙/节日/表情），全部本机绘制，无网络依赖
- **皮肤包**：放入 `%APPDATA%\文件夹换装\packs\<包名>\` 的图片文件夹会自动成为一个分类；「批量添加…」可把任意图片文件夹注册为新分类
- **导入图片**：把任意图片作为文件夹封面
- **应用到文件夹**：一键写入，资源管理器立即可见；支持**撤销**与**恢复默认**
- **拖拽**：拖入文件夹直接选中，拖入图片直接当封面

> 皮肤包版权注记：爬取的 NFT 图片（如 OpenSea 合集）版权归各创作者，仅限个人本地使用，请勿随应用再分发。

## 在线预览

**在线预览（官网，含发布片与下载）：<https://folder-dressup.wispbyte.app>**

## 下载

前往 [Releases](https://github.com/dotpopo/folder-dressup/releases/latest) 选择你的平台：

| 平台 | 文件 | 体积 |
|---|---|---|
| Windows | `FolderDressup_*_x64-setup.exe`（NSIS 安装）/ `.msi` / `_portable.exe`（免安装） | 1.2–3.5 MB |
| macOS | `*.dmg`（universal，Apple Silicon + Intel） | 由 CI 构建 |
| Linux | `*.AppImage` / `*.deb` | 由 CI 构建 |

三个平台共用同一套界面与皮肤包，但「换图标」的机制按系统不同：

- **Windows**：写入 `desktop.ini` + 隐藏 `.ico` + 文件属性，`SHChangeNotify` 刷新
- **macOS**：`NSWorkspace.setIcon` 写入文件夹的自定义图标
- **Linux**：文件夹内 `.directory` 指向 PNG（GNOME/KDE/Thunar 均识别）

> 另有 Electron 版作为兼容性兜底（86.6 MB），仅在 Tauri 版无法运行时使用。

## 运行

```bash
npm install                # 若 electron 二进制未就绪：node node_modules/electron/install.js
npm start                  # 开发运行
npm run verify             # 测试套件（33 用例：绘制/ico/ini/真实文件夹幂等）
npm run dist               # 打包 Electron 版
scripts/build-tauri.bat    # 编译 Tauri 轻量版（需 VS Build Tools + Rust）
```

## 实现原理（Windows 集成）

1. Canvas 绘制 1024px 主图，逐级减半导出 16–256 共 7 个尺寸，打包成 `.ico`
2. 图标写入目标文件夹内的隐藏文件 `.diricon.ico`（随文件夹移动而保留）
3. `desktop.ini`（UTF-16LE BOM）写入 `[.ShellClassInfo] IconResource=...`，保留原有内容
4. 文件夹加 System 属性、desktop.ini 加隐藏+系统属性
5. `SHChangeNotify(SHCNE_UPDATEDIR)` 让资源管理器立即刷新
6. 「恢复默认」移除 IconResource、删除图标文件，其余内容原样保留；应用操作幂等

## 目录

```
main.js               Electron 主进程（IPC 边界校验）
preload.js            contextBridge 暴露的最小 API
lib/draw-folder.js    纯 Canvas 绘制（渲染器与打包脚本共用）
lib/ico.js            PNG → ICO 打包
lib/apply.js          desktop.ini / attrib / SHChangeNotify（幂等）
lib/render-icon.js    Node 侧多尺寸渲染
renderer/             UI（生成器 + 图库）
scripts/              verify 测试套件 / e2e 外壳验证 / 打包图标
AGENTS.md             本任务工作流规范（ub-mode + Tw93 20 条规则沉淀）
WORKLOG.md            工作日志
```

## 安装与数据目录（v1.0.1 起）

- 安装路径与数据目录改为 **ASCII**：`%LOCALAPPDATA%\FolderDressup`、`%APPDATA%\FolderDressup\packs`。
  旧版中文目录（`文件夹换装`）会在首次启动时自动迁移。
- **皮肤包已内置**：安装包自带「阿蟹 / 胖企鹅 / Muse」三包共 90 张，首次启动自动释放到数据目录。
  因此安装包从 1.2MB 增至约 12MB；不需要可在 `packs` 目录删除。

## 关于"图标不是立刻变"

写入本身只要 **5–15ms**（`apply` 实测）。但 Windows 资源管理器对**已经换过图标**的文件夹
有顽固的视图缓存，实测六种 `SHChangeNotify` 策略（UPDATEITEM / UPDATEDIR / 属性翻转 /
UPDATEIMAGE / 重建 desktop.ini / ASSOCCHANGED）都无法稳定即时重绘——这是系统行为，
同类商业软件也需要 F5 或重启资源管理器。

因此 v1.0.1 在界面上加了 **「刷新图标」** 按钮：图标没立刻变化时点一下即可。

## 皮肤包（v1.0.2 起单独下载）

安装包回到 **1.2 MB**，皮肤包不再内嵌，改为独立下载：Release 里的 `FolderDressup-packs.zip`（三套共 90 张，已转 WebP，约 1.8 MB）。
解压后点应用内 **「导入皮肤包…」** 选解压出的文件夹即可（会复制到数据目录，删掉原文件夹也不影响）。

## 应用内文件夹浏览（v1.0.3）

右侧切到 **「文件夹」** 标签：

- 列出当前目录下所有子文件夹，**单击**即选中为目标、**双击**进入下一层；
- **←** 返回上级目录；「选择…」换一个根目录；
- 顶部搜索框按名称过滤，底部按 48 个/页分页（上千个目录也不卡）；
- 已换装过的文件夹会带「已换装」标记。

## 图片皮肤的背景可调（v1.0.7）

90 张 NFT 皮肤图已用 **rembg（isnet-general-use 模型）离线抠图**，全部转成带透明通道的 WebP：
主体保留原样，**背景由左侧色相滑杆控制**（和内置预设一致）。素材已处理完随皮肤包发布，
应用端零额外依赖、体积不变。
