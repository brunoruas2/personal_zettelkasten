'use client';

import { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="px-5 pt-4 pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {title}
        </h3>
      </div>
      <div className="px-5 pb-4 space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ syntax, desc }: { syntax: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <code className="shrink-0 rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {syntax}
      </code>
      <span className="text-sm text-zinc-500 dark:text-zinc-400 leading-tight pt-0.5">{desc}</span>
    </div>
  );
}

function BlockRow({ syntax, desc }: { syntax: string; desc: string }) {
  return (
    <div className="space-y-1">
      <span className="text-sm text-zinc-500 dark:text-zinc-400">{desc}</span>
      <pre className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300 overflow-x-auto leading-relaxed">
        {syntax}
      </pre>
    </div>
  );
}

export function MarkdownCheatsheet({ open, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      return () => {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800 shrink-0">
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Guia de formatação
          </span>
          <button
            onClick={onClose}
            className="text-sm font-medium text-brand hover:opacity-80"
          >
            Fechar
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto overscroll-contain flex-1">
          <Section title="Texto inline">
            <Row syntax="**negrito**" desc="Texto em negrito" />
            <Row syntax="*itálico*" desc="Texto em itálico" />
            <Row syntax="`código`" desc="Código inline" />
            <Row syntax="~~riscado~~" desc="Texto riscado" />
          </Section>

          <Section title="Títulos">
            <Row syntax="# Título" desc="Título grande (H1)" />
            <Row syntax="## Subtítulo" desc="Subtítulo (H2)" />
            <Row syntax="### Seção" desc="Seção menor (H3)" />
          </Section>

          <Section title="Listas e blocos">
            <Row syntax="- item" desc="Lista com marcador" />
            <Row syntax="  - sub-item" desc="Sub-item (2 espaços de indentação)" />
            <Row syntax="1. item" desc="Lista numerada" />
            <Row syntax="> texto" desc="Citação / blockquote" />
            <Row syntax="---" desc="Linha separadora horizontal" />
          </Section>

          <Section title="Tabela">
            <BlockRow
              syntax={"| Coluna A | Coluna B |\n| -------- | -------- |\n| valor 1  | valor 2  |"}
              desc="Tabela com cabeçalho"
            />
          </Section>

          <Section title="Links e imagens">
            <Row syntax="[[título]]" desc="Link para outro zettel" />
            <Row syntax="[[alvo|label]]" desc="Link com texto customizado" />
            <Row syntax="[[^título]]" desc="Marca título como pai desta nota" />
            <Row syntax="![alt](url)" desc="Imagem (markdown)" />
            <Row syntax="https://...png" desc="URL de imagem direta (renderiza inline)" />
          </Section>

          <Section title="Diagrama (PlantUML)">
            <BlockRow
              syntax={"```plantuml\n@startuml\nAlice -> Bob: mensagem\n@enduml\n```"}
              desc="Diagrama gerado no servidor via PlantUML"
            />
          </Section>

          <Section title="Cifra (acordes)">
            <BlockRow
              syntax={"```chords\nAm        G\nEssa é a letra da música\n```"}
              desc="Acordes acima da letra (linha só com acordes)"
            />
            <BlockRow
              syntax={"```chords\n[Am]Essa é a [G]letra\n```"}
              desc="Acordes inline entre colchetes"
            />
            <Row syntax="− / +" desc="Botões −/+ transpõem semitons (estado local, não salvo)" />
          </Section>

          <Section title="Partitura (ABC Notation)">
            <BlockRow
              syntax={"```abc\nX:1\nT:Título\nM:4/4\nK:C\nCDEF GABc|\n```"}
              desc="Partitura renderizada com abcjs"
            />
          </Section>

          <Section title="Atalhos no editor">
            <Row syntax="[[ ..." desc="Abre autocomplete de links para outros zettels" />
            <Row syntax="/ ..." desc="Abre menu de blocos no início de uma linha" />
            <Row syntax="Alt+P" desc="Alterna entre edição e preview (fora do campo de texto)" />
            <Row syntax="Alt+S" desc="Salvar zettel (fora do campo de texto)" />
            <Row syntax="Alt+H" desc="Abre/fecha este guia de formatação (fora do campo de texto)" />
            <Row syntax="Alt+E" desc="Abrir modo de edição (na visualização do zettel)" />
          </Section>
        </div>
      </div>
    </div>
  );
}
