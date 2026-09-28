// Preferência do nível de compressão de imagem. Por dispositivo, em localStorage
// (mesmo molde de diagramLayout.ts) — não vai para users.settings.
//
// Só o pipeline de importação lê este valor, no instante de comprimir; por isso
// não há evento nem useSyncExternalStore como em diagramLayout.

export type CompressionLevel = 'strong' | 'medium' | 'light';

export const COMPRESSION_LEVELS: CompressionLevel[] = ['strong', 'medium', 'light'];

export const DEFAULT_COMPRESSION_LEVEL: CompressionLevel = 'strong';

const STORAGE_KEY = 'zettel_image_compression';

export function getSavedCompressionLevel(): CompressionLevel {
  if (typeof localStorage === 'undefined') return DEFAULT_COMPRESSION_LEVEL;
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as CompressionLevel | null;
    return COMPRESSION_LEVELS.includes(saved as CompressionLevel) ? saved! : DEFAULT_COMPRESSION_LEVEL;
  } catch {
    return DEFAULT_COMPRESSION_LEVEL;
  }
}

export function saveCompressionLevel(level: CompressionLevel): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // localStorage indisponível (Safari privado) — a escolha não persiste
  }
}
