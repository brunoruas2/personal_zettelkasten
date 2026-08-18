export interface ExtractSelectionInput {
  sourceTitle: string;
  sourceTags: string[];
  selectedText: string;
  newTitle: string;
}

export interface ExtractSelectionResult {
  payload: { title: string; body: string; tags: string[] };
}

export function buildExtractedZettel({
  sourceTitle,
  sourceTags,
  selectedText,
  newTitle,
}: ExtractSelectionInput): ExtractSelectionResult {
  return {
    payload: {
      title: newTitle,
      body: `[[^${sourceTitle}]]\n\n${selectedText.trim()}`,
      tags: sourceTags,
    },
  };
}

export function defaultExtractTitle(selectedText: string): string {
  return selectedText.trim().split('\n')[0].slice(0, 100);
}
