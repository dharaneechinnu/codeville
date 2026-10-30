"""Plans the narrated launch film from its script: speaks every line with Kokoro (open-source, Apache 2.0), sizes each
scene to its narration, and writes everything the picture, music and website follow.

    python film_plan.py <rec dir> <shots dir> --model kokoro-v1.0.onnx --voices voices-v1.0.bin

Writes promo/render/film_timeline.js (scenes, captions, shots, music cues), promo/audio/pro-film-voice.wav,
site/media/launch.vtt (captions for the website), and the recorded frames each scene shows into <shots dir>.
"""
import argparse
import json
import os
import re
import subprocess

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

here = os.path.dirname(os.path.abspath(__file__))
promo = os.path.join(here, "..")

# id, chapter, "when" title or None, lines, recorded shot (mark, from, seconds of recording) or None, crop (x, y, w)
SCENES = [
    ("hook", "Hook", None, ["You asked your AI for a feature. It wrote twelve files in thirty seconds.",
                            "Do you know what it actually built?"], None, None),
    ("why", "Why", None, ["Vibe coding is fast. Reading every diff isn't.",
                          "And when something breaks, you're lost in code you didn't write."], None, None),
    ("what", "What", None, ["Meet Codeville, a desktop workspace built for vibe coders.",
                            "It turns your project into a town you can see: every feature a district, every file a block."],
     ("town", 1.0, 12.0), (0, 0, 1920)),
    ("open", "Open", "You open a project", ["Open any project, and it shows you the stack, the features, and how everything connects."],
     ("analysis", 0.2, 9.5), (360, 330, 1300)),
    ("prompt", "Prompt", "You prompt Claude Code", ["Prompt Claude Code, and watch every file land in the town, live.",
                                                     "You always know what changed."], ("chat", 2.6, 20.0), (0, 40, 1920)),
    ("test", "Test", "Your tests fail", ["When tests fail, a shopper walks your tests and stops at the one that broke, with the fix to make."],
     ("test", 2.4, 8.5), (362, 55, 1216)),
    ("ship", "Ship", "You're ready to ship", ["Ready? Commit and push, in one click."], ("git", 0.6, 9.5), (1000, 553, 920)),
    ("holo", "Hologram", "You show it off", ["And when you want to show it off, steer your code as a hologram, with your hands."],
     ("holo", 12.5, 14.0), (300, 190, 1560)),
    ("close", "Download", None, ["Codeville. See what your AI builds.", "Download it for Windows."], None, None),
]
MIN = {"hook": 5.5, "ship": 3.8, "close": 6.0}
LEAD, GAP, TAIL = 0.35, 0.3, 0.55

ap = argparse.ArgumentParser()
ap.add_argument("rec")
ap.add_argument("shots")
ap.add_argument("--model", default="kokoro-v1.0.onnx")
ap.add_argument("--voices", default="voices-v1.0.bin")
ap.add_argument("--voice", default="af_heart")
ap.add_argument("--speed", type=float, default=1.0)
args = ap.parse_args()
kokoro = Kokoro(args.model, args.voices)
marks = json.load(open(os.path.join(args.rec, "scenes.json")))

SR = 24000
clips, scenes, captions, shots, t = [], [], [], {}, 0.0
for sid, chapter, when, lines, shot, crop in SCENES:
    start, cur = t, t + LEAD
    for i, line in enumerate(lines):
        audio, sr = kokoro.create(line, voice=args.voice, speed=args.speed, lang="en-us")
        assert sr == SR
        dur = len(audio) / SR
        clips.append((cur, audio))
        # captions: one sentence (or clause after a colon) at a time, timed by length
        parts = [p for p in re.split(r"(?<=[.?!:])\s+", line) if p]
        total = sum(len(p) for p in parts)
        c = cur
        for p in parts:
            d = dur * len(p) / total
            captions.append({"start": round(c, 2), "end": round(c + d, 2), "text": p})
            c += d
        cur += dur + GAP
    end = max(cur - GAP + TAIL, start + MIN.get(sid, 0))
    entry = {"id": sid, "chapter": chapter, "when": when, "start": round(start, 2), "end": round(end, 2)}
    if shot:
        mark, frm, src = shot
        entry["shot"] = sid
        entry["crop"] = crop
        shots[sid] = {"mark": mark, "from": frm, "src": src, "len": round(end - start, 2)}
    scenes.append(entry)
    t = end
total = round(t, 2)

voice = np.zeros(int(total * SR) + SR, dtype=np.float32)
for at, audio in clips:
    a = int(at * SR)
    voice[a:a + len(audio)] += audio
voice *= 0.95 / np.abs(voice).max()
sf.write(os.path.join(promo, "audio", "pro-film-voice.wav"), voice[: int(total * SR)], SR)

by = {s["id"]: s for s in scenes}
music = {"bpm": 104, "dur": total, "drop": by["what"]["start"], "break": [by["holo"]["start"], by["close"]["start"]],
         "end": by["close"]["start"], "risers": [[by["what"]["start"] - 1.4, by["what"]["start"]], [by["close"]["start"] - 1.4, by["close"]["start"]]],
         "impacts": [by["what"]["start"], by["close"]["start"]], "whooshes": [s["start"] - 0.3 for s in scenes[3:8]]}
plan = {"total": total, "voice": args.voice, "scenes": scenes, "captions": captions, "shots": shots, "music": music}
with open(os.path.join(promo, "render", "film_timeline.js"), "w") as f:
    f.write("// Written by promo/capture/film_plan.py from the film's script: scenes sized to the narration.\nCV.FILM = "
            + json.dumps(plan, indent=1) + ";\n")


def vtt_time(x):
    return f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{x % 60:06.3f}"


os.makedirs(os.path.join(promo, "..", "site", "media"), exist_ok=True)
with open(os.path.join(promo, "..", "site", "media", "launch.vtt"), "w") as f:
    f.write("WEBVTT\n\n" + "\n".join(f"{vtt_time(c['start'])} --> {vtt_time(c['end'])}\n{c['text']}\n" for c in captions))

for sid, s in shots.items():
    d = os.path.join(args.shots, sid)
    os.makedirs(d, exist_ok=True)
    speed = s["src"] / s["len"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{marks[s['mark']] + s['from']:.3f}", "-t", f"{s['src'] + 0.3:.3f}",
                    "-i", os.path.join(args.rec, "ui.mp4"), "-vf", f"setpts=PTS/{speed:.4f},fps=30", "-frames:v", str(round(s["len"] * 30)),
                    "-q:v", "2", os.path.join(d, "%05d.jpg")], check=True)
print(json.dumps({"total": total, "scenes": [(s["id"], s["start"], s["end"]) for s in scenes]}))
