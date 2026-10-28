# 开发版兼容报告

本报告覆盖本地已测实现，不是发行兼容承诺。源码状态和样本 hash 见 evidence/source-manifest.json。

| 项目 | 实测结果与边界 |
| --- | --- |
| EasyView | 固定 SHA 2400d66d2f8458822f895240b5389fee5bd8006d；完整原 UI；独立 @easyview/workbench-core 共用原 UI；无 Electron main/preload runtime |
| DSH | 本地源码 764214bacfd552ff0559cdd6f9b53922556484a1；已安装桌面 0.2.1-rc.2.20261026.5 的 desktop profile 已加载独立插件；原办公/架构/PPT/宠物等 bundle 保留 |
| Cordis | 4.0.5；真实 Context 注册/卸载及 scoped tools.restrict、presentAs、guard |
| Node | 24.19.0 与 24.21.0 本地验证；依赖 node:sqlite；声明的 Node22 范围未在此机验收 |
| 浏览器 | Edge 156.0.4314.50；原编辑器、Office Viewer、DSH iframe；其它浏览器待测 |
| filesystem | 真实 DSH LocalFileSystem；workspace registry/Provider contains/canonical identity；撤销工作区授权后拒绝访问 |
| 原件替换 | 仅本机 Windows 同 Host execution world；Koffi 3.1.1 → ReplaceFileW，替换前复核授权/hash；空暂存文件复制 DACL；新建用 MoveFileExW WRITE_THROUGH、无 REPLACE_EXISTING；无删除原件重建回退 |
| 外部并发 | 可检测原件变化拒绝覆盖；普通外部编辑器在最后 hash-check 与 OS replace 之间的竞态不能完全消除；不支持 UNC/hardlink/远程或不具安全替换能力的 Provider |
| 崩溃 | blob write/fsync/rename，SQLite WAL + synchronous FULL，独立单 writer DB；实际进程 kill/reopen；未做物理断电测试 |
| Frame/Factory | easyview.workbench v1；严格 source/origin/channel/workbench/request 身份；Office bytes 不经 postMessage；open/flush/close/suspend/resume/dispose |
| 外部卸载 | 依赖最后已 ACK checkpoint，不依赖全局 canLeave 或异步 unload 写盘；未确认的最后输入不保证恢复 |
| AI Session | 先订阅后 prompt，匹配 requestId/turn；仅 selectSessionModel；校验 systemPrompt.assemble 的模型工具集合，不符拒绝 prompt；preset 通过公开装配 waterfall 过滤模型 schema，monotonic guard 拒绝全部额外工具执行，兼容父子 scope 和桌面团队插件的 Agent 本地工具；中断请求仅从 DSH inspect 日志只读核实 |
| AI 可用性 | 早期隔离 profile 的模型数为 0；2026-10-28 用户授权当前桌面 profile 后，openai / gpt-6-sol（low）7 项真实请求通过，包括 MD 局部/只读/续写/空文档/新建、XLSX 拒绝/应用/精确文件撤销。见 e05-desktop-real-ai.json；这是 Host 协议驱动，原 UI 结果单独记录；完整 AI capability 仍为 false，剩余生命周期门槛未关闭 |
| XLSX 提案 | 原操作引擎通过授权 bytes 规划，不调用上游文件写盘路径；DSH journal 提交；generation/dirty/revision/输入锁保护；pending 重启失效；prepared 只读恢复；模型工具首版 setCell 值/公式 |
| 文件撤销 | 四格式原件精确备份恢复及重挂载通过；关闭的 dirty 恢复草稿也阻止撤销；同文件多个挂载入口保守拒绝撤销/XLSX 提案；新建不可文件撤销 |
| AI 历史 | Host 稳定消息 ID/请求回执/cursor；localStorage 非权威；不重放 prompt 或旧工具轮次；清空保留原 DSH 日志及本地历史归档 |
| 真实 AI 原 UI | e05-desktop-real-ui.json/png：桌面侧栏进入、原模型选择器、Agent 输入框、真实 GPT 工具读取/局部修改、助手结束回复、原 Markdown 编辑器、durable checkpoint、Ctrl+Z 批次撤销均通过；原件不变，无浏览器异常；不代表全部格式 AI 均已接通 |
| 打包 | Host ESM、lazy Client、3444 个资源；外部 koffi/exceljs 需安装；开发 tgz 仓库外安装验证，结果见 development-package-check.json，非离线包。真实 DSH 基本编辑和 PDF/PPTX/PNG 原预览已在浏览器禁止公网请求时通过；7 个特殊字符绘图资源可经受控 query endpoint 读取，但原引擎 URL 适配仍缺 |

## 启动与安装机制

已运行 CLI --help：入口为 `dsh [--profile] <name>`，依赖安装入口为 `dsh plugin --profile <name> <pnpm-args...>`。安装依赖不等于激活 bundle；profile 的 package.json.dsh.profile.bundles 需要裸包名 dsh-plugin-easyview。

隔离自动验收命令和临时目录见 e00-profile-probe.json，脚本为 scripts/probe-dsh.mjs。每次新建临时 DSH_HOME/easyview-test，link 依赖及裸 bundle，127.0.0.1 随机端口，启动 token 交换认证 cookie；日志去除 token。2026-10-28 另按用户明确授权安装到日常 desktop profile，备份后追加独立 bundle；不复制凭据、不更改全局模型或 cordis.patch.yml。实际安装记录见 desktop-install-20261028.json。

安装依赖时原办公插件的 .desktop-bundles 解包缓存被清空，桌面启动校验报 ENOENT；已从同一桌面发行版自带 package 恢复并验证 SHA256SUMS，原 plugin.tgz 哈希一致。安装器需要保留并复核现有 bundle 缓存；不能把 pnpm 退出 0 当成桌面可启动。

Koffi 完整离线依赖/安装脚本策略、磁盘满/共享占用、复杂格式、断公网、HMR/禁用/卸载及升级迁移仍需 E06/E08。
