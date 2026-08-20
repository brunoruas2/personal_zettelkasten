'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { useSyncStore } from '../../store/useSyncStore';
import { THEMES, applyTheme, getSavedThemeId, type ThemeId } from '../../lib/theme';
import { FONTS, applyFont, getSavedFontId, type FontId } from '../../lib/font';
import { DIAGRAM_LAYOUTS, applyDiagramLayout, getSavedDiagramLayoutId, type DiagramLayoutId } from '../../lib/diagramLayout';
import { useZettelStore } from '../../store/useZettelStore';
import { useOfflineRouter } from '../../hooks/useOfflineRouter';
import { TagInput } from '../../components/TagInput';
import { CLUSTER_COLORS, type NodeColorRule } from '../../lib/graphColors';
import { isPrefetchEnabled, setPrefetchEnabled, prefetchImages, imageStore, countRejectedImages } from '../../lib/imageSync';

const CHUNK = 50

type ImportState =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'importing'; current: number; total: number }
  | { status: 'done'; imported: number; skipped: number; errors: string[] }

async function downloadFile(path: string, filename: string) {
  const res = await api.get(path)
  if (!res.ok) throw new Error('Falha ao exportar')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// `local: true` significa que os números vieram do IndexedDB deste aparelho —
// só o subconjunto de imagens já baixado aqui, sem quota conhecida.
type ImageUsage =
  | { status: 'loading' }
  | { status: 'ready'; bytes: number; count: number; quotaBytes: number | null; local: boolean }

type BackupKeyState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'active' }
  | { status: 'just_generated'; key: string }

export default function SettingsPage() {
  const router = useRouter()
  const offlineRouter = useOfflineRouter()
  const [exporting, setExporting] = useState<'json' | 'markdown' | 'zip' | null>(null)
  const [imagePrefetch, setImagePrefetch] = useState(true)
  const [exportError, setExportError] = useState<string | null>(null)
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)
  const syncNow = useSyncStore((s) => s.syncNow)
  const [template, setTemplate] = useState('')
  const [templateSaved, setTemplateSaved] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [pwError, setPwError] = useState<string | null>(null)
  const [backupKey, setBackupKey] = useState<BackupKeyState>({ status: 'loading' })
  const [backupKeyCopied, setBackupKeyCopied] = useState(false)
  const [backupUrlCopied, setBackupUrlCopied] = useState(false)
  const [themeId, setThemeId] = useState<ThemeId>('purple')
  const [fontId, setFontId] = useState<FontId>('system')
  const [diagramLayoutId, setDiagramLayoutId] = useState<DiagramLayoutId>('side')
  const graphExcludedTags = useZettelStore((s) => s.graphExcludedTags)
  const setGraphExcludedTags = useZettelStore((s) => s.setGraphExcludedTags)
  const [excludedTagsSaved, setExcludedTagsSaved] = useState(false)
  const zettels = useZettelStore((s) => s.zettels)
  const [imageUsage, setImageUsage] = useState<ImageUsage>({ status: 'loading' })
  const [rejectedImages, setRejectedImages] = useState(0)

  // Node color rules — synced to server
  const graphNodeColors = useZettelStore((s) => s.graphNodeColors)
  const setGraphNodeColors = useZettelStore((s) => s.setGraphNodeColors)
  const [colorSearch, setColorSearch] = useState('')
  const [colorDropdownOpen, setColorDropdownOpen] = useState(false)
  const [colorSelectedZettel, setColorSelectedZettel] = useState<{ id: string; title: string } | null>(null)
  const [colorPick, setColorPick] = useState<string | null>(null)
  const colorSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setThemeId(getSavedThemeId())
    setFontId(getSavedFontId())
    setDiagramLayoutId(getSavedDiagramLayoutId())
    setImagePrefetch(isPrefetchEnabled())
  }, [])

  useEffect(() => {
    api.get('/api/auth/settings')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.zettel_template != null) setTemplate(data.zettel_template) })
      .catch(() => {})
    api.get('/api/auth/backup-key')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setBackupKey({ status: data?.active ? 'active' : 'none' }))
      .catch(() => setBackupKey({ status: 'none' }))
  }, [])

  // O texto sai da store, não do servidor: já está inteiro em memória e assim
  // acompanha um import sem precisar de refetch.
  const zettelUsage = useMemo(() => {
    const encoder = new TextEncoder()
    let bytes = 0
    for (const z of zettels) {
      bytes += encoder.encode(z.title + z.body + z.tags.join(' ')).length
    }
    return { count: zettels.length, bytes }
  }, [zettels])

  // As imagens vêm do servidor: este aparelho pode ter só parte delas (prefetch
  // desligado, aparelho novo), então o total local reportaria menos que a conta.
  useEffect(() => {
    let cancelled = false

    async function loadLocal() {
      try {
        const [bytes, ids] = await Promise.all([imageStore.usedBytes(), imageStore.listIds()])
        if (!cancelled) {
          setImageUsage({ status: 'ready', bytes, count: ids.length, quotaBytes: null, local: true })
        }
      } catch {
        if (!cancelled) {
          setImageUsage({ status: 'ready', bytes: 0, count: 0, quotaBytes: null, local: true })
        }
      }
    }

    void countRejectedImages().then((n) => { if (!cancelled) setRejectedImages(n) })

    api.get('/api/images/manifest')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (!data) return loadLocal()
        setImageUsage({
          status: 'ready',
          bytes: data.used_bytes ?? 0,
          count: Array.isArray(data.images) ? data.images.length : 0,
          quotaBytes: data.quota_bytes ?? null,
          local: false,
        })
      })
      .catch(() => { if (!cancelled) void loadLocal() })

    return () => { cancelled = true }
  }, [])

  const totalBytes = zettelUsage.bytes + (imageUsage.status === 'ready' ? imageUsage.bytes : 0)
  const quotaPct = imageUsage.status === 'ready' && imageUsage.quotaBytes
    ? Math.min(100, (imageUsage.bytes / imageUsage.quotaBytes) * 100)
    : null

  async function handleGenerateBackupKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const key = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    const res = await api.post('/api/auth/backup-key', { key })
    if (!res.ok) return
    setBackupKey({ status: 'just_generated', key })
  }

  async function handleRevokeBackupKey() {
    const res = await api.delete('/api/auth/backup-key')
    if (res.ok || res.status === 204) setBackupKey({ status: 'none' })
  }

  function handleCopyKey(key: string) {
    navigator.clipboard.writeText(key)
    setBackupKeyCopied(true)
    setTimeout(() => setBackupKeyCopied(false), 2000)
  }

  function handleCopyUrl(key: string) {
    const url = `${window.location.origin}/api/backup/export?key=${key}`
    navigator.clipboard.writeText(url)
    setBackupUrlCopied(true)
    setTimeout(() => setBackupUrlCopied(false), 2000)
  }

  async function handleSaveExcludedTags(tags: string[]) {
    setGraphExcludedTags(tags)
    await api.put('/api/auth/settings', { graph_excluded_tags: tags })
    setExcludedTagsSaved(true)
    setTimeout(() => setExcludedTagsSaved(false), 2000)
  }

  const colorSearchResults = colorSearch.trim()
    ? zettels.filter((z) => z.title.toLowerCase().includes(colorSearch.toLowerCase())).slice(0, 8)
    : []

  function handleSelectColorZettel(z: { id: string; title: string }) {
    setColorSelectedZettel(z)
    setColorSearch(z.title)
    setColorDropdownOpen(false)
  }

  function applyColorRules(newRules: NodeColorRule[]) {
    setGraphNodeColors(newRules)
    api.put('/api/auth/settings', { graph_node_colors: newRules }).catch(() => {})
  }

  function handleAddColorRule() {
    if (!colorSelectedZettel || !colorPick) return
    const existing = graphNodeColors.findIndex((r) => r.zettelId === colorSelectedZettel.id)
    const newRules = existing >= 0
      ? graphNodeColors.map((r, i) => i === existing ? { ...r, color: colorPick } : r)
      : [...graphNodeColors, { zettelId: colorSelectedZettel.id, zettelTitle: colorSelectedZettel.title, color: colorPick }]
    applyColorRules(newRules)
    setColorSelectedZettel(null)
    setColorSearch('')
    setColorPick(null)
  }

  function handleRemoveColorRule(id: string) {
    applyColorRules(graphNodeColors.filter((r) => r.zettelId !== id))
  }

  async function handleChangePassword() {
    setPwError(null)
    if (pwNew.length < 8) {
      setPwError('A nova senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (pwNew !== pwConfirm) {
      setPwError('As senhas não coincidem.')
      return
    }
    setPwStatus('saving')
    try {
      const res = await api.put('/api/auth/password', { current_password: pwCurrent, new_password: pwNew })
      if (res.status === 204) {
        setPwStatus('saved')
        setPwCurrent('')
        setPwNew('')
        setPwConfirm('')
        setTimeout(() => setPwStatus('idle'), 3000)
      } else {
        const body = await res.json().catch(() => null)
        setPwError(body?.error ?? 'Erro ao alterar senha.')
        setPwStatus('error')
      }
    } catch {
      setPwError('Erro de rede. Tente novamente.')
      setPwStatus('error')
    }
  }

  async function handleSaveTemplate() {
    setTemplateSaving(true)
    try {
      await api.put('/api/auth/settings', { zettel_template: template })
      setTemplateSaved(true)
      setTimeout(() => setTemplateSaved(false), 2000)
    } finally {
      setTemplateSaving(false)
    }
  }

  async function handleExportJSON() {
    setExporting('json')
    setExportError(null)
    try {
      await downloadFile('/api/export/json', `zettelkasten-backup-${today()}.json`)
    } catch {
      setExportError('Erro ao exportar. Tente novamente.')
    } finally {
      setExporting(null)
    }
  }

  async function handleExportZip() {
    setExporting('zip')
    setExportError(null)
    try {
      await downloadFile('/api/export/zip', `zettelkasten-backup-${today()}.zip`)
    } catch {
      setExportError('Erro ao exportar. Tente novamente.')
    } finally {
      setExporting(null)
    }
  }

  async function handleExportMarkdown() {
    setExporting('markdown')
    setExportError(null)
    try {
      await downloadFile('/api/export/markdown', `zettelkasten-export-${today()}.zip`)
    } catch {
      setExportError('Erro ao exportar. Tente novamente.')
    } finally {
      setExporting(null)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (fileRef.current) fileRef.current.value = ''
    setImportState({ status: 'validating' })
    // Yield to the renderer so the loading overlay paints before heavy file I/O starts
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if (file.name.toLowerCase().endsWith('.zip')) {
      await runImportZip(file)
    } else {
      await runImport(file)
    }
  }

  // O ZIP sobe inteiro de uma vez: o servidor grava em arquivo temporário e lê
  // com streaming, então não há por que fatiar em lotes como no JSON.
  async function runImportZip(file: File) {
    setImportState({ status: 'importing', current: 0, total: 1 })
    try {
      const res = await api.postBinary('/api/import/zip', file, 'application/zip')
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) {
        setImportState({
          status: 'done',
          imported: 0,
          skipped: 0,
          errors: [body?.error ?? `Erro HTTP ${res.status}`],
        })
        return
      }
      const imported = body.imported ?? 0
      if (imported > 0) {
        localStorage.setItem('zettel_last_sync_at', '0')
        syncNow?.()
      }
      setImportState({
        status: 'done',
        imported,
        skipped: body.skipped ?? 0,
        errors: Array.isArray(body.errors) ? body.errors : [],
      })
    } catch {
      setImportState({ status: 'done', imported: 0, skipped: 0, errors: ['Erro de rede durante o import.'] })
    }
  }

  async function runImport(file: File) {
    // --- Validar ---
    setImportState({ status: 'validating' })

    let zettels: unknown[]
    try {
      const text = await file.text()
      const data = JSON.parse(text) as { version?: unknown; zettels?: unknown[] }
      if (data.version !== 1 || !Array.isArray(data.zettels)) {
        setImportState({ status: 'done', imported: 0, skipped: 0, errors: ['Formato inválido. O arquivo deve ser um export JSON deste sistema (version: 1).'] })
        return
      }
      zettels = data.zettels
    } catch {
      setImportState({ status: 'done', imported: 0, skipped: 0, errors: ['Arquivo JSON inválido ou corrompido.'] })
      return
    }

    const total = zettels.length
    setImportState({ status: 'importing', current: 0, total })

    let imported = 0
    let skipped = 0
    const allErrors: string[] = []

    // --- Processar em lotes ---
    for (let i = 0; i < total; i += CHUNK) {
      const chunk = zettels.slice(i, i + CHUNK)
      const payload = { version: 1, exported_at: '', zettels: chunk, links: [] }

      try {
        const res = await api.post('/api/import/json', payload)
        const body = await res.json().catch(() => null)

        if (res.ok && body) {
          imported += body.imported ?? 0
          skipped += body.skipped ?? 0
          if (Array.isArray(body.errors)) allErrors.push(...body.errors)
        } else {
          const msg = body?.error ?? `Erro HTTP ${res.status}`
          allErrors.push(`Lote ${Math.floor(i / CHUNK) + 1}: ${msg}`)
        }
      } catch (e) {
        allErrors.push(`Erro de rede no lote ${Math.floor(i / CHUNK) + 1}. Import interrompido.`)
        break
      }

      setImportState({ status: 'importing', current: Math.min(i + CHUNK, total), total })
    }

    // Forçar pull completo para carregar os zettels importados no IndexedDB e na store
    if (imported > 0) {
      localStorage.setItem('zettel_last_sync_at', '0')
      syncNow?.()
    }

    setImportState({ status: 'done', imported, skipped, errors: allErrors })
  }

  const isImporting = importState.status === 'importing' || importState.status === 'validating'

  return (
    <>
      {/* Overlay bloqueante durante import */}
      {isImporting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 p-8 shadow-2xl">
            <h2 className="mb-1 text-base font-bold text-zinc-900 dark:text-zinc-100">
              {importState.status === 'validating' ? 'Validando arquivo...' : 'Importando zettels'}
            </h2>

            {importState.status === 'importing' && (
              <>
                <p className="mb-4 text-sm text-zinc-500">
                  {importState.current} de {importState.total} zettels
                </p>
                <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-300"
                    style={{ width: `${Math.round((importState.current / importState.total) * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-right text-xs font-semibold text-brand">
                  {Math.round((importState.current / importState.total) * 100)}%
                </p>
              </>
            )}

            {importState.status === 'validating' && (
              <div className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                Lendo arquivo...
              </div>
            )}

            <p className="mt-5 text-xs text-zinc-400">Não feche ou navegue para outra página</p>
          </div>
        </div>
      )}

      {/* Resultado do import */}
      {importState.status === 'done' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 p-8 shadow-2xl">
            <div className="mb-4 flex items-center gap-2">
              {importState.errors.length === 0 || importState.imported > 0 ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400">✓</span>
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400">✕</span>
              )}
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {importState.imported > 0 ? 'Importação concluída' : 'Nenhum zettel importado'}
              </h2>
            </div>

            <div className="mb-4 flex gap-4 text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">
                <span className="font-bold text-green-600 dark:text-green-400">{importState.imported}</span> importados
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">
                <span className="font-bold text-zinc-400">{importState.skipped}</span> ignorados
              </span>
              {importState.errors.length > 0 && (
                <span className="text-zinc-700 dark:text-zinc-300">
                  <span className="font-bold text-red-500">{importState.errors.length}</span> erros
                </span>
              )}
            </div>

            {importState.errors.length > 0 && (
              <div className="mb-4 max-h-40 overflow-y-auto rounded-xl bg-red-50 dark:bg-red-950/50 px-3 py-2">
                <p className="mb-1 text-xs font-semibold text-red-600 dark:text-red-400">Zettels com erro (pulados):</p>
                <ul className="space-y-0.5">
                  {importState.errors.map((e, i) => (
                    <li key={i} className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setImportState({ status: 'idle' })}
                className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Fechar
              </button>
              {importState.imported > 0 && (
                <button
                  onClick={() => router.push('/')}
                  className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity"
                >
                  Ver zettels
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Página principal */}
      <div className="mx-auto max-w-2xl px-4 py-8 lg:max-w-4xl">
        <div className="mb-8 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Configurações</h1>
        </div>

        <div className="space-y-8">
          {/* Aparência */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Aparência</h2>
            <p className="mb-4 text-sm text-zinc-500">Cor de destaque do aplicativo.</p>
            <div className="flex gap-3 flex-wrap">
              {THEMES.map((theme) => {
                const isActive = themeId === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => { setThemeId(theme.id); applyTheme(theme.id); }}
                    title={theme.label}
                    className={`relative h-10 w-10 rounded-full transition-transform hover:scale-110 focus:outline-none ${isActive ? 'ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-zinc-950 scale-110' : ''}`}
                    style={{ background: `rgb(${theme.brand})` }}
                  >
                    {isActive && (
                      <span className="absolute inset-0 flex items-center justify-center text-white text-sm font-bold">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              {THEMES.find(t => t.id === themeId)?.label} · salvo neste dispositivo
            </p>

            <p className="mb-3 mt-6 text-sm text-zinc-500">Fonte do aplicativo.</p>
            <div className="flex gap-3 flex-wrap">
              {FONTS.map((font) => {
                const isActive = fontId === font.id;
                return (
                  <button
                    key={font.id}
                    onClick={() => { setFontId(font.id); applyFont(font.id); }}
                    className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all ${
                      isActive
                        ? 'border-brand bg-brand/10 font-semibold text-brand dark:bg-brand/20'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500'
                    }`}
                  >
                    <span className="text-xl leading-none" style={{ fontFamily: font.stack }}>{font.preview}</span>
                    <span>{font.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              {FONTS.find(f => f.id === fontId)?.label} · salvo neste dispositivo
            </p>

            <p className="mb-3 mt-6 text-sm text-zinc-500">Diagramas no editor.</p>
            <div className="flex gap-3 flex-wrap">
              {DIAGRAM_LAYOUTS.map((layout) => {
                const isActive = diagramLayoutId === layout.id;
                return (
                  <button
                    key={layout.id}
                    onClick={() => { setDiagramLayoutId(layout.id); applyDiagramLayout(layout.id); }}
                    title={layout.description}
                    className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all ${
                      isActive
                        ? 'border-brand bg-brand/10 font-semibold text-brand dark:bg-brand/20'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-500'
                    }`}
                  >
                    <span aria-hidden className="text-lg leading-none">{layout.id === 'side' ? '⇹' : '⇳'}</span>
                    <span>{layout.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              {DIAGRAM_LAYOUTS.find(l => l.id === diagramLayoutId)?.label} · salvo neste dispositivo · vale a partir de telas largas
            </p>
          </section>

          {/* Armazenamento */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Armazenamento</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Quanto sua base ocupa hoje. O texto é medido neste aparelho; as imagens vêm da sua conta no servidor.
            </p>

            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
              {/* Zettels */}
              <div className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">Zettels</span>
                <span className="flex items-baseline gap-3 text-sm">
                  <span className="text-zinc-400">{zettelUsage.count} {zettelUsage.count === 1 ? 'nota' : 'notas'}</span>
                  <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">{formatBytes(zettelUsage.bytes)}</span>
                </span>
              </div>

              {/* Imagens */}
              <div className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">Imagens</span>
                {imageUsage.status === 'loading' ? (
                  <span className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                ) : (
                  <span className="flex items-baseline gap-3 text-sm">
                    <span className="text-zinc-400">
                      {imageUsage.count} {imageUsage.count === 1 ? 'arquivo' : 'arquivos'}
                    </span>
                    <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                      {formatBytes(imageUsage.bytes)}
                      {imageUsage.quotaBytes != null && (
                        <span className="font-normal text-zinc-400"> de {formatBytes(imageUsage.quotaBytes)}</span>
                      )}
                    </span>
                  </span>
                )}
              </div>

              {quotaPct != null && (
                <div className="pb-1.5">
                  <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        quotaPct > 95 ? 'bg-red-500' : quotaPct >= 80 ? 'bg-amber-500' : 'bg-brand'
                      }`}
                      style={{ width: `${Math.max(quotaPct, 1)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-xs text-zinc-400 tabular-nums">{Math.round(quotaPct)}%</p>
                </div>
              )}

              {imageUsage.status === 'ready' && imageUsage.local && (
                <p className="pb-1.5 text-xs text-zinc-400">
                  Sem conexão com o servidor — mostrando apenas as imagens guardadas neste aparelho.
                </p>
              )}

              {rejectedImages > 0 && (
                <p className="pb-1.5 text-xs text-amber-600 dark:text-amber-400">
                  {rejectedImages} {rejectedImages === 1 ? 'imagem não pôde ser enviada' : 'imagens não puderam ser enviadas'} ao
                  servidor — {rejectedImages === 1 ? 'ela existe' : 'elas existem'} apenas neste aparelho e não {rejectedImages === 1 ? 'entra' : 'entram'} no backup.
                </p>
              )}

              {/* Total */}
              <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-2.5">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Total</span>
                <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{formatBytes(totalBytes)}</span>
              </div>
            </div>
          </section>

          {/* Imagens */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Imagens</h2>
            <p className="mb-4 text-sm text-zinc-500">
              As imagens ficam guardadas no aparelho para funcionar offline. Com o pré-carregamento ligado,
              elas são baixadas em segundo plano após cada sincronização — assim um zettel que você nunca
              abriu neste aparelho já aparece com imagem quando você estiver sem conexão.
            </p>
            <label className="flex cursor-pointer items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={imagePrefetch}
                onChange={(e) => {
                  setImagePrefetch(e.target.checked)
                  setPrefetchEnabled(e.target.checked)
                  if (e.target.checked) void prefetchImages()
                }}
                className="h-4 w-4 accent-brand"
              />
              Pré-carregar imagens para uso offline
            </label>
          </section>

          {/* Mapa de conexões */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Mapa de conexões</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Zettels com qualquer uma dessas tags serão ocultados do mapa e do mini-mapa.
              Útil para excluir clusters muito grandes (ex: <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-xs">ipv</code>).
            </p>
            <TagInput
              tags={graphExcludedTags}
              onChange={handleSaveExcludedTags}
            />
            {excludedTagsSaved && (
              <p className="mt-2 text-sm text-green-600 dark:text-green-400">Salvo!</p>
            )}
          </section>

          {/* Cores dos clusters */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cores dos clusters</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Escolha uma cor para um zettel — todos os seus vizinhos diretos no mapa assumirão a mesma cor.
              Útil para dar identidade visual a clusters por tema.
            </p>

            {/* Form: zettel search + color pick */}
            <div className="flex flex-wrap items-start gap-3">
              {/* Zettel autocomplete */}
              <div className="relative min-w-0 flex-1" style={{ minWidth: 200 }}>
                <input
                  ref={colorSearchRef}
                  type="text"
                  value={colorSearch}
                  onChange={(e) => {
                    setColorSearch(e.target.value)
                    setColorSelectedZettel(null)
                    setColorDropdownOpen(true)
                  }}
                  onFocus={() => setColorDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setColorDropdownOpen(false), 150)}
                  placeholder="Buscar zettel..."
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-brand/50"
                />
                {colorDropdownOpen && colorSearchResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
                    {colorSearchResults.map((z) => (
                      <button
                        key={z.id}
                        onMouseDown={(e) => { e.preventDefault(); handleSelectColorZettel(z); }}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                      >
                        {z.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Color palette */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {CLUSTER_COLORS.map((c) => (
                  <button
                    key={c.id}
                    title={c.label}
                    onClick={() => setColorPick(c.hex)}
                    className="h-8 w-8 rounded-full transition-transform hover:scale-110 focus:outline-none"
                    style={{
                      background: c.hex,
                      boxShadow: colorPick === c.hex ? `0 0 0 2px white, 0 0 0 4px ${c.hex}` : undefined,
                      transform: colorPick === c.hex ? 'scale(1.15)' : undefined,
                    }}
                  />
                ))}
              </div>

              <button
                onClick={handleAddColorRule}
                disabled={!colorSelectedZettel || !colorPick}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                Adicionar
              </button>
            </div>

            {/* Rules list */}
            {graphNodeColors.length > 0 && (
              <ul className="mt-4 space-y-2">
                {graphNodeColors.map((rule) => (
                  <li key={rule.zettelId} className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2">
                    <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: rule.color }} />
                    <span className="flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">{rule.zettelTitle}</span>
                    <button
                      onClick={() => handleRemoveColorRule(rule.zettelId)}
                      className="text-zinc-400 hover:text-red-500 transition-colors text-lg leading-none"
                      title="Remover"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-zinc-400">Sincronizado entre dispositivos</p>
          </section>

          {/* Template */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Template padrão</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Pré-preenche o corpo ao criar um novo zettel. Deixe em branco para desativar.
            </p>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={8}
              placeholder={'## Contexto\n\n## Ideia\n\n## Referências'}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm font-mono text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-brand/50 resize-y"
              spellCheck={false}
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleSaveTemplate}
                disabled={templateSaving}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {templateSaving ? 'Salvando...' : 'Salvar template'}
              </button>
              {templateSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Salvo!</span>
              )}
            </div>
          </section>

          {/* Backup key */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Chave de backup automático</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Gera uma URL que exporta seus zettels em JSON sem precisar de login — ideal para scripts de backup agendados (cron, etc).
              Guarde a chave em local seguro: ela não pode ser recuperada depois.
            </p>

            {backupKey.status === 'loading' && (
              <p className="text-sm text-zinc-400">Carregando...</p>
            )}

            {backupKey.status === 'none' && (
              <button
                onClick={handleGenerateBackupKey}
                className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-95 transition-all"
              >
                Gerar chave de backup
              </button>
            )}

            {backupKey.status === 'just_generated' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
                  <p className="mb-2 text-xs font-semibold text-amber-700 dark:text-amber-400">Salve agora — esta chave não será exibida novamente</p>
                  <code className="block break-all text-xs font-mono text-zinc-800 dark:text-zinc-200 select-all">
                    {backupKey.key}
                  </code>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleCopyKey(backupKey.key)}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {backupKeyCopied ? 'Copiado!' : 'Copiar chave'}
                  </button>
                  <button
                    onClick={() => handleCopyUrl(backupKey.key)}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {backupUrlCopied ? 'Copiado!' : 'Copiar URL de backup'}
                  </button>
                  <button
                    onClick={handleRevokeBackupKey}
                    className="rounded-xl border border-red-200 dark:border-red-800 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                  >
                    Revogar
                  </button>
                </div>
              </div>
            )}

            {backupKey.status === 'active' && (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Chave ativa
                </span>
                <button
                  onClick={handleRevokeBackupKey}
                  className="rounded-xl border border-red-200 dark:border-red-800 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                >
                  Revogar chave
                </button>
              </div>
            )}
          </section>

          {/* Alterar senha */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Alterar senha</h2>
            <p className="mb-4 text-sm text-zinc-500">Troque a senha da sua conta.</p>
            <div className="flex flex-col gap-3 max-w-sm">
              <input
                type="password"
                value={pwCurrent}
                onChange={(e) => { setPwCurrent(e.target.value); setPwStatus('idle'); setPwError(null) }}
                placeholder="Senha atual"
                autoComplete="current-password"
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-brand/50"
              />
              <input
                type="password"
                value={pwNew}
                onChange={(e) => { setPwNew(e.target.value); setPwStatus('idle'); setPwError(null) }}
                placeholder="Nova senha (mín. 8 caracteres)"
                autoComplete="new-password"
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-brand/50"
              />
              <input
                type="password"
                value={pwConfirm}
                onChange={(e) => { setPwConfirm(e.target.value); setPwStatus('idle'); setPwError(null) }}
                placeholder="Confirmar nova senha"
                autoComplete="new-password"
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-brand/50"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleChangePassword}
                  disabled={pwStatus === 'saving' || !pwCurrent || !pwNew || !pwConfirm}
                  className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {pwStatus === 'saving' ? 'Salvando...' : 'Alterar senha'}
                </button>
                {pwStatus === 'saved' && (
                  <span className="text-sm text-green-600 dark:text-green-400">Senha alterada!</span>
                )}
              </div>
              {pwError && (
                <p className="text-sm text-red-500 dark:text-red-400">{pwError}</p>
              )}
            </div>
          </section>

          {/* Import */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Importar dados</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Aceita <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-xs">.zip</code> (texto + imagens)
              ou <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-xs">.json</code> (só texto), exportados por este sistema.
              Zettels com erro são pulados individualmente — os demais são importados normalmente.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.zip"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-95 transition-all"
            >
              Selecionar arquivo
            </button>
          </section>

          {/* Export */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Exportar dados</h2>
            <p className="mb-4 text-sm text-zinc-500">Baixe todos os seus zettels para backup ou para usar em outro aplicativo.</p>
            <div className="mb-3 flex flex-wrap gap-3">
              <button
                onClick={handleExportZip}
                disabled={exporting !== null}
                className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                {exporting === 'zip' ? 'Gerando...' : 'Backup completo (.zip)'}
              </button>
            </div>
            <p className="mb-4 text-xs text-zinc-500">
              O backup <strong>.zip</strong> é o único que inclui as imagens. O <strong>.json</strong> leva
              apenas o texto e os metadados das imagens — embutir os bytes em base64 inflaria o arquivo
              a ponto de não ser importável de volta.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleExportMarkdown}
                disabled={exporting !== null}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {exporting === 'markdown' ? 'Gerando...' : 'Baixar como Markdown (.zip)'}
              </button>
              <button
                onClick={handleExportJSON}
                disabled={exporting !== null}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {exporting === 'json' ? 'Gerando...' : 'Baixar como JSON (sem imagens)'}
              </button>
              <button
                onClick={() => offlineRouter.push('/export/pdf')}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Exportar como PDF
              </button>
            </div>
            {exportError && <p className="mt-2 text-sm text-red-500">{exportError}</p>}
          </section>
        </div>
      </div>
    </>
  )
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Base 1024 porque é assim que o servidor conta a quota (`250<<20`); em base
// 1000 os 250 MB de quota apareceriam como 262,1 MB.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1).replace('.', ',')} MB`
  return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
}
