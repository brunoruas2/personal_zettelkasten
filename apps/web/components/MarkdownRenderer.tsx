'use client';

import React from 'react';
import { PlantUmlBlock } from './PlantUmlBlock';
import { Chords } from './Chords';
import { AbcNotation } from './AbcNotation';
import 'highlight.js/styles/github.css';
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
import { INLINE_RE } from '../lib/markdownInline';

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

const LANG_ALIASES: Record<string, string> = {
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

interface Props {
  body: string;
  onLinkPress: (title: string) => void;
  disableWikiLinks?: boolean;
  onBodyChange?: (rawStart: number, rawEnd: number, newContent: string) => void;
}

interface ListNode {
  text: string;
  ordered: boolean;
  checked?: boolean; // undefined = regular, false = [ ], true = [x]
  children: ListNode[];
}

function buildNestedList(
  flatItems: Array<{ indent: number; text: string; ordered: boolean; checked?: boolean }>,
): ListNode[] {
  const root: ListNode[] = [];
  const stack: Array<{ nodes: ListNode[]; indent: number }> = [{ nodes: root, indent: -1 }];

  for (const item of flatItems) {
    const node: ListNode = { text: item.text, ordered: item.ordered, checked: item.checked, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].indent >= item.indent) {
      stack.pop();
    }
    stack[stack.length - 1].nodes.push(node);
    stack.push({ nodes: node.children, indent: item.indent });
  }

  return root;
}

function renderListNodes(
  nodes: ListNode[],
  keyPrefix: string,
  onLinkPress: (title: string) => void,
  depth = 0,
  disableWikiLinks = false,
): React.ReactNode {
  if (nodes.length === 0) return null;
  return (
    <ul key={keyPrefix} className={`${depth === 0 ? 'my-1' : 'mt-0.5'} space-y-0.5`}>
      {nodes.map((node, idx) => (
        <li key={idx} className="flex flex-col">
          <div className="flex gap-2 items-start">
            {node.checked !== undefined ? (
              <span className={`mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded border ${node.checked ? 'border-brand bg-brand text-white' : 'border-zinc-400 dark:border-zinc-500'}`}>
                {node.checked && (
                  <svg viewBox="0 0 10 8" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <polyline points="1,4 3.5,6.5 9,1" />
                  </svg>
                )}
              </span>
            ) : (
              <span
                className={`font-bold text-brand shrink-0 ${node.ordered ? 'min-w-[1.25rem] text-right' : ''}`}
              >
                {node.ordered ? `${idx + 1}.` : '•'}
              </span>
            )}
            <span className={`flex-1 ${node.checked ? 'line-through text-zinc-400 dark:text-zinc-500' : 'text-zinc-800 dark:text-zinc-200'}`}>
              {renderInline(node.text, onLinkPress, `${keyPrefix}-${idx}`, disableWikiLinks)}
            </span>
          </div>
          {node.children.length > 0 && (
            <div className="pl-5">
              {renderListNodes(node.children, `${keyPrefix}-c${idx}`, onLinkPress, depth + 1, disableWikiLinks)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function InlineImage({ src, alt, id }: { src: string; alt: string; id: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <a key={id} href={src} target="_blank" rel="noopener noreferrer" className="break-all text-brand-light underline">
        {alt || src}
      </a>
    );
  }
  return (
    <img
      key={id}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="my-2 max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
    />
  );
}

function CodeBlock({ content, lang }: { content: string; lang: string }) {
  const [wrapped, setWrapped] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  const highlighted = React.useMemo(() => {
    const resolved = LANG_ALIASES[lang] ?? lang;
    if (!resolved) return null;
    try {
      return hljs.highlight(content, { language: resolved, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [content, lang]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1 dark:border-zinc-700">
        <span className="font-mono text-xs text-zinc-400">{lang}</span>
        <div className="no-print flex items-center gap-2">
          <button
            onClick={handleCopy}
            className={`text-[11px] font-semibold transition-colors ${
              copied
                ? 'text-brand dark:text-brand-light'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
            title="Copiar código"
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
          <button
            onClick={() => setWrapped((v) => !v)}
            className={`text-[11px] font-semibold transition-colors ${
              wrapped
                ? 'text-brand dark:text-brand-light'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
            title={wrapped ? 'Voltar para scroll horizontal' : 'Quebrar linhas longas'}
          >
            {wrapped ? '↔ rolar' : '↩ quebrar'}
          </button>
        </div>
      </div>
      <pre
        className={`code-block-pre p-3 font-mono text-sm leading-5 ${
          wrapped ? 'whitespace-pre-wrap break-all' : 'overflow-x-auto'
        }`}
      >
        {highlighted ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{content}</code>
        )}
      </pre>
    </div>
  );
}

function parseTableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

function renderInline(
  text: string,
  onLinkPress: (title: string) => void,
  keyPrefix: string,
  disableWikiLinks = false,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`${keyPrefix}-t${k++}`}>{text.slice(last, m.index)}</span>);
    }
    if (m[1] !== undefined) {
      const rawTarget = m[1];
      const target = rawTarget.startsWith('^') ? rawTarget.slice(1) : rawTarget;
      const label = m[2] ?? target;
      parts.push(
        disableWikiLinks ? (
          <span key={`${keyPrefix}-l${k++}`}>{label}</span>
        ) : (
          <button
            key={`${keyPrefix}-l${k++}`}
            onClick={() => onLinkPress(target)}
            className="text-brand-light underline hover:opacity-80 transition-opacity"
          >
            {label}
          </button>
        ),
      );
    } else if (m[3] !== undefined) {
      parts.push(<strong key={`${keyPrefix}-b${k++}`}>{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      parts.push(<em key={`${keyPrefix}-i${k++}`}>{m[4]}</em>);
    } else if (m[5] !== undefined) {
      parts.push(
        <code
          key={`${keyPrefix}-c${k++}`}
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-sm dark:bg-zinc-800"
        >
          {m[5]}
        </code>,
      );
    } else if (m[6] !== undefined) {
      parts.push(<s key={`${keyPrefix}-s${k++}`} className="text-zinc-400 dark:text-zinc-500">{m[6]}</s>);
    } else if (m[8] !== undefined) {
      // markdown image syntax: ![alt](url)
      const id = `${keyPrefix}-img${k++}`;
      parts.push(<InlineImage key={id} id={id} src={m[8]} alt={m[7] ?? ''} />);
    } else if (m[9] !== undefined) {
      // bare image URL
      const id = `${keyPrefix}-img${k++}`;
      parts.push(<InlineImage key={id} id={id} src={m[9]} alt="" />);
    } else if (m[10] !== undefined) {
      // markdown link [text](url)
      parts.push(
        <a
          key={`${keyPrefix}-a${k++}`}
          href={m[11]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-light underline hover:opacity-80 transition-opacity"
        >
          {m[10]}
        </a>,
      );
    } else if (m[12] !== undefined) {
      // bare URL
      parts.push(
        <a
          key={`${keyPrefix}-a${k++}`}
          href={m[12]}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-brand-light underline hover:opacity-80 transition-opacity"
        >
          {m[12]}
        </a>,
      );
    } else if (m[13] !== undefined) {
      // CommonMark autolink <https://url>
      parts.push(
        <a
          key={`${keyPrefix}-a${k++}`}
          href={m[13]}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-brand-light underline hover:opacity-80 transition-opacity"
        >
          {m[13]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    parts.push(<span key={`${keyPrefix}-t${k++}`}>{text.slice(last)}</span>);
  }
  return parts;
}

export function MarkdownRenderer({ body, onLinkPress, disableWikiLinks = false, onBodyChange }: Props) {
  const lines = body.split('\n');
  const lineStartOffsets: number[] = [];
  {
    let acc = 0;
    for (const l of lines) {
      lineStartOffsets.push(acc);
      acc += l.length + 1;
    }
  }
  const blocks: React.ReactNode[] = [];
  let codeBlockLines: string[] = [];
  let codeBlockLang = '';
  let codeBlockContentStartLine = 0;
  let inCodeBlock = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim().toLowerCase();
        codeBlockLines = [];
        codeBlockContentStartLine = i + 1;
        i++;
        continue;
      } else {
        const content = codeBlockLines.join('\n');
        if (codeBlockLang === 'plantuml') {
          blocks.push(<PlantUmlBlock key={`puml${i}`} source={content} />);
        } else if (codeBlockLang === 'chords') {
          const rawStart = lineStartOffsets[codeBlockContentStartLine];
          const rawEnd = rawStart + content.length;
          blocks.push(
            <Chords
              key={`chords${i}`}
              source={content}
              onSave={onBodyChange ? (newContent) => onBodyChange(rawStart, rawEnd, newContent) : undefined}
            />,
          );
        } else if (codeBlockLang === 'abc') {
          blocks.push(<AbcNotation key={`abc${i}`} source={content} />);
        } else {
          blocks.push(<CodeBlock key={`cb${i}`} content={content} lang={codeBlockLang} />);
        }
        inCodeBlock = false;
        codeBlockLang = '';
        i++;
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      blocks.push(<hr key={`hr${i}`} className="my-4 border-zinc-200 dark:border-zinc-700" />);
      i++;
      continue;
    }

    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);

    if (h1) {
      blocks.push(<h1 key={`h${i}`} className="mb-1 mt-2 text-2xl font-extrabold text-zinc-900 dark:text-zinc-100">{h1[1]}</h1>);
      i++; continue;
    }
    if (h2) {
      blocks.push(<h2 key={`h${i}`} className="mb-1 mt-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">{h2[1]}</h2>);
      i++; continue;
    }
    if (h3) {
      blocks.push(<h3 key={`h${i}`} className="mb-0.5 mt-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{h3[1]}</h3>);
      i++; continue;
    }

    if (/^> /.test(line)) {
      const bqStart = i;
      const bqLines: string[] = [];
      while (i < lines.length && /^> /.test(lines[i])) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <blockquote
          key={`bq${bqStart}`}
          className="my-1 border-l-4 border-brand bg-brand/5 py-1 pl-3 italic text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
        >
          {bqLines.map((l, idx) => (
            <p key={idx}>{renderInline(l, onLinkPress, `bq${bqStart}-${idx}`, disableWikiLinks)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*([-*]|\d+\.) /.test(line)) {
      const listStart = i;
      const flatItems: Array<{ indent: number; text: string; ordered: boolean; checked?: boolean }> = [];
      while (i < lines.length) {
        if (lines[i].trim() === '') {
          let j = i;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j >= lines.length || !/^\s*([-*]|\d+\.) /.test(lines[j])) break;
          i = j;
          continue;
        }
        const m = lines[i].match(/^(\s*)([-*]|\d+\.) (.*)$/);
        if (!m) break;
        let text = m[3];
        let checked: boolean | undefined;
        const taskMatch = text.match(/^\[(x| )\] (.*)$/i);
        if (taskMatch) {
          checked = taskMatch[1].toLowerCase() === 'x';
          text = taskMatch[2];
        }
        flatItems.push({ indent: m[1].length, text, ordered: /^\d/.test(m[2]), checked });
        i++;
      }
      const tree = buildNestedList(flatItems);
      blocks.push(
        <div key={`list${listStart}`} className="pl-1">
          {renderListNodes(tree, `list${listStart}`, onLinkPress, 0, disableWikiLinks)}
        </div>,
      );
      continue;
    }

    if (
      line.trimStart().startsWith('|') &&
      i + 1 < lines.length &&
      /^\s*\|[\s|:\-]+\|\s*$/.test(lines[i + 1])
    ) {
      const tableStart = i;
      const headerCells = parseTableCells(line);
      i++; // separator line
      const alignments: Array<'left' | 'center' | 'right'> = parseTableCells(lines[i]).map((cell) => {
        const c = cell.trim();
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        return 'left';
      });
      i++; // first data row
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        rows.push(parseTableCells(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`tbl${tableStart}`} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {headerCells.map((cell, idx) => (
                  <th
                    key={idx}
                    style={{ textAlign: alignments[idx] ?? 'left' }}
                    className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 font-semibold text-zinc-800 dark:text-zinc-200"
                  >
                    {renderInline(cell, onLinkPress, `th${tableStart}-${idx}`, disableWikiLinks)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ridx) => (
                <tr
                  key={ridx}
                  className={ridx % 2 === 0 ? 'bg-white dark:bg-zinc-900' : 'bg-zinc-50 dark:bg-zinc-800/50'}
                >
                  {row.map((cell, cidx) => (
                    <td
                      key={cidx}
                      style={{ textAlign: alignments[cidx] ?? 'left' }}
                      className="border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-zinc-700 dark:text-zinc-300"
                    >
                      {renderInline(cell, onLinkPress, `td${tableStart}-${ridx}-${cidx}`, disableWikiLinks)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.trim() === '') {
      blocks.push(<div key={`sp${i}`} className="h-2" />);
      i++; continue;
    }

    blocks.push(
      <p
        key={`p${i}`}
        data-line-start={lineStartOffsets[i]}
        className="leading-relaxed text-zinc-800 dark:text-zinc-200"
      >
        {renderInline(line, onLinkPress, `p${i}`, disableWikiLinks)}
      </p>,
    );
    i++;
  }

  // Render unclosed code block (missing closing ```)
  if (inCodeBlock && codeBlockLines.length > 0) {
    const content = codeBlockLines.join('\n');
    if (codeBlockLang === 'plantuml') {
      blocks.push(<PlantUmlBlock key="puml-unclosed" source={content} />);
    } else if (codeBlockLang === 'chords') {
      const rawStart = lineStartOffsets[codeBlockContentStartLine];
      const rawEnd = rawStart + content.length;
      blocks.push(
        <Chords
          key="chords-unclosed"
          source={content}
          onSave={onBodyChange ? (newContent) => onBodyChange(rawStart, rawEnd, newContent) : undefined}
        />,
      );
    } else if (codeBlockLang === 'abc') {
      blocks.push(<AbcNotation key="abc-unclosed" source={content} />);
    } else {
      blocks.push(<CodeBlock key="cb-unclosed" content={content} lang={codeBlockLang} />);
    }
  }

  return <div className="space-y-0.5">{blocks}</div>;
}
