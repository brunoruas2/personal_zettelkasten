// Registro único do highlight.js (core + linguagens selecionadas), usado pela
// leitura (`MarkdownRenderer`) e pelo editor (`lib/editorDecorations.ts`), para
// os dois pintarem o código igual. Adicionar linguagem: importar, registrar e,
// se preciso, criar o alias.
import hljs from 'highlight.js/lib/core';
import langJavascript from 'highlight.js/lib/languages/javascript';
import langTypescript from 'highlight.js/lib/languages/typescript';
import langPython from 'highlight.js/lib/languages/python';
import langGo from 'highlight.js/lib/languages/go';
import langBash from 'highlight.js/lib/languages/bash';
import langSql from 'highlight.js/lib/languages/sql';
import langJson from 'highlight.js/lib/languages/json';
import langYaml from 'highlight.js/lib/languages/yaml';
import langXml from 'highlight.js/lib/languages/xml';
import langCss from 'highlight.js/lib/languages/css';
import langRust from 'highlight.js/lib/languages/rust';
import langJava from 'highlight.js/lib/languages/java';
import langCpp from 'highlight.js/lib/languages/cpp';
import langC from 'highlight.js/lib/languages/c';
import langCsharp from 'highlight.js/lib/languages/csharp';
import langLua from 'highlight.js/lib/languages/lua';

hljs.registerLanguage('javascript', langJavascript);
hljs.registerLanguage('typescript', langTypescript);
hljs.registerLanguage('python', langPython);
hljs.registerLanguage('go', langGo);
hljs.registerLanguage('bash', langBash);
hljs.registerLanguage('sql', langSql);
hljs.registerLanguage('json', langJson);
hljs.registerLanguage('yaml', langYaml);
hljs.registerLanguage('xml', langXml);
hljs.registerLanguage('css', langCss);
hljs.registerLanguage('rust', langRust);
hljs.registerLanguage('java', langJava);
hljs.registerLanguage('cpp', langCpp);
hljs.registerLanguage('c', langC);
hljs.registerLanguage('csharp', langCsharp);
hljs.registerLanguage('lua', langLua);

export const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  html: 'xml',
  htm: 'xml',
  cs: 'csharp',
};

/** Nome registrado da linguagem, ou null se o highlight.js não a conhece. */
export function resolveLanguage(lang: string | null | undefined): string | null {
  const raw = (lang ?? '').trim().toLowerCase();
  if (!raw) return null;
  const resolved = LANG_ALIASES[raw] ?? raw;
  return hljs.getLanguage(resolved) ? resolved : null;
}

/** HTML com `<span class="hljs-*">`, ou null (linguagem desconhecida / erro). */
export function highlightHtml(code: string, lang: string): string | null {
  const resolved = resolveLanguage(lang);
  if (!resolved) return null;
  try {
    return hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

export interface HighlightToken {
  from: number;
  to: number;
  className: string;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" };
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#x27);/g, (e) => ENTITIES[e] ?? e);

/**
 * Tokens com offsets no código original (para decorations do ProseMirror).
 * O HTML do highlight.js só tem `<span class>`, `</span>` e texto escapado,
 * então um tokenizer mínimo basta — sem DOM, roda em qualquer ambiente.
 */
export function highlightTokens(code: string, lang: string): HighlightToken[] | null {
  const html = highlightHtml(code, lang);
  if (html === null) return null;
  const tokens: HighlightToken[] = [];
  const stack: string[] = [];
  let offset = 0;
  const re = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) stack.push(m[1]);
    else if (m[2] !== undefined) {
      const len = decode(m[2]).length;
      if (stack.length > 0 && len > 0) tokens.push({ from: offset, to: offset + len, className: stack.join(' ') });
      offset += len;
    } else stack.pop();
  }
  return tokens;
}

export { hljs };
