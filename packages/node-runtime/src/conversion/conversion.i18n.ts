import { defineMessages } from '@easyview/contracts/i18n';

export const tConversion = defineMessages({
  'zh-CN': {
    'sourceNotFound': '未找到源文件：{path}',
    'sourceNotFile': '源路径不是文件：{path}',
    'unsupportedSourceFormat': '不支持的源文件格式，应为 {extensions}。',
    'outputExists': '输出文件已存在：{path}。设置 overwrite=true 可覆盖。',
    'dependencyMissing': '文档转换需要 {command}，但未找到该命令。',
    'commandFailedWithDetail': '{command} 执行失败：{detail}',
    'commandFailed': '{command} 执行失败。',
    'noDocxProduced': 'LibreOffice 未生成 DOCX 文件。',
    'pdfEmpty': '此 PDF 中没有可提取的文本或页面图像。',
    'unsupportedDocument': '仅支持转换 DOC、DOCX 和 PDF 文件。',
    'or': ' 或 ',
    'comment.label': '批注',
    'comment.separator': '：',
  },
  en: {
    'sourceNotFound': 'Source file was not found: {path}',
    'sourceNotFile': 'Source path is not a file: {path}',
    'unsupportedSourceFormat': 'Unsupported source format. Expected {extensions}.',
    'outputExists': 'Output file already exists: {path}. Set overwrite=true to replace it.',
    'dependencyMissing': '{command} is required for document conversion but was not found.',
    'commandFailedWithDetail': '{command} failed: {detail}',
    'commandFailed': '{command} failed.',
    'noDocxProduced': 'LibreOffice did not produce a DOCX file.',
    'pdfEmpty': 'No extractable text or page images were found in this PDF.',
    'unsupportedDocument': 'Only DOC, DOCX, and PDF files can be converted.',
    'or': ' or ',
    'comment.label': 'Comment',
    'comment.separator': ': ',
  },
});
