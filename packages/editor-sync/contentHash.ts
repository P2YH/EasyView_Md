/** Streaming FNV-1a over UTF-16 code units, identical across hosts. */
export function createContentHasher(): { update(text: string): void; digest(): string } {
  let hash = 0xcbf29ce484222325n;
  return {
    update(text) {
      for (let index = 0; index < text.length; index++) {
        hash ^= BigInt(text.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
      }
    },
    digest: () => hash.toString(16).padStart(16, '0'),
  };
}

/** A deterministic, platform-independent hash for canonical text. */
export function hashContent(content: string): string {
  const hash = createContentHasher();
  hash.update(content);
  return hash.digest();
}
export const hashCanonicalContent = hashContent;
