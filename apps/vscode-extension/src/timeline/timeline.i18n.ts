import { defineMessages } from '@easyview/contracts/i18n';

export const tTimeline = defineMessages({
  'zh-CN': {
    'label.saved': '文件已保存',
    'label.externalChange': '外部文件变化',
    'label.beforeRestoreDisk': '恢复前磁盘内容',
    'label.beforeRestoreUnsaved': '恢复前未保存内容',
    'label.restored': '文件已恢复',
    'error.closed': 'Timeline 已关闭',
    'error.selectWorkspaceFile': '请先选择工作区中的文件',
    'error.notWorkspaceMarkdown': '文件不在工作区或不是 Markdown',
    'error.changedDuringConfirm': '文件在确认期间发生变化，恢复已停止',
    'error.restoreSaveFailed': '恢复保存失败',
    'error.restoredWithoutHistory': '文件已恢复，但无法记录恢复后的历史：{message}',
    'restore.confirm': '将“{name}”恢复到所选版本并保存？当前内容会先保留在本地历史中。',
    'restore.action': '恢复',
  },
  en: {
    'label.saved': 'File saved',
    'label.externalChange': 'External file change',
    'label.beforeRestoreDisk': 'Disk content before restore',
    'label.beforeRestoreUnsaved': 'Unsaved content before restore',
    'label.restored': 'File restored',
    'error.closed': 'Timeline is closed',
    'error.selectWorkspaceFile': 'Select a file in the workspace first',
    'error.notWorkspaceMarkdown': 'The file is not in the workspace or is not Markdown',
    'error.changedDuringConfirm': 'The file changed while waiting for confirmation, so the restore was stopped',
    'error.restoreSaveFailed': 'Failed to save the restored content',
    'error.restoredWithoutHistory': 'The file was restored, but the post-restore history could not be recorded: {message}',
    'restore.confirm': 'Restore “{name}” to the selected version and save? The current content will be kept in local history first.',
    'restore.action': 'Restore',
  },
});
