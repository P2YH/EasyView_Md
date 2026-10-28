# 格式能力与样本边界

状态只对应已运行样本；扩展名存在于原映射不等于验收通过。

| 格式 | 原查看/编辑界面 | checkpoint / 恢复 | 原件保存 | AI / 限制 |
| --- | --- | --- | --- | --- |
| Markdown | 原 editor-core 富文本/源码模式 | 真实 DSH 通过 | 真实 DSH 读回通过 | 原局部改写/高亮/批次撤销受控响应通过；当前桌面 GPT 真实 Host 协议局部修改、只读、续写、空文档起草和独占新建通过；更多真实 UI/并发待补 |
| TXT | 原文本编辑模式 | 真实 DSH 通过 | 真实 DSH 读回通过 | Chat 可读取，Agent 写入拒绝；仅 UTF-8 已验证，大文本/其它编码待测 |
| DOCX | 原 DocxEditor | 表格/段落编辑、重载通过 | 独立 OOXML 读回通过 | AI 编辑未接；复杂布局、图片、批注/修订保真样本不足，不代表 Word 全兼容 |
| XLSX | 原 spreadsheet Viewer | 活动 cell、全部修改 sheet、重载通过 | 双 sheet/未修改公式独立 XML 读回通过 | 原 AI 提案卡片拒绝/应用/撤销/刷新恢复受控 UI 通过；当前桌面 GPT 真实 Host 提案拒绝/应用/公式保留/精确文件撤销通过；dirty/版本冲突/Host 重启过期及 prepared 前后取消有回归；setCell 值/公式首版；真实 UI、图表/复杂格式/宏未全面验证 |
| PDF/PPTX/PNG | 实际安装包在真实 DSH 中打开原预览器；禁止公网请求时渲染通过 | 未作编辑承诺 | 首版不提供编辑保存，原件 hash 不变 | 简单上游样本；其它图片编码、复杂 PDF/PPTX 与更多懒加载路径待验收；办公平台原 PPT/PDF 专家保留 |
| 其它上游格式 | 预览器与资源随原工作台构建 | 未作编辑承诺 | 首版不提供编辑保存 | 实际文件、资源与保真范围待验收 |
| DOTX/XLSM | 编辑 admission 关闭 | 未验证 | 禁止当作 DOCX/XLSX 保存 | 不以同类引擎能加载推断保存安全 |

上游输入为固定仓库 tests/fixtures/preview/sample.docx、sample.xlsx（沿用上游 MIT，见根 LICENSE.txt）；脚本生成无敏感内容的 MD/TXT 与双 sheet XLSX。输入/输出、来源、hash、预期修改见 evidence/source-manifest.json。全部写入临时目录，未使用用户文档。

文件树 Markdown 新建已接通且拒绝覆盖；移动/重命名/删除、另存、终端、Git、文档转换、Timeline 等未适配能力明确拒绝，不转发裸 fs。办公平台已有 PPT、PDF、架构评审代码未被替换。

四种编辑格式均已在真实 DSH 中通过“保存记录 → 撤销 → 精确恢复备份字节 → 重开编辑器”。文件级撤销与 MD 活编辑器的批次撤销分别保留。撤销受 dirty、磁盘基线和其它挂载入口保护。
