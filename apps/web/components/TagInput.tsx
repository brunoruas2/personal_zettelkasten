'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}

export function TagInput({ tags, onChange, suggestions = [] }: Props) {
  const [input, setInput] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const normalized = input.trim().toLowerCase().replace(/\s+/g, '-');

  const matches = normalized
    ? suggestions.filter(
        (s) => s.includes(normalized) && !tags.includes(s),
      )
    : [];

  useEffect(() => {
    setActiveIdx(0);
    setDropdownOpen(matches.length > 0);
  }, [input, matches.length]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput('');
    setDropdownOpen(false);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    if (text.endsWith(',') || text.endsWith(' ')) {
      addTag(text.slice(0, -1));
    } else {
      setInput(text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (dropdownOpen && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, matches.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        addTag(matches[activeIdx]);
        return;
      }
      if (e.key === 'Escape') { setDropdownOpen(false); return; }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (input.trim()) addTag(input);
    }
    if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="mt-6" ref={containerRef}>
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        Tags
      </span>
      <div
        className="relative flex min-h-[44px] cursor-text flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-0.5 text-sm font-medium text-brand dark:text-brand-light"
          >
            #{tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              className="ml-0.5 text-base leading-none hover:opacity-70"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (matches.length > 0) setDropdownOpen(true); }}
          placeholder={tags.length === 0 ? 'Adicionar tags...' : '+'}
          className="flex-1 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
          autoCapitalize="none"
          autoCorrect="off"
        />

        {dropdownOpen && matches.length > 0 && (
          <ul className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {matches.map((tag, idx) => (
              <li key={tag}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); addTag(tag); }}
                  className={`w-full px-3 py-1.5 text-left text-sm font-medium transition-colors ${
                    idx === activeIdx
                      ? 'bg-brand/10 text-brand dark:text-brand-light'
                      : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  #{tag}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {tags.length === 0 && (
        <p className="mt-1.5 text-[11px] text-zinc-400">Separe com vírgula, espaço ou Enter</p>
      )}
    </div>
  );
}
