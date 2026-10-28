# 验收结论与交付边界

**独立开发版主要本地编辑链路可复现；完整首版尚未通过验收。**

| 门槛 | 状态 | 证据 / 缺项 |
| --- | --- | --- |
| A01 | 部分通过 | 临时真实 DSH 仅 EasyView，原 UI 与四个编辑格式通过；实际安装包 PDF/PPTX/PNG 原预览与原件 hash 校验通过；复杂样本待补 |
| A02 | 部分通过 | MD/TXT、DOCX 表格、XLSX 双 sheet/公式恢复；图片/复杂格式不足 |
| A03 | 部分通过 | 活动 cell、revision/队列、Office 失败保留 dirty；MD/TXT 共享生命周期、IME 等待、ACK 后 capture、commit lease 回归通过；全设备/输入竞态待补 |
| A04 | 部分通过 | DSH 切插件面板后 iframe 卸载恢复最后 ACK；实际门户、禁用/完整释放待补 |
| A05 | 部分通过 | F01–F04 真 kill；幂等/payload 冲突；F05 损坏候选/F06 外部改写；新建 F02/F03 kill 及同名保护。磁盘/共享占用等缺 |
| A06 | 部分通过 | journal/HTTP/保存记录 UI 已接通；四格式真实 DSH 精确备份恢复、重挂载；丢 ACK/重启幂等、dirty 与多入口拒绝、后续编辑保护/F07 kill。更多平台和占用场景待补 |
| A07 | 部分通过 | 原 MD 局部改写/撤销/Host hydration 受控 UI；已安装桌面当前 GPT 的局部修改、Chat 只读、模式切换、续写、空文档起草和新建真实 Host 请求通过；父子 scope/额外团队工具隔离有回归；更多取消/并发待补 |
| A08 | 部分通过 | 原 XLSX 提案卡片拒绝/应用/撤销和恢复受控 UI 通过；当前 GPT 真实提案拒绝/应用、双表公式保留与精确文件撤销通过 Host 协议驱动；复杂工作簿与原 UI 真实模型全链路待扩充 |
| A09 | 部分通过 | MD checkpoint/operation receipt 同事务及丢 ACK 去重；当前 GPT 真实请求确认 durable receipt；XLSX pending 真 kill 后 expired，接受后 F02/F03 真 kill 只读恢复、取消前后 prepared 顺序有回归。完整真实 Session/断连及更多竞态待补 |
| A10 | 部分通过 | 真实 DSH/实际安装包的四格式基本编辑、PDF/PPTX/PNG 原预览在禁止公网请求时通过；特殊绘图 URL、更多格式、依赖与许可证清单待补；不代表完整离线发行 |
| A11 | 部分通过 | 用户明确要求提前迁移入口后，已接办公平台左栏“我的智能体”下方，通过公开 Factory 承载；DSH 原生入口移除；实际安装资源在隔离真实 DSH 中通过草稿/对话输入保持和缺插件提示。七专家入口保留，业务全量回归待补；E06 仍未完成 |
| A12 | 未开始 | 离线安装、升级、卸载/重装、数据保留待补 |

test:ai 与 pack:offline 缺门槛时非零退出。pack:dev 仅生成待评审开发 tgz，不声称 E06/E08。

最新日志为 evidence/local-checks/results.json。截图只证明 UI；Office 输出经独立 ZIP/XML 读回。e05-controlled-ai.json 为受控响应；e05-desktop-real-ai.json 是 2026-10-28 已安装桌面 openai / gpt-6-sol 的 7 项真实请求，采用 Host 协议 driver；e05-desktop-real-ui.json/png 则从桌面侧栏、原 EasyView 输入框到同一 GPT 模型、原 Markdown 编辑器、durable checkpoint 和批次撤销完整通过。早期 e01-model-environment.json 的空目录仅对应当时隔离 profile。

后续：补齐 E03–E05 剩余样本/生命周期及真实模型原 UI 验收、独立 A01–A10/离线验证 E06、门户 E07 业务回归，再进入发行候选 E08。用户最新指令已将入口确定为门户左栏，不额外添加第八专家卡片；导航集成通过不代表独立和发行门槛完成。
