"""Edits the real-UI recording into the demo and writes the timeline the overlays, music and voice follow.

    python compose.py <rec dir>        -> <rec dir>/ui_edit.mp4, promo/render/real_timeline.js, promo/render/real_voice.json

Each scene is a stretch of the recording (between its mark and the next), trimmed and optionally sped up.
"""
import json
import os
import subprocess
import sys

rec = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
render = os.path.join(here, "..", "render")
marks = json.load(open(os.path.join(rec, "scenes.json")))
INTRO, OUTRO = 3.5, 4.5

# key, title, subtitle, trim start/end inside the scene (seconds), speed, footnote,
# and the part of the window to zoom into (x, y, width; 16:9), or None for the whole window
SCENES = [
    ("welcome", "FIRST RUN", "The real app: it checks your setup, then opens your project", 0.4, 0.0, 1.0, "", (420, 236, 1080)),
    ("analysis", "PROJECT ANALYSIS", "An agent reads the stack, the layers, every feature and its links", 0.0, 1.8, 1.0, "", (360, 330, 1300)),
    ("town", "BLOCK TOWN", "Your prompts, made visual: a district per feature, a block per file", 0.0, 0.0, 1.6, "", None),
    ("chat", "PROMPT IT", "Claude Code writes a wishlist feature. Every file lands live.", 0.0, 0.0, 1.25, "Agent steps scripted for this recording", None),
    ("test", "TEST VIEW", "A shopper walks all 8 tests and stops at the broken one", 0.0, 0.0, 1.0, "", (362, 55, 1216)),
    ("fix", "PROMPT THE FIX", "“fix the cart total”, and all 8 tests pass", 0.0, 0.0, 1.3, "Agent steps scripted for this recording", None),
    ("git", "SHIP IT", "Stage, commit and push to origin/main in one click", 0.3, 0.0, 1.0, "", (1000, 553, 920)),
    ("holo", "HOLOGRAM MODE", "Turn on the camera: turn, zoom, hold and reset with your hands", 0.3, 0.0, 1.1, "Hand input simulated for this recording", (300, 190, 1560)),
]


def zoom(region, dur):
    """Eases into the region over 0.9 s, holds, and eases back to the whole window in the last 0.6 s."""
    if not region:
        return ""
    rx, ry, rw = region
    e = f"(st(0,clip(min(t/0.9,({dur:.3f}-t)/0.6),0,1))*0+ld(0)*ld(0)*(3-2*ld(0)))"
    z = f"(1920/(1920-{1920 - rw}*{e}))"
    return (f",scale=w='2*trunc(960*{z})':h='2*trunc(540*{z})':eval=frame:flags=bicubic"
            f",crop=1920:1080:x='{rx}*{e}*{z}':y='{ry}*{e}*{z}'")


order = ["welcome", "analysis", "town", "chat", "test", "fix", "git", "holo", "end"]

parts, timeline, t = [], [], INTRO
split = f"[0:v]split={len(SCENES)}" + "".join(f"[s{i}]" for i in range(len(SCENES)))
parts.append(split)
for i, (key, title, sub, a, b, speed, note, region) in enumerate(SCENES):
    s0 = max(0.0, marks[key]) + a
    s1 = marks[order[order.index(key) + 1]] - b
    dur = (s1 - s0) / speed
    parts.append(f"[s{i}]trim=start={s0:.3f}:end={s1:.3f},setpts=(PTS-STARTPTS)/{speed}{zoom(region, dur)}[v{i}]")
    timeline.append({"key": key, "num": f"{i + 1:02d}", "title": title, "sub": sub, "start": round(t, 3), "end": round(t + dur, 3), "speed": speed, "note": note})
    t += dur
ui_end = t
total = round(ui_end + OUTRO, 3)
graph = ";".join(parts) + ";" + "".join(f"[v{i}]" for i in range(len(SCENES))) + f"concat=n={len(SCENES)}:v=1:a=0,fps=30[out]"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(rec, "ui.mp4"), "-filter_complex", graph, "-map", "[out]",
                "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", os.path.join(rec, "ui_edit.mp4")], check=True)

info = {"intro": INTRO, "uiEnd": round(ui_end, 3), "total": total, "scenes": timeline}
with open(os.path.join(render, "real_timeline.js"), "w") as f:
    f.write("// Written by promo/capture/compose.py: when each scene of the real-UI demo starts and ends.\nCV.REAL = " + json.dumps(info, indent=1) + ";\n")

at = {s["key"]: s["start"] for s in timeline}
V = [
    (0.4, "Codeville. Built for vibe coders."),
    (at["welcome"] + 0.5, "This is the real Codeville app. It checks Git, Claude Code and Node, then you open your project."),
    (at["analysis"] + 0.4, "An analysis agent reads it: the stack, the layers, every feature, and how they connect."),
    (at["town"] + 0.4, "Your prompts, made visual. Each feature is a district, and every file is a block."),
    (at["town"] + 8.0, "Pick a file, and the town shows where it lives. Open it right in the editor."),
    (at["town"] + 15.0, "Links show how the parts talk to each other."),
    (at["chat"] + 0.4, "Now, just prompt. Ask Claude Code for a wishlist feature..."),
    (at["chat"] + 9.5, "and watch every file it writes land in your project, live, with its tests."),
    (at["test"] + 0.4, "Run the tests, and a shopper walks every case."),
    (at["test"] + 6.5, "It stops at the broken one, and tells you what to fix next."),
    (at["fix"] + 0.4, "So ask Claude to fix it. All eight tests pass."),
    (at["git"] + 0.4, "Then ship it. Stage, commit and push, in one click."),
    (at["holo"] + 0.4, "And the fun part. Turn on your camera, and your code becomes a hologram, like Tony Stark's lab."),
    (at["holo"] + 10.6, "Spread two hands to zoom, make a fist to hold, and pinch twice to reset."),
    (ui_end + 0.4, "Codeville. Vibe code. See it build."),
]
json.dump({"duration": total, "lines": V}, open(os.path.join(render, "real_voice.json"), "w"), indent=1)
print(json.dumps({"total": total, "scenes": [(s["key"], s["start"], s["end"]) for s in timeline]}))

# The launch ad's 12-26 s window shows the same recording, faster: the live build, the test run, the hologram.
LAUNCH = [("chat", 1.0, 23.0, None), ("test", 2.0, 14.0, (362, 55, 1216)), ("holo", 9.0, 17.0, (300, 190, 1560))]
LAUNCH_LEN = [5.0, 5.0, 4.0]
parts = [f"[0:v]split={len(LAUNCH)}" + "".join(f"[s{i}]" for i in range(len(LAUNCH)))]
for i, ((key, a, b, region), length) in enumerate(zip(LAUNCH, LAUNCH_LEN)):
    s0, s1 = marks[key] + a, marks[key] + b
    speed = (s1 - s0) / length
    parts.append(f"[s{i}]trim=start={s0:.3f}:end={s1:.3f},setpts=(PTS-STARTPTS)/{speed:.4f}{zoom(region, length)}[v{i}]")
graph = ";".join(parts) + ";" + "".join(f"[v{i}]" for i in range(len(LAUNCH))) + f"concat=n={len(LAUNCH)}:v=1:a=0,fps=30[out]"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(rec, "ui.mp4"), "-filter_complex", graph, "-map", "[out]",
                "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", os.path.join(rec, "launch_ui.mp4")], check=True)
print("launch clip:", sum(LAUNCH_LEN), "s")
