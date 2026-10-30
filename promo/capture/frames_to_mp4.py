"""Turns the recorder's frames (painted at uneven times) into a steady 30 fps video and prints scene times.

    python frames_to_mp4.py <out dir>     -> <out dir>/ui.mp4 and <out dir>/scenes.json
"""
import json
import os
import subprocess
import sys

out = sys.argv[1]
data = json.load(open(os.path.join(out, "frames.json")))
frames, marks = data["frames"], data["marks"]
t0 = frames[0]["t"]
lines = []
for i, f in enumerate(frames):
    nxt = frames[i + 1]["t"] if i + 1 < len(frames) else marks[-1]["t"] + 0.5
    lines += [f"file '{os.path.join(out, f['file'])}'", f"duration {max(0.001, nxt - f['t']):.4f}"]
lines.append(f"file '{os.path.join(out, frames[-1]['file'])}'")
with open(os.path.join(out, "frames.txt"), "w") as fh:
    fh.write("\n".join(lines) + "\n")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(out, "frames.txt"),
                "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
                os.path.join(out, "ui.mp4")], check=True)
scenes = {m["name"]: round(m["t"] - t0, 2) for m in marks}
json.dump(scenes, open(os.path.join(out, "scenes.json"), "w"), indent=1)
print(scenes)
