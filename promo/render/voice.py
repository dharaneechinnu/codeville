"""Voiceover for the demo video, spoken by Kokoro-82M (open-source, Apache 2.0) through kokoro-onnx.

    pip install kokoro-onnx soundfile
    # model files: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
    python voice.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin   -> ../audio/demo-voice.wav

Each line starts at its time in seconds (demo.js: 3.5 s title, then the walkthrough). A line that would
overlap the one before is pushed later, and the script says so.
"""
import argparse
import os

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

LINES = [
    (0.4, "Codeville. Built for vibe coders."),
    (4.0, "Connect Claude Code once. Codeville checks Git, Claude Code and Node, then you just open your project."),
    (14.0, "An analysis agent reads your project: the stack, the layers, every feature, and how they connect."),
    (22.0, "It even finds your test and build commands."),
    (28.8, "Your prompts, made visual. Each feature becomes a district, and every file is a block."),
    (35.0, "Click a block to open the file."),
    (39.2, "Click a building to see only its links."),
    (44.2, "Now, just prompt. Ask for a wishlist feature..."),
    (49.2, "and watch every file Claude writes drop into the town, live."),
    (59.0, "Run your tests, and a shopper walks every step."),
    (66.6, "It stops right where it breaks, and tells you what to fix next."),
    (70.6, "One click, and Claude is on it."),
    (74.0, "Then ship it. Stage, commit and push, in one click."),
    (84.0, "Turn on your camera, and steer the town with your hands."),
    (89.9, "Codeville. Vibe code. See it build."),
]

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="kokoro-v1.0.onnx")
ap.add_argument("--voices", default="voices-v1.0.bin")
ap.add_argument("--voice", default="am_michael")
ap.add_argument("--speed", type=float, default=1.05)
ap.add_argument("--duration", type=float, default=93.5)
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "audio", "demo-voice.wav"))
args = ap.parse_args()

kokoro = Kokoro(args.model, args.voices)
sr = 24000
track = np.zeros(int(args.duration * sr), dtype=np.float32)
free_at = 0.0
for start, line in LINES:
    samples, sr_ = kokoro.create(line, voice=args.voice, speed=args.speed, lang="en-us")
    assert sr_ == sr
    if start < free_at:
        print(f"  pushed {start:.1f}s -> {free_at:.1f}s: {line}")
        start = free_at
    a = int(start * sr)
    end = min(len(track), a + len(samples))
    track[a:end] += samples[: end - a]
    free_at = start + len(samples) / sr + 0.25
    print(f"{start:5.1f}s  {len(samples) / sr:4.1f}s  {line}")
track *= 0.95 / max(1e-6, np.abs(track).max())
sf.write(args.out, track, sr)
print("wrote", args.out)
