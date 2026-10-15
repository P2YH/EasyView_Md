import { defineMessages } from '@easyview/contracts';

export const tFeedback = defineMessages({
  'zh-CN': {
    'mail.subject': 'EasyView 反馈 (v{version})',
    'mail.describe': '请描述问题或建议：',
    'mail.steps': '复现步骤：',
    'mail.environment': '环境信息：',
  },
  en: {
    'mail.subject': 'EasyView Feedback (v{version})',
    'mail.describe': 'Please describe the issue or suggestion:',
    'mail.steps': 'Steps to reproduce:',
    'mail.environment': 'Environment:',
  },
});
