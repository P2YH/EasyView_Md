import { defineMessages } from '@easyview/contracts/i18n';

export const tTerminal = defineMessages({
  'zh-CN': {
    'iterm.localMacOnly': '插入 iTerm2 需要在本地 macOS 扩展会话中运行。',
    'iterm.noSession': '请先打开一个运行 Claude Code 的 iTerm2 会话。',
    'iterm.sessionDescription': '窗口 {window} · 标签页 {tab} · 窗格 {pane}',
    'iterm.pickTitle': '将大纲路径插入 iTerm2',
    'iterm.pickPlaceholder': '选择 Claude Code 正在等待输入的会话',
    'iterm.insertFailed': '无法插入 iTerm2：{message}',
    'iterm.controlCharacters': '大纲路径包含不支持的控制字符。',
  },
  en: {
    'iterm.localMacOnly': 'iTerm2 insertion requires a local macOS extension session.',
    'iterm.noSession': 'Open an iTerm2 session with Claude Code first.',
    'iterm.sessionDescription': 'Window {window} · Tab {tab} · Pane {pane}',
    'iterm.pickTitle': 'Insert outline path into iTerm2',
    'iterm.pickPlaceholder': 'Select the session with Claude Code waiting for input',
    'iterm.insertFailed': 'Could not insert into iTerm2: {message}',
    'iterm.controlCharacters': 'Outline path contains unsupported control characters.',
  },
});
