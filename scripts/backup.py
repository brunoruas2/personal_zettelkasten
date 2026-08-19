"""
Zettelkasten — backup automático local
=======================================
Bate no endpoint /api/backup/export e salva o backup localmente.

Por padrão baixa o formato .zip, que é o único backup completo: leva os zettels
e os bytes das imagens. O .json leva apenas texto e metadados das imagens —
embutir os bytes em base64 inflaria o arquivo a ponto de não ser importável.

Mantém os N backups mais recentes e descarta os mais antigos.

Configuração
------------
Edite as variáveis na seção CONFIG abaixo, ou defina variáveis de ambiente
com os mesmos nomes (útil para não deixar a chave no código):

  ZETTEL_BACKUP_URL  — URL base do app  (padrão: http://localhost:3000)
  ZETTEL_BACKUP_KEY  — chave de 64 hex gerada em Configurações > Chave de backup
  ZETTEL_BACKUP_DIR  — pasta onde os arquivos serão salvos
  ZETTEL_BACKUP_KEEP — quantos arquivos manter (padrão: 30)
  ZETTEL_BACKUP_FORMAT — 'zip' (padrão, completo) ou 'json' (só texto)

Uso
---
  # Executa uma vez
  python backup.py

  # Executa em loop a cada N minutos (ex: a cada 60 minutos)
  python backup.py --loop 60

Agendamento no Windows (Task Scheduler)
----------------------------------------
  Programa : pythonw.exe          ← não abre janela
  Argumentos: C:\caminho\backup.py
  Iniciar em: C:\caminho\         ← mesmo diretório do script
  Gatilho   : diário / ao fazer login / etc.
"""

import os
import sys
import time
import shutil
import logging
import argparse
from datetime import datetime
from pathlib import Path

try:
    import urllib.request
    import urllib.error
except ImportError:
    pass  # stdlib, sempre disponível


def load_dotenv() -> None:
    """Carrega variáveis do .env na mesma pasta do script (sem dependências externas)."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    with env_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:  # variável de ambiente tem prioridade
                os.environ[key] = value


load_dotenv()

# ---------------------------------------------------------------------------
# CONFIG — edite o .env na mesma pasta deste script
# ---------------------------------------------------------------------------
URL  = os.environ.get("ZETTEL_BACKUP_URL", "http://localhost:3000")
KEY  = os.environ.get("ZETTEL_BACKUP_KEY", "")           # obrigatório
_dir_env = os.environ.get("ZETTEL_BACKUP_DIR", "backups")
DIR = str(
    Path(_dir_env) if Path(_dir_env).is_absolute()
    else Path(__file__).parent / _dir_env
)
KEEP = int(os.environ.get("ZETTEL_BACKUP_KEEP", "30"))   # nº de arquivos a manter
FORMAT = os.environ.get("ZETTEL_BACKUP_FORMAT", "zip").lower()  # zip (completo) ou json
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("zettel-backup")


def run_backup() -> bool:
    """Baixa o export e salva em DIR. Retorna True se ok."""
    if not KEY:
        log.error("ZETTEL_BACKUP_KEY não configurada. Edite o script ou defina a variável de ambiente.")
        return False

    ext = "zip" if FORMAT == "zip" else "json"
    endpoint = f"{URL.rstrip('/')}/api/backup/export?key={KEY}&format={ext}"
    out_dir  = Path(DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    filename = f"zettelkasten-{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.{ext}"
    out_path = out_dir / filename

    log.info("Conectando em %s ...", URL)
    try:
        req = urllib.request.Request(endpoint, headers={"User-Agent": "zettel-backup/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            if resp.status != 200:
                log.error("Servidor retornou HTTP %s", resp.status)
                return False
            # Streaming direto para o disco: um backup com imagens pode ter
            # centenas de MB e não cabe confortavelmente na memória.
            with open(out_path, "wb") as fh:
                shutil.copyfileobj(resp, fh, length=64 * 1024)
    except urllib.error.HTTPError as e:
        log.error("HTTP %s — %s", e.code, e.reason)
        if e.code == 401:
            log.error("Chave inválida ou revogada. Gere uma nova em Configurações > Chave de backup.")
        return False
    except urllib.error.URLError as e:
        log.error("Falha de rede: %s", e.reason)
        return False
    except Exception as e:
        log.error("Erro inesperado: %s", e)
        return False

    size_kb = out_path.stat().st_size / 1024
    log.info("Salvo: %s  (%.1f KB)", out_path, size_kb)

    prune(out_dir)
    return True


def prune(out_dir: Path) -> None:
    """Remove backups mais antigos, mantendo os KEEP mais recentes."""
    files = sorted(
        [f for f in out_dir.glob("zettelkasten-*") if f.suffix in (".json", ".zip")],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    to_delete = files[KEEP:]
    for f in to_delete:
        f.unlink()
        log.info("Removido backup antigo: %s", f.name)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backup automático do Zettelkasten")
    parser.add_argument(
        "--loop", type=int, metavar="MINUTOS",
        help="Executa em loop a cada N minutos (omitir = executa uma vez e sai)"
    )
    args = parser.parse_args()

    if args.loop:
        log.info("Modo loop: backup a cada %d minuto(s). Ctrl+C para parar.", args.loop)
        while True:
            run_backup()
            log.info("Próximo backup em %d minuto(s).", args.loop)
            time.sleep(args.loop * 60)
    else:
        ok = run_backup()
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
