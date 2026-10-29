"""Finding command-line tools. On Windows, npm installs `claude` as an extensionless shell script next to `claude.cmd`,
and only the .cmd can be started from Python. So look for the runnable one first."""

from __future__ import annotations

import os
import shutil
from typing import Optional


def find_exe(name: str) -> Optional[str]:
    if os.name == "nt":
        for ext in (".exe", ".cmd", ".bat"):
            found = shutil.which(name + ext)
            if found:
                return found
    return shutil.which(name)
