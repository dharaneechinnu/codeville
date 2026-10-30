// The pro cuts' shared plan: which stretches of the real-app recording each video uses (shots.py extracts them),
// and where the music drops, breaks and hits (music_pro.mjs), so picture and sound land on the same beats.
// Shot times are seconds after a recording mark (promo/capture/record.mjs); len is the length on screen.
CV.PRO = {
  "shots": {
    "L_town": { "mark": "town", "from": 1.0, "src": 4.3, "len": 4.3 },
    "L_chat": { "mark": "chat", "from": 2.6, "src": 17.0, "len": 4.3 },
    "L_test": { "mark": "test", "from": 2.6, "src": 5.6, "len": 2.3 },
    "L_fix": { "mark": "fix", "from": 8.9, "src": 3.2, "len": 2.0 },
    "L_holo": { "mark": "holo", "from": 13.0, "src": 9.0, "len": 4.3 },
    "S_chat": { "mark": "chat", "from": 2.6, "src": 17.0, "len": 3.0 },
    "S_test": { "mark": "test", "from": 2.6, "src": 5.6, "len": 2.6 },
    "S_holo": { "mark": "holo", "from": 13.0, "src": 7.0, "len": 2.4 }
  },
  "music": {
    "pro-launch": { "bpm": 112, "dur": 30, "drop": 5.36, "break": [21.43, 25.71], "end": 25.71,
      "risers": [[3.75, 5.36], [24.1, 25.71]], "impacts": [5.36, 25.71], "whooshes": [8.3, 12.6, 16.9, 21.15] },
    "pro-social": { "bpm": 112, "dur": 15, "drop": 1.61, "break": [8.84, 11.52], "end": 11.52,
      "risers": [[0.6, 1.61], [10.45, 11.52]], "impacts": [1.61, 11.52], "whooshes": [3.4, 6.2, 8.6] },
    "pro-demo": { "bpm": 100, "dur": 133.53, "quiet": true, "drop": 3.5, "break": [102.77, 129.03], "end": 129.03,
      "risers": [[2.2, 3.5], [127.7, 129.03]], "impacts": [3.5, 129.03],
      "whooshes": [12.42, 22.35, 43.72, 66.37, 79.41, 90.61, 102.47] }
  }
};
