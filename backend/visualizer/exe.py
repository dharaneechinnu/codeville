"""Finding command-line tools. On Windows, npm installs `claude` as an extensionless shell script next to `claude.cmd`,
and only the .cmd can be started from Python. So look for the runnable one first.

An app started from the Start menu or the dock often has a shorter PATH than a terminal, so the usual install folders
of command-line tools are searched as well."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional


def _extra_dirs() -> list:
    home = Path.home()
    dirs = [home / ".local" / "bin", home / ".claude" / "local", home / ".npm-global" / "bin", home / ".bun" / "bin"]
    if os.name == "nt":
        local = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
        roaming = Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming")
        dirs += [roaming / "npm", local / "Microsoft" / "WinGet" / "Links", local / "Microsoft" / "WindowsApps"]
    else:
        dirs += [Path("/opt/homebrew/bin"), Path("/usr/local/bin")]
    return [str(d) for d in dirs]


def find_exe(name: str) -> Optional[str]:
    names = [name + ext for ext in (".exe", ".cmd", ".bat")] if os.name == "nt" else []
    names.append(name)
    for path in (None, os.pathsep.join(_extra_dirs())):
        for n in names:
            found = shutil.which(n, path=path)
            if found:
                return found
    return None
