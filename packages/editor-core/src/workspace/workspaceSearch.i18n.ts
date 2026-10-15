import { defineMessages } from '@easyview/contracts/i18n';

export const tWorkspaceSearch = defineMessages({
  'zh-CN': {
    'placeholder': '搜索文件或文件夹名',
    'close': '关闭搜索 (Esc)',
    'failed': '搜索失败',
    'searching': '搜索中…',
    'noResults': '没有找到匹配的文件或文件夹',
    'truncated': '结果较多，仅显示前 {count} 条',
    'count': '{count} 个结果',
  },
  en: {
    'placeholder': 'Search file or folder names',
    'close': 'Close Search (Esc)',
    'failed': 'Search failed',
    'searching': 'Searching…',
    'noResults': 'No matching files or folders',
    'truncated': 'Too many results; showing the first {count}',
    'count': '{count} results',
  },
});
