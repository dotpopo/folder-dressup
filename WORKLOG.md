# WORKLOG — 文件夹换装 Windows 版

> ub-mode「Keep a Log」：记录每个动作与原因。新条目加在顶部。

## 2026-10-30（换肤性能攻坚 + v1.0.1）

- **实测六种 SHChangeNotify 策略**（item / itemdir / toggle / full / image / recreate）：
  数据层写入 5–15ms 且始终正确，但 Explorer 对"已有自定义图标"的文件夹存在顽固视图缓存，
  只有 ASSOCCHANGED 会全局失效（代价是整张缓存重建）。结论：这是系统行为，
  同类商业软件也需要 F5/重启资源管理器。收敛为 UPDATEITEM + 父目录 UPDATEDIR + ASSOCCHANGED（均不阻塞）。
- **界面新增「刷新图标」按钮**，图标未即时变化时一键再通知。
- **安装路径 ASCII 化**：%APPDATA%FolderDressup，旧中文目录自动迁移。
- **皮肤包内置**：安装包带 12MB 三套包，首次启动释放（临时 APPDATA 模拟全新安装验证通过）。
- **产物名去版本号** + 官网用 releases/latest/download 永久直链。
## 2026-10-30（品牌图标 + 三平台发布）

- **品牌图标**：圆角底板 + 白色文件夹 + 全光谱彩虹条 + 星芒；输出 1024 PNG / 7 尺寸 ICO / 16px 预览图，exe 内嵌图标已提取验证。
- **跨平台后端**：拆为 platform/{windows,macos,linux}.rs。Windows 走 desktop.ini + SHChangeNotify；macOS 走 NSWorkspace.setIcon（objc2）；Linux 写文件夹内 .directory 指向 PNG。
- **CI 踩坑**（三平台 GitHub Actions）：
  1. macOS：objc2 需 `ClassType` 才能 `NSImage::alloc()`；选项要 `NSWorkspaceIconCreationOptions::empty()`。
  2. Linux 打包要求 ASCII productName（deb/AppImage 命名规则）→ CI 构建前改写配置。
  3. tauri-action 报 "No artifacts were found" 但产物其实已生成 → 改用 softprops/action-gh-release + 统一 ASCII 命名。
  4. AppImage 的 linuxdeploy panic："couldn't find a square icon" → bundle.icon 必须包含方形 PNG（此前只列了 .ico）。
- **产物**：Windows setup 1.27MB / MSI 1.79MB；macOS dmg 3.48MB；Linux deb 1.55MB / AppImage 80MB（AppImage 打包了 WebKit 依赖，属该格式常态）。
- **Release**：https://github.com/dotpopo/folder-dressup/releases/tag/v1.0.0

## 2026-10-30（换肤提速 + Tauri 迁移）

- **延迟根因**：① apply 先删旧图标再写新图标，Explorer 读到悬空 IconResource → 回退默认图标；② 通知走 PowerShell 冷启动 + Add-Type 编译，每次 1.2–2.5s。
- **修法**：顺序改为 写新→改 ini→通知→删旧；通知改为**首次编译一个 C# 小工具**（lib/shell-helper.js，一次性约 0.8s），之后每次是原生进程调用。实测 apply 2400ms → 119ms，已打开窗口 400ms 内变色。
- **Tauri 迁移**：Rust 后端（src-tauri/src/main.rs，约 700 行）复刻全部能力：ICO 构建（PNG 条目 + DIB）、desktop.ini UTF-16LE、SetFileAttributesW、SHChangeNotify、皮肤包扫描。前端零改动复用（新增 renderer/tauri-shim.js 把 window.api 映射到 invoke）。
- **体积**：Electron 94MB → 裁剪语言包后 86.6MB；Tauri **3.7MB**（单文件 exe，无需安装）。
- **验证**：Rust 6/6 测试（含真实文件夹应用/还原）；CDP 驱动真实点击 E2E：皮肤包 3 个、应用写入 ico+ini、SHGetFileInfo 提取到自定义图标。

## 2026-10-30（用户实测三连修 + 皮肤包中文名）

- **二次换肤不生效**：图标恒为 .diricon.ico，Explorer 同路径缓存不重载 → 改按内容哈希命名 .diricon-<hash>.ico（同内容幂等，旧文件自动清理）。e2e-reskin 外壳级验证：A→B→C 三次换肤外壳提取图标均变化，NFT 封面上得去。
- **NFT 皮肤换不上**：同根因；另发现 draw-folder 图片模式在 Node 侧用裸 Image 崩溃 → 双环境解码（浏览器 Image / Node @napi-rs/canvas loadImage）。
- **小窗口按钮遮挡**：左面板子项可被压缩导致 340px 画布溢出压字 → 子项 flex-shrink:0 + 画布随宽缩放，面板滚动。
- **皮肤包改名**：阿蟹 / 胖企鹅 / Muse（目录即包名）。
- **教训**：loadPackCats 的空 catch 把 fsp 未定义吞成"没有皮肤包"（上一轮），空 catch 必须至少留日志。

## 2026-10-30（发布物料与部署）

- **皮肤包数据**：ego-browser 在 OpenSea 虚拟化网格上失败（minimized 页面不挂载）；改用用户提供的 Scrapling 技能（隐身浏览器 + page_action 滚动）成功爬取 axie-ronin / musegod-muses / lilpudgys 各 30 张；seadn CDN 恒回 AVIF，pillow-avif 本地转 PNG。
- **皮肤包功能**：packs 目录自动发现 + 批量添加文件夹 + 懒加载；userData 统一修复 dev/打包不一致。
- **发布片**：huashu-motion 五幕连续变形，116 BPM drop；QA 迭代三轮（开场静默→重构时间轴→slam 开场）。
- **官网**：website/ 静态单页（发布片 + 功能 + 下载），版权与来源声明齐全。
- **部署**：wispbyte Node 服务器 folder-dressup-site（#566a0140）创建成功，site.zip 上传并解压（zip 上传走 Browse Files + waitForFileChooser；自定义 radio/按钮需完整指针事件序列）。启动与公网地址验证因浏览器被用户接管而暂停。
- **GitHub**：dotpopo/folder-dressup 已推送；homepage 待部署地址确认后设置。

## 2026-10-30（审查与加固）

- **Review 轮**（Tw93 规则 14/15）：独立子代理审查全部源码，还做了行为实验（验证隐藏文件覆写必 EPERM、attrib 对斜杠容忍度等）。结论 P0=0，P1=2，P2=6；安全/CSP/IPC 校验/事件绑定均"未发现问题"。
- **P1 修复**：① 导入图片后撤销数据超 localStorage 配额 → `saveUndo` 降级只存色相+文字，不再"应用成功却报错"；② 还原不回退文件夹 S 属性 → restore 现在做 `attrib -s`（best-effort，失败进 warnings）。
- **P2 修复**：写入改"同目录临时文件 + rename"（崩溃不再可能销毁旧 desktop.ini）；attrib 失败不再中断且 SHChangeNotify 必达，失败转 warnings 由 UI 展示；ANSI/GBK 旧编码 desktop.ini 检测 U+FFFD 拒绝合并（保护用户原有内容）；restore 的 unlink 带退避重试；拖入图片先 stat 尺寸再读；fitFont 下限 80→44（12 个汉字不再溢出）。
- **审查修复引入的 bug 又被自家用例抓出**：`unlinkWithRetry` 吞 ENOENT 导致"再次还原 changed=false"失败——改为返回 'deleted' | 'missing'。规则 19 再次应验。
- **测试**：verify 37/37；e2e-shell 应用变化 ✓ / 还原复原 ✓。重新打包 portable exe。


## 2026-10-30（构建日）

- **交付**：Electron 应用，`npm start` 开发运行；`npm run dist` 打包 portable exe。
- **单元1（lib）**：`draw-folder.js`（纯绘制，双环境 CJS/浏览器）、`ico.js`（PNG→ICO，校验实际尺寸）、`apply.js`（desktop.ini UTF-16LE 合并、attrib、SHChangeNotify、重试）。verify 33 用例全绿。
- **单元2（UI）**：左生成器（预览/路径/色相条/文字）右图库（9 分类 49 预设，全部现场绘制，无版权资源）。PrintWindow 截图验收通过（不抢用户前台焦点）。
- **单元3（E2E）**：`e2e-shell.mjs` 用 SHGetFileInfo 提取 Explorer 实际显示的图标：应用后变化 ✓、还原后复原 ✓。
- **Bug1（回归用例覆盖）**：覆盖隐藏文件 EPERM——Windows 拒绝对 H 属性文件 CREATE_ALWAYS 写入。修法：重试前先 unlink。由「应用两次幂等」用例抓出。
- **Bug2（渲染器全挂）**：draw-folder.js 纯 CJS，浏览器无 `module` → ReferenceError → 整页初始化中断。修法：UMD 双环境。由新增 vm 回归用例覆盖。定位手段：`--enable-logging` 抓渲染器控制台。
- **Bug3（隐蔽）**：PowerShell 注入用 JSON.stringify 产生字面 `\\`，PS 不处理反斜杠转义 → SHGetFileInfo/SHChangeNotify 拿到双分隔符路径静默失败。修法：`psQuote`（单引号字面量）。教训：本环境 shell 会折叠命令文本里的 `\\`，导致手工复现全部失真——最后靠"node 直接写盘的脚本"与"手工 heredoc"的差异对比 + DEBUG 输出锁定。回归用例：psQuote 经 powershell 往返。
- **消重**：三处"1024 主图逐级减半导出多尺寸"合并为 `lib/render-icon.js`（dryer 纪律）。
- **调研**：moonvy dir-hz = 「文件夹换装」，macOS 应用：色相滑杆 + 文字/Emoji 压印 + 76 张分类预设 + 导入图片 + 应用到文件夹。预览图已核对，UI 布局按其左生成器/右图库结构复刻（图标全部本机绘制，未复制其美术资源）。
- **技能安装**：ub-mode、impeccable 装入 `~/.agents/skills/`；Tw93 的 20 条 AI 编码规则（2026-10-29 推文）提炼进 `AGENTS.md`；pstack 模型规则写入 `~/.cursor/rules/pstack-models.mdc`（budget large）。
- **技术选型**：Electron（Node 24 + npmmirror 镜像快、HTML/CSS 快速复刻观感、Node 侧直接写 desktop.ini）。备选 Tauri/Rust 因编译链路长被排除。注意：新版 npm 默认拦截 install-scripts，electron 二进制需手动 `node node_modules/electron/install.js`。

## 遗留决策

- 还原时**不回退**文件夹的 System 属性（对称回退可能破坏用户其他设置；图标删除后无可见影响）。
- 图标写入目标文件夹内（`.diricon.ico` 隐藏）而非集中缓存：随文件夹移动而保留，符合「换装属于文件夹」的直觉。
- 预设 49 张全部现场绘制（emoji + 色相），不复制 moonvy 的 76 张 AI 生成图，无版权风险。
