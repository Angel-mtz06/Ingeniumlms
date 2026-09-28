"""Lee un archivo .env simple (CLAVE=valor) sin dependencias extra.

No sobrescribe variables que ya existan en el entorno: el entorno real manda.
"""
from __future__ import annotations

import os
from pathlib import Path


def load_env_file(path: Path) -> list[str]:
    """Carga CLAVE=valor de `path` en os.environ; devuelve las claves cargadas."""
    if not path.exists():
        return []
    loaded = []
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if not key or key in os.environ:
            continue
        os.environ[key] = value
        loaded.append(key)
    return loaded
