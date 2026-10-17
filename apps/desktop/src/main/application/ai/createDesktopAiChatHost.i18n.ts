import { defineMessages } from '@easyview/contracts';

export const tAiHost = defineMessages({
  'zh-CN': {
    'imageBudget': '每次最多添加 4 张图片，总大小不能超过 8 MiB。',
    'secret.apiKeyUnsupported': '当前系统不支持安全存储 API Key',
    'secret.webSearchApiKeyUnsupported': '当前系统不支持安全存储 Web Search API Key',
    'dialog.images': '图片',
  },
  en: {
    'imageBudget': 'Attach at most 4 images with a combined size of 8 MiB.',
    'secret.apiKeyUnsupported': 'Secure storage for the API key is not supported on this system',
    'secret.webSearchApiKeyUnsupported': 'Secure storage for the Web Search API key is not supported on this system',
    'dialog.images': 'Images',
  },
});
