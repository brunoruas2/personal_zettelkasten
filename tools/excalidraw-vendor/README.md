# excalidraw-vendor

Gera `apps/web/public/vendor/excalidraw/`, o Excalidraw vendorizado que o app carrega sob demanda
(`apps/web/lib/excalidrawEngine.ts`). Fica **fora do workspace pnpm** (`pnpm-workspace.yaml` só lista
`apps/*` e `packages/*`) de propósito: a VPS roda `pnpm install` e build com heap de 384 MB e nunca pode
resolver `@excalidraw/*`.

- Versão travada: **@excalidraw/excalidraw 0.18.1** (React 19.2.4 próprio do bundle, esbuild 0.25.10).
- Licença do Excalidraw: MIT.

## Atualizar / regenerar

```bash
cd tools/excalidraw-vendor
npm install --no-package-lock
npm run build
```

O build reescreve `apps/web/public/vendor/excalidraw/` de forma determinística e commita-se o resultado:

- `excalidraw.js` + `chunks/` — ESM com code splitting, carregado por `import()` (fora do webpack);
  só os locales `pt-BR` e `en` têm conteúdo, os demais viram módulo vazio.
- `excalidraw.css`, `*.woff2` (fontes do CSS) e `fonts/` (sem Xiaolai, 13 MB de fallback CJK).
- `manifest.json` — lista de arquivos que o Service Worker precacheia.

`entry.tsx` expõe `window.ZkExcalidraw = { mount }` (API em `entry.tsx`). Troque a versão em
`package.json`, rode o build, teste o editor e commite.
