import { defineMessages } from '@easyview/contracts';

export const tTimeline = defineMessages({
  'zh-CN': {
    'authorize.selectMarkdown': '选择工作区中的 Markdown 文件',
    'authorize.outsideWorkspace': '文件不在工作区',
    'restore.sessionNotFound': '文档会话不存在',
    'restore.cancel': '取消',
    'restore.confirm': '恢复',
    'restore.message': '将“{fileName}”恢复到所选版本并保存？',
    'restore.detail': '当前磁盘内容及未保存内容会先保留在本地历史中。',
    'restore.failed': '恢复失败',
  },
  en: {
    'authorize.selectMarkdown': 'Select a Markdown file in the workspace',
    'authorize.outsideWorkspace': 'The file is not in the workspace',
    'restore.sessionNotFound': 'Document session not found',
    'restore.cancel': 'Cancel',
    'restore.confirm': 'Restore',
    'restore.message': 'Restore “{fileName}” to the selected version and save it?',
    'restore.detail': 'The current disk content and any unsaved content will be kept in local history first.',
    'restore.failed': 'Restore failed',
  },
});
