"""Extracts the stretches of the real-app recording the pro cuts use (CV.PRO.shots in promo/render/pro_timeline.js)
as numbered JPEG frames at 30 fps, already sped up to their on-screen length.

    python shots.py <rec dir> <out dir>      -> <out dir>/<shot id>/00001.jpg ...
"""
import json
import os
import subprocess
import sys

rec, out = sys.argv[1:3]
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "..", "render", "pro_timeline.js")).read()
shots = json.loads(src[src.index("{"): src.rindex("}") + 1])["shots"]
marks = json.load(open(os.path.join(rec, "scenes.json")))
for sid, s in shots.items():
    d = os.path.join(out, sid)
    os.makedirs(d, exist_ok=True)
    speed = s["src"] / s["len"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{marks[s['mark']] + s['from']:.3f}", "-t", f"{s['src'] + 0.2:.3f}",
                    "-i", os.path.join(rec, "ui.mp4"), "-vf", f"setpts=PTS/{speed:.4f},fps=30", "-frames:v", str(round(s["len"] * 30)),
                    "-q:v", "2", os.path.join(d, "%05d.jpg")], check=True)
    print(sid, len(os.listdir(d)), "frames")
