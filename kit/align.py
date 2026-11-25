"""Forced Alignment für voice-polish.mjs: bekannte Script-Wörter auf die Aufnahme legen (genauere Wortzeiten als Whisper).

Nutzung (macht voice-polish.mjs automatisch): python3 kit/align.py vo_raw.wav words.json
  words.json = {"language": "en", "words": [{"w": "What", "scene": "s1", "start": 0.3, "end": 0.5}, ...]}
Ausgabe (stdout): {"engine": "stable-ts", "words": [{"start": .., "end": ..}, ...]} in gleicher Reihenfolge und Anzahl.

Optional, eins von beiden installieren:  pip install stable-ts   oder   pip install whisperx
Ohne Paket: Exit-Code 3, voice-polish bleibt bei den Whisper-Zeiten. Modell über ALIGN_MODEL (Standard: base).
"""
import json
import os
import sys


def fail(msg, code=3):
    print(msg, file=sys.stderr)
    sys.exit(code)


def by_scene(words):
    groups, cur = [], None
    for i, w in enumerate(words):
        if not cur or cur["scene"] != w["scene"]:
            cur = {"scene": w["scene"], "idx": []}
            groups.append(cur)
        cur["idx"].append(i)
    return groups


def with_stable_ts(wav, words, lang):
    import stable_whisper  # noqa: F401  (ImportError → nächster Versuch)
    model = stable_whisper.load_model(os.environ.get("ALIGN_MODEL", "base"))
    text = " ".join(w["w"] for w in words)
    res = model.align(wav, text, language=lang)
    out = [{"start": float(x.start), "end": float(x.end)} for x in res.all_words()]
    if len(out) != len(words):
        fail(f"stable-ts: {len(out)} statt {len(words)} Wörter", 4)
    return out


def with_whisperx(wav, words, lang):
    import whisperx
    device = os.environ.get("ALIGN_DEVICE", "cpu")
    audio = whisperx.load_audio(wav)
    dur = len(audio) / 16000
    model, meta = whisperx.load_align_model(language_code=lang, device=device)
    # bekannte Absätze als Segmente vorgeben (Grenzen aus den Whisper-Zeiten, etwas Luft drum)
    segs, groups = [], by_scene(words)
    for g in groups:
        ws = [words[i] for i in g["idx"]]
        segs.append({"text": " ".join(w["w"] for w in ws), "start": max(0.0, ws[0]["start"] - 0.4), "end": min(dur, ws[-1]["end"] + 0.4)})
    res = whisperx.align(segs, model, meta, audio, device, return_char_alignments=False)
    out = []
    for g, seg in zip(groups, res["segments"]):
        ws = seg.get("words", [])
        if len(ws) != len(g["idx"]):
            fail(f"whisperx: Absatz {g['scene']} hat {len(ws)} statt {len(g['idx'])} Wörter", 4)
        for k, w in zip(g["idx"], ws):
            # Wörter ohne Zeit (Zahlen, Symbole) bekommen die Whisper-Zeit
            out.append({"start": float(w.get("start", words[k]["start"])), "end": float(w.get("end", words[k]["end"]))})
    return out


def main():
    if len(sys.argv) < 3:
        fail("Nutzung: python3 kit/align.py vo_raw.wav words.json", 2)
    wav, inp = sys.argv[1], sys.argv[2]
    data = json.load(open(inp, encoding="utf8"))
    words, lang = data["words"], data.get("language", "en")
    for name, fn in (("stable-ts", with_stable_ts), ("whisperx", with_whisperx)):
        try:
            out = fn(wav, words, lang)
        except ImportError:
            continue
        print(json.dumps({"engine": name, "words": out}))
        return
    fail("weder stable-ts noch whisperx installiert (pip install stable-ts)")


if __name__ == "__main__":
    main()
