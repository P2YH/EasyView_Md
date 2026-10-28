# EasyView DSH 实施进度

更新：2026-10-28。上游固定为 `2400d66d2f8458822f895240b5389fee5bd8006d`。
权威规格：`C:/workspace/dsh/dsh-plugin-office-agents/docs/easyview-dsh-plugin-implementation-plan-20261027.md` 及同目录 runtime-contracts。

**当前交付为独立插件开发版，E06 尚未通过，E08 仍为开发包验证。2026-10-28 用户明确要求入口迁至办公平台“我的智能体”下方，并取消 DSH 原生侧栏入口，故提前实施这项 E07 导航集成；不视为 E06/E07 整体通过。** 原七个专家继续保留，不把受控响应测试、单个格式样本或开发包等同于完成验收。

| 任务 | 状态 | 已实现及证据 | 未关闭项 / 下一步 |
| --- | --- | --- | --- |
| E00 | in_progress | 固定完整 checkout；依赖锁文件；独立 Host/lazy Client/Factory；真实临时 DSH profile 认证、注册、清理及模型目录探测；PDF/PPTX/PNG 简单上游样本已实际打开 | 扩充复杂 DOCX、图片、PPTX/PDF 等样本；完成全部 API/资源兼容证据 |
| E01 本地 Viewer | done | 原 EasyView 欢迎页、树、标签、AI 面板；真实 DOCX/XLSX capture/restore；e01-viewers.json；独立 OOXML 读回 | 不代表所有格式保真或完整 E01 |
| E01 真实模型 | in_progress | 早期隔离 profile 模型数 0；本轮经用户授权，已安装桌面当前 openai / gpt-6-sol（low）的 7 项真实 Host 请求通过，见 e05-desktop-real-ai.json；不复制凭据、不更改全局模型 | 原 UI 真实模型及完整取消/断连/竞态继续按项验收 |
| E02 | in_progress | 原 renderer 显式 mount/ready/suspend/resume/dispose；统一授权 Provider；身份/generation；Factory bridge；@easyview/workbench-core 供 desktop/DSH 共用；原文件树 Markdown 新建 | 完整多入口并发验收待补 |
| E03 Office 生命周期 | in_progress | 实际 DOCX/XLSX 输入、全部修改 sheet、dirty/revision、commit lease、durable checkpoint、恢复/保存 ACK；关闭四选项；后台标签重挂载再保存 | 图片/复杂格式样本、输入竞态及禁用资源释放待补；MD/TXT 已统一公共 DocumentEditorLifecycle；完整输入竞态待补 |
| E03 文本与保存 | in_progress | 原 Markdown/TXT editor-sync；ACK 前落 durable blob/receipt；冲突保留输入；四格式真实 DSH 保存读回、重载恢复；关闭全部/取消/丢弃 | MD/TXT 公共生命周期、composition 等待、durable ACK 后 capture、保存 commit lease 已实现并有回归；更多输入设备/竞态验收待补 |
| E04 | in_progress | 文件共享协调器；候选/备份 → prepared → ReplaceFileW → readback → committed；只读恢复、unknown 隔离；F01–F04/F07 真 kill，F05 候选损坏、F06 外部改写；新建同名保护与 F02/F03 kill；文件撤销 HTTP/保存记录 UI 及四格式精确备份恢复/重挂载 | 磁盘满、共享占用及多入口未完整验收；多个挂载保守拒绝文件撤销；F05 仅覆盖子集 |
| E05 DSH/MD 接线 | in_progress | 专用 presets；真实 DSH 工具 scope；selectSessionModel；request/turn；Host 历史/cursor；原面板 hydration；原编辑器局部应用/高亮/批次撤销；checkpoint 与 operation receipt 同事务；当前桌面 GPT 真实 Host 局部/只读/续写/空文档/新建通过；父子 preset scope、模型装配过滤及额外团队工具执行拒绝回归通过 | 更多原 UI、取消/断连/并发验收待补 |
| E05 XLSX | in_progress | 原 bytes 规划引擎与原提案卡片；持久化 proposal/decision；dirty/版本/输入锁；拒绝、应用、原卡片撤销及刷新 hydration 受控 UI；当前桌面 GPT 真实 Host 提案拒绝/应用、公式保留、精确文件撤销通过；pending/F02/F03 真 kill 与只读恢复；取消以 prepared 为界，不重放旧轮次 | 模型工具首版 setCell 值/公式；应用后重载，进一步修改用新请求；真实 UI、完整断连/竞态与复杂工作簿样本待补 |
| E06 | blocked | 独立临时 profile 仅安装 EasyView；3444 个资源已构建；真实 DSH/实际安装包四格式基本编辑及 PDF/PPTX/PNG 原预览在禁止公网请求时通过；本地验证日志已保存 | E00–E05 未全部关闭；A01–A10、更多格式/资源与完整离线清单未完成 |
| E07 | in_progress | 按用户最新指令新增办公左栏“文档工作台”，位于“我的智能体”下方；通过公开 Factory 嵌入并保留实例，取消 EasyView 的原生 DSH 菜单注册；隔离真实 DSH 验证导航、草稿/输入保留与插件缺失提示 | E06 仍未完成；七专家关键业务完整回归及发行验收待补，不额外添加智能体卡片 |
| E08 | in_progress | 0.1.0-dev.0 开发 tgz 及 SHA256；仓库外临时 npm prefix 安装验证见 development-package-check.json；当前桌面 0.2.1-rc.2.20261026.5 已加载独立插件并完成真实 GPT Host 测试；运行时不需源码目录；pack:offline 明确失败 | 完整离线依赖/许可证、升级迁移、禁用/卸载和 A12 未完成 |

## 本轮验证

- `npm run verify:local --workspace dsh-plugin-easyview`：逐项结果、完整命令、运行目录、退出码和日志在 [local-checks/results.json](evidence/local-checks/results.json)。以最终 status 为准。
- 插件 Host 测试包含真实 DSH filesystem/工具 scope、原件提交/撤销、新建同名保护/kill、AI checkpoint 回执/去重/取消、XLSX 提案及真 kill。受影响 Vitest 加入上游 XLSX 引擎测试；最终数量及通过状态以对应日志为准。
- [e00-profile-probe.json](evidence/e00-profile-probe.json)：临时真实 DSH，四格式编辑/恢复/显式保存及文件撤销精确恢复、关闭取消/丢弃、后台 Office 标签保存、外部卸载恢复和 Factory 控制接口。
- [e01-viewers.json](evidence/e01-viewers.json)：真实 DOCX/XLSX Viewer，活动 cell、双 sheet、公式、表格、保存失败保留 dirty；capture 原件写入次数 0。
- [e05-controlled-ai.json](evidence/e05-controlled-ai.json)：**受控响应，非真实模型验收**；MD 原面板 → 原编辑器 → durable checkpoint/receipt → ACK → 批次撤销 → 重载 hydration；XLSX 原卡片拒绝/应用/撤销与状态恢复，不重新 prompt。
- [e05-desktop-real-ai.json](evidence/e05-desktop-real-ai.json)：已安装桌面当前 GPT 的 7 项真实请求；Host 协议 driver 验证 MD 局部/Chat 只读/模式切换/续写/新建/空文档、XLSX 拒绝/应用/公式保留/精确文件撤销。原 UI 结果单列，不把协议驱动等同 UI 全链路。
- [e05-desktop-real-ui.json](evidence/e05-desktop-real-ui.json) 及同名 PNG：桌面侧栏 → 原 EasyView 模型选择/Agent 输入 → 当前 GPT 读取/局部修改 → 原编辑器/durable checkpoint → Ctrl+Z 批次撤销通过；等待助手实际完成后截屏，原件未写回，browserErrors 为空。
- [desktop-install-20261028.json](evidence/desktop-install-20261028.json)：用户明确授权日常 desktop profile 安装；已备份、追加独立 bundle；原八个 bundle、用户 patch 与全局模型保留。安装器清空原办公解包缓存后已从同发行版恢复并验 SHA256SUMS。
- [development-package-check.json](evidence/development-package-check.json)：实际 tgz hash、仓库外安装位置与真实 DSH 检验。使用本机 npm 缓存，不代表离线发行。
- [e00-package-probe.json](evidence/e00-package-probe.json) 的 previews/resourceNetwork：实际安装包原 PDF/PPTX/PNG Viewer 渲染、原件 hash 不变；浏览器禁止公网 HTTP(S)，基础编辑/预览路径无公网请求。范围不含所有格式或模型网络。
- 安装包检验暴露并修复 Office AI 面板延迟创建时未初始化文档历史路径的问题。回归先等待 XLSX 实际可见，再首次展开 AI 面板，确认已撤销卡片恢复且不重复 prompt；受控证据 xlsx.lazyHistoryAfterPreviewReady。
- 并发运行的上游 appState 40ms 定时器测试曾因文件尚未生成而失败，独立执行通过。未修改无关上游代码，未宣称全套测试通过。
- 先前完整 desktop/preview 测试的 Electron runtime、javac、Windows symlink、POSIX 路径假设问题未修复；本轮影响范围测试和 desktop 构建单独记录。

## 可恢复执行记录

### 2026-10-28 AI 侧栏默认展开

DSH 工作台初始 `aiChatVisible: true`，并通过共享 shell 的 `showAiChatOnWelcome` 选项在欢迎页显示 AI。用户仍可收起；当前工作台内切换文档保留手动选择，重新进入工作台恢复默认展开。原 EasyView 桌面入口不启用该欢迎页选项。

构建和类型检查通过；受控原 UI 回归包含欢迎页、手动开关、MD/XLSX 切换、重载恢复及 AI 编辑/撤销。日常桌面运行中采用两项静态资源增量更新，保留原路由名称以免重启；备份、路径映射及前后散列见 [desktop-ai-sidebar-update.json](evidence/desktop-ai-sidebar-update.json)。之前的完整安装/真实 GPT 证据对应原包，本次增量不宣称重新完成真实模型验收。

```yaml
task: E05
status: in_progress
source: 2400d66d2f8458822f895240b5389fee5bd8006d + evidence/source-manifest.json
dependencies: [E01-real-model, E03, E04]
files: [src/host/ai-adapter.ts, src/host/xlsx-proposals.ts, src/host/file-history.ts, src/ai-preset.ts, src/frame/ai-owner.ts, src/host/draft-store.ts]
acceptance: [A07, A08, A09]
commands_and_evidence:
  - npm run verify:local --workspace dsh-plugin-easyview
  - docs/evidence/e05-controlled-ai.json
blocker: remaining real-model UI, format/lifecycle/offline acceptance is incomplete; current Desktop GPT Host protocol tests passed
next_action: complete original-UI real-model and format/offline/lifecycle gates without starting E07 early
```

继续执行应先检查源状态与日志；不得从子项推断整体完成。导航集成顺序以用户 2026-10-28 最新明确指令为准；继续补齐 E06，不能宣称独立/发行门槛已过。不自动发布、推送或改动无关 profile 配置。本轮安装到日常 desktop profile 由用户明确授权。

### 2026-10-28 办公平台配色

公开 Factory 增加可选 `hostTheme: 'office'`，frame 在加载原 renderer 前设置限定主题；build 将 DSH 专属 `office-theme.css` 附加到原 desktop.css。门户统一蓝白外壳、工具栏和 AI 面板，保留正文强调色及语义状态色。真实隔离 DSH 验证欢迎页/正文、灰/深偏好覆盖、移除选项恢复原样式、正文紫色强调与蓝色 UI 并存，以及原导航/草稿/未发送输入保持。桌面四文件增量由办公平台安装脚本备份和记录；重启客户端生效。本轮无新模型请求，E06/E07/E08 整体门槛不变。

### 2026-10-28 工作区入口修复

真实门户 UI 先复现已打开目录后缺少“切换工作区”按钮；原因是嵌入场景没有原生桌面菜单，文件树未提供替代入口。DSH 专属 frame 顶部新增常驻文字按钮和工作区列表（刷新公开 bootstrap、当前标记、取消/空列表提示），不修改共享上游布局。选择当前工作区不关闭文档，选择其他项复用 flush/requestClose。两个真实临时工作区验证取消、未保存处理取消、保留草稿切换和切回恢复，原件未改。仅 renderer/CSS 更新至日常桌面；本轮不请求模型，完整验收门槛不变。

用户同轮补充“打开文件夹 / 返回欢迎页”：顶部三项操作齐备，欢迎页原打开文件夹也复用新入口。Factory 通过 DSH 目录选择桥接/公开 uiWorkspace.pickDirectory 选取路径、公开 workspaces.create 注册；frame 只接收工作区 ID。共享 shell 公开 showWelcome，保留标签/AI 输入并提供继续工作；先 flush 草稿再展示。UI 对选择结果受控注入，实际注册新目录并执行文件 IO，覆盖取消、目录切换及欢迎页往返；原生 OS 选择窗口实机操作未自动验收。最新增量包含 EasyView client、renderer、原 shell chunk、CSS，保留旧路由名且不更新 Host/办公平台 client。

### 2026-10-28 菜单失效修复与入口收纳

用户要求菜单内提供上述三项操作。真实 UI 先复现点击原菜单按钮后无 role=menu 弹层；原因是 DSH api.window.popupAppMenu 仍继承 probe 的 notifyUnsupported，而原 shell 在初始化时已捕获该函数。DSH frame 在加载原 shell 前安装页面内菜单回调，保留原三横线按钮及 Alt 调用路径，移除临时顶栏文字按钮。三项菜单操作复用原目录选择/未保存处理/欢迎页控制，支持方向键、Esc、外部点击及焦点返回；释放时移除监听及弹层。真实门户 UI 从菜单执行全部三项操作，确认无占位错误提示、目录与草稿流程保持。桌面仅 renderer/CSS 增量，详情见办公平台 docs/evidence/documents-workspace-menu-desktop-install.json；本轮不调用模型，OS 原生选择窗仍用受控选择结果验证。

### 2026-10-28 移除首页无效的新建窗口

DSH adapter 显式声明 `capabilities.newWindow: false`，共享欢迎页据此不渲染“新建窗口”，保留“打开文件夹 / 打开文件”并等宽排列，窄屏仍为单列。未声明该能力的原 EasyView 桌面保持原行为。构建及类型检查通过；桌面增量仅更新 EasyView renderer、共享 shell chunk 和 CSS，原资源路由保留，安装证据见办公平台 `docs/evidence/documents-welcome-actions-desktop-install.json`。本轮无模型请求。
