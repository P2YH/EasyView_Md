/** Suffixes opened in the Markdown editor. `.mdc` is Cursor's rule format: YAML front matter plus Markdown. */
export const MARKDOWN_FILE_EXTENSIONS = ['.md', '.markdown', '.mdx', '.mdc'] as const;

const MARKDOWN_FILE_SUFFIX = /\.(?:md|markdown|mdx|mdc)$/i;

export const isMarkdownFilePath = (filePath: string): boolean => MARKDOWN_FILE_SUFFIX.test(filePath);

export const stripMarkdownExtension = (fileName: string): string => fileName.replace(MARKDOWN_FILE_SUFFIX, '');
