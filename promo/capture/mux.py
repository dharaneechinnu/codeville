"""Lays the edited real-UI recording into the frame video and mixes music and voice into the final demo.

    python mux.py <rec dir> <frame.mp4> <out.mp4>            the demo
    python mux.py <rec dir> <frame.mp4> <out.mp4> launch     the launch ad (keeps the frame video's own audio)
    python mux.py <rec dir> <frame.mp4> <out.mp4> pro        the pro demo (the recording in the monitor of pro.js)
"""
import json
import os
import subprocess
import sys

rec, frame, out = sys.argv[1:4]
if sys.argv[4:] == ["launch"]:
    graph = "[1:v]scale=1376:774:flags=lanczos,setpts=PTS+12/TB[ui];[0:v][ui]overlay=272:236:enable='between(t,12,25.98)':eof_action=pass[v]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", frame, "-i", os.path.join(rec, "launch_ui.mp4"), "-filter_complex", graph,
                    "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p",
                    "-c:a", "copy", "-movflags", "+faststart", out], check=True)
    print("wrote", out)
    sys.exit(0)
pro = sys.argv[4:] == ["pro"]
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "..", "render", "real_timeline.js")).read()
R = json.loads(src[src.index("{"): src.rindex("}") + 1])
audio = os.path.join(here, "..", "audio")
graph = (
    (f"[1:v]scale=1520:855:flags=lanczos,setpts=PTS+{R['intro']}/TB[ui];[0:v][ui]overlay=200:168:enable=" if pro else
     f"[1:v]scale=1600:900:flags=lanczos,setpts=PTS+{R['intro']}/TB[ui];[0:v][ui]overlay=160:160:enable=")
    + f"'between(t,{R['intro']},{R['uiEnd'] - 0.02})':eof_action=pass[v];"
    "[3:a]aresample=44100,pan=stereo|c0=c0|c1=c0,asplit=2[vo][sc];"
    "[2:a][sc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=450[m];"
    "[m][vo]amix=inputs=2:normalize=0:weights=0.7 1.0,alimiter=limit=0.95[a]"
)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", frame, "-i", os.path.join(rec, "ui_edit.mp4"),
                "-i", os.path.join(audio, "pro-demo.wav" if pro else "real.wav"), "-i", os.path.join(audio, "real-voice.wav"),
                "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "22",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", str(R["total"]), "-movflags", "+faststart", out], check=True)
print("wrote", out)
