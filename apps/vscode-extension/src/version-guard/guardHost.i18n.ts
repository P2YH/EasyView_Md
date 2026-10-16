import { defineMessages } from '@easyview/contracts/i18n';
export const tGuardHost = defineMessages({
  'zh-CN': { discard: '丢弃更改', confirm: '丢弃这些文件的未暂存更改和未保存编辑？', inconsistent: '同一文件有不同的未保存版本，请先处理。', changed: '确认期间文件又被编辑，请重新检查。', save: '文件保存失败。', trust: '请先信任此工作区，再使用 Version Guard。' },
  en: { discard: 'Discard Changes', confirm: 'Discard unstaged changes and unsaved edits in these files?', inconsistent: 'This file has different unsaved versions. Resolve them first.', changed: 'Files were edited during confirmation. Review and try again.', save: 'Could not save the file.', trust: 'Trust this workspace before using Version Guard.' },
});
