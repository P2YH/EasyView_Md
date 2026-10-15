import { defineMessages } from '@easyview/contracts/i18n';

export const tAiChanges = defineMessages({
  'zh-CN': {
    'toast.label': '变更导航',
    'toast.previous': '上一处变更',
    'toast.next': '下一处变更',
    'toast.closeLabel': '关闭变更导航',
    'toast.close': '关闭',
    'toast.loadingGit': '正在加载 Git 变更…',
    'toast.gitFailed': 'Git 读取失败',
    'toast.gitPosition': 'Git 变更 {current} / {total}',
    'toast.externalPosition': '外部变更 {current} / {total}',
  },
  en: {
    'toast.label': 'Change navigator',
    'toast.previous': 'Previous change',
    'toast.next': 'Next change',
    'toast.closeLabel': 'Close change navigator',
    'toast.close': 'Close',
    'toast.loadingGit': 'Loading Git changes…',
    'toast.gitFailed': 'Git read failed',
    'toast.gitPosition': 'Git change {current} of {total}',
    'toast.externalPosition': 'External change {current} of {total}',
  },
});
