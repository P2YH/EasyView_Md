# EasyView 文档工作台 · DSH 独立插件开发版

版本 0.1.0-dev.0，基于 EasyView_Md 固定 SHA 2400d66d2f8458822f895240b5389fee5bd8006d。注册公开 easyview.workbench Factory，办公平台负责菜单入口，保留原界面及 AI 面板，不依赖办公平台、不启动 Electron。

真实临时 DSH 已验证 Markdown/TXT/DOCX/XLSX 编辑、持续恢复草稿、重载、显式保存及文件保存记录撤销。@easyview/workbench-core 供 desktop/DSH 共用；原文件树新建 Markdown、同名保护与文本保存输入锁已接通。MD 原 AI 局部修改/高亮/批次撤销、空文档起草、新建工具、工具反馈和对话恢复有受控测试；XLSX 原提案卡片的拒绝、应用、撤销及刷新恢复也有受控 UI 测试。完整 AI capability 仍 false：真实模型及完整独立验收未完成。

实际安装包的 PDF/PPTX/PNG 原预览已在真实 DSH 中渲染，测试期间禁止公网请求，并核验原件字节保持不变。复杂文件及其它格式仍待验收。

在完整适配仓库根目录执行：

```powershell
$env:DSH_TEST_RUNTIME='C:\workspace\dsh\deepseek-harness'
npm run build --workspace dsh-plugin-easyview
npm run verify:local --workspace dsh-plugin-easyview
npm run pack:dev --workspace dsh-plugin-easyview
npm run test:package --workspace dsh-plugin-easyview
```

scripts/probe-dsh.mjs 新建临时 DSH_HOME/profile，按真实 CLI 机制配置 link 依赖与裸 bundle，不修改生产 profile。开发包需要 koffi@3.1.1、exceljs@4.4.0 和兼容 DSH/Cordis。测试安装入口为 `dsh plugin --profile <测试profile> add <开发tgz绝对路径>`；安装依赖后还需在测试 profile 的 dsh.profile.bundles 选择 dsh-plugin-easyview，或通过插件管理器安装启用。test:package 将实际 tgz 安装到仓库外的临时 npm prefix，再启动真实 DSH 验证；结果以 docs/evidence/development-package-check.json 及 e00-package-probe.json 为准。开发验证依赖本机 npm 缓存和 DSH checkout，不作为离线发行验收。

兼容、格式、验收与进度见 docs/compatibility.md、docs/format-matrix.md、docs/acceptance.md、docs/agent-progress.md。test:ai 与 pack:offline 门槛缺失时明确失败。

恢复草稿不自动覆盖原件；原件保存经 durable journal、Windows 安全替换/hash 读回。不支持安全替换的 Provider、UNC/hardlink 拒绝保存；进程 kill 非物理断电测试。

文件撤销要求当前编辑器无 dirty，并持有匹配版本的输入锁；关闭的未保存恢复草稿也会阻止撤销。首版有多个工作台挂载同一文件时拒绝文件撤销/XLSX 提案，提示先关闭其他入口。XLSX 模型工具首版提供 setCell 值/公式操作；dirty 时要求先保存，应用后经原 Viewer 重载，后续修改使用新请求。pending 提案在 Host 重启后失效；prepared 后只读对账。新建文件 canUndo=false。

2026-10-28 按用户要求将唯一菜单入口迁至办公平台左栏“我的智能体”下方。EasyView 继续独立提供 `easyview.workbench` Factory，取消原生 DSH 侧栏/主面板注册；七个既有专家保留。E06 完整验收仍未通过，导航集成不等于发行就绪。沿用上游 MIT，第三方资源完整许可证清单仍是发行门槛。

办公平台通过可选 Factory 属性 `hostTheme: 'office'` 启用蓝白配色，沿用平台主色 `#246bff` 与面板底色 `#f3f7fc`；工具栏、文件树、标签、欢迎页和 AI 侧栏统一，正文强调色继续由 EasyView 管理。样式只在 DSH frame 的 `data-host-theme="office"` 内生效，未传属性时保留原外观。源码及实际安装文件的 UI 验证见办公平台 `docs/evidence/documents-workbench-ui.json` / `documents-workbench-installed-ui.json`。

工作台左上角“菜单”（三横线，或按 Alt）内提供“打开文件夹 / 切换工作区 / 返回欢迎页”。切换列表显示当前项并在每次打开时刷新；选择当前项不清空标签，切换其他项复用未保存修改处理，支持取消或保留恢复草稿。

菜单中的打开文件夹复用 DSH 桌面目录选择桥接/公开目录服务，并通过公开 workspaces.create 注册工作区；取消不改变当前文档。返回欢迎页保留当前标签与草稿，可点击原欢迎页“继续工作”恢复正文和未发送对话。跨 frame 桥接只返回已注册工作区 ID，不接收 frame 指定的宿主路径。菜单支持方向键、Esc 及点击外部关闭；不再在顶栏重复展示三项文字按钮。

DSH 插件不支持独立新建桌面窗口，因此首页仅显示“打开文件夹 / 打开文件”，不显示“新建窗口”。
