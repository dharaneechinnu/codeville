"""Reads a project folder. The work is done by the analysis agent in `visualizer.analysis`; this keeps the old entry point."""

from __future__ import annotations

from typing import Callable, Optional

from .analysis import run_analysis


def analyze_project(root_input: str, emit: Optional[Callable[[dict], None]] = None) -> dict:
    return run_analysis(root_input, emit)
