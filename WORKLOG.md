# WORKLOG — 文件夹换装 Windows 版

> ub-mode「Keep a Log」：记录每个动作与原因。新条目加在顶部。

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
