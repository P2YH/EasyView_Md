import { defineMessages } from '@easyview/contracts/i18n';

export const tExport = defineMessages({
  'zh-CN': {
    'openFile': '打开文件',
    'openInBrowser': '在浏览器中打开',
    'excel.filterName': 'Excel 工作簿',
    'excel.exported': 'Excel 已导出到 {name}',
    'excel.busy': '无法保存 Excel：文件已被其他程序打开。请关闭后重试。',
    'excel.failed': 'Excel 导出失败：{message}',
    'html.exported': '已导出到 {path}',
    'html.exportedWithFailures': '已导出到 {path}（{count} 张图片导出失败）',
    'html.busy': '无法保存 HTML：文件已被其他程序打开。请关闭后重试。',
    'html.failed': 'HTML 导出失败：{message}',
  },
  en: {
    'openFile': 'Open File',
    'openInBrowser': 'Open in Browser',
    'excel.filterName': 'Excel Workbook',
    'excel.exported': 'Excel exported to {name}',
    'excel.busy': 'Cannot save Excel: the file is open in another program. Close it and try again.',
    'excel.failed': 'Excel export failed: {message}',
    'html.exported': 'Exported to {path}',
    'html.exportedWithFailures': 'Exported to {path} ({count} image(s) failed)',
    'html.busy': 'Cannot save HTML: the file is open in another program. Close it and try again.',
    'html.failed': 'HTML export failed: {message}',
  },
});
