import { defineMessages } from '../i18n/i18n';

export const tTextPatch = defineMessages({
  'zh-CN': {
    anchorNotFound: '补丁锚点未匹配当前内容',
    anchorAmbiguous: '补丁锚点匹配多处，必须缩小 expectedText 的上下文',
    noPatches: '至少需要一个补丁',
    emptyDescription: '补丁说明不能为空',
    emptyExpectedText: 'expectedText 不能为空',
    overlappingRanges: '补丁范围重叠，必须拆分为独立的非重叠修改',
  },
  en: {
    anchorNotFound: 'The patch anchor does not match the current content',
    anchorAmbiguous: 'The patch anchor matches multiple places; narrow the expectedText context',
    noPatches: 'At least one patch is required',
    emptyDescription: 'The patch description must not be empty',
    emptyExpectedText: 'expectedText must not be empty',
    overlappingRanges: 'Patch ranges overlap; split them into independent, non-overlapping edits',
  },
});
