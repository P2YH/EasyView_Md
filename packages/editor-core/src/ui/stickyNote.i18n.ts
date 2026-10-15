import { defineMessages } from '@easyview/contracts/i18n';

export const tStickyNote = defineMessages({
  'zh-CN': {
    'title': '小签',
    'display.native': '原生',
    'display.render': '渲染',
    'display.toggle': '切换小签显示模式',
    'display.toggleTitle': '左侧为原生 VS Code 编辑器模式，右侧为渲染显示模式',
    'mode.local': '本地文件',
    'mode.localTitle': '读取当前文件内容，关闭后自动保存回当前文件',
    'mode.temp': '临时文件',
    'mode.tempTitle': '独立临时内容，仅保存在本地存储',
    'close': '关闭小签',
    'font.decrease': '缩小字号',
    'font.increase': '放大字号',
  },
  en: {
    'title': 'Sticky Note',
    'display.native': 'Native',
    'display.render': 'Rendered',
    'display.toggle': 'Toggle sticky note display mode',
    'display.toggleTitle': 'Left: native VS Code editor mode; right: rendered display mode',
    'mode.local': 'Local File',
    'mode.localTitle': 'Reads the current file and saves back to it automatically when closed',
    'mode.temp': 'Temporary',
    'mode.tempTitle': 'Separate temporary content, stored only in local storage',
    'close': 'Close sticky note',
    'font.decrease': 'Decrease font size',
    'font.increase': 'Increase font size',
  },
});
