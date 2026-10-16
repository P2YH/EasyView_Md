import { defineMessages } from '@easyview/contracts/i18n';
export const tGuardHost = defineMessages({
  'zh-CN': { discard: '丢弃更改', cancel: '取消', confirm: '丢弃以下文件的未暂存更改和未保存编辑？', changed: '确认期间编辑内容已改变，请重新检查。', inconsistent: '该文件在多个窗口中有不同的未保存内容，请先处理。' },
  en: { discard: 'Discard Changes', cancel: 'Cancel', confirm: 'Discard unstaged changes and unsaved edits in these files?', changed: 'Edits changed during confirmation. Review and try again.', inconsistent: 'This file has different unsaved edits in multiple windows. Resolve them first.' },
});
