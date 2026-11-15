"""Turn a folder of recordings into the dataset that ``mini_voz.prepare`` reads.

One voice per run; run it once per voice with the same ``--output``.

    python scripts/build_manifest.py --voice F1 --recordings grabaciones/F1 --output data

The recordings folder holds audio files (wav, flac, mp3, m4a, ogg) and their
text, in one of two forms:

* ``metadata.csv`` with one line per clip, ``file|text`` (the LJSpeech form;
  the file name may omit its extension), or
* a ``.txt`` file next to every audio file with the same name.

Every clip is converted to 24 kHz mono FLAC, with its loudest sample at 0.95.
Clips are assigned to train, validation or test by their TEXT, so the same
sentence read by two voices lands in the same split (the training code refuses
a validation sentence that was also trained on).

Output: ``<output>/audio/<voice>/<id>.flac`` and ``<output>/{train,validation,test}.jsonl``.
A clip is skipped, with the reason in ``<output>/skipped.jsonl``, when it is
shorter than 0.6 s, longer than 30 s, silent, or has no text.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import numpy as np
import soundfile as sf

RATE = 24000
AUDIO = (".wav", ".flac", ".mp3", ".m4a", ".ogg", ".opus")
SPLITS = ("train", "validation", "test")


def clips(folder):
    """Yield ``(audio path, text)`` for every clip of the folder."""
    metadata = folder / "metadata.csv"
    if metadata.exists():
        for number, line in enumerate(metadata.read_text(encoding="utf-8-sig").splitlines(), 1):
            if not line.strip():
                continue
            if "|" not in line:
                raise ValueError(f"metadata.csv line {number}: expected file|text")
            name, text = line.split("|", 1)
            path = folder / name.strip()
            if not path.is_file():
                path = next((folder / (name.strip() + ext) for ext in AUDIO if (folder / (name.strip() + ext)).is_file()), path)
            yield path, text.split("|")[-1].strip()     # LJSpeech has a third, normalised column: use the last
        return
    for path in sorted(folder.rglob("*")):
        if path.suffix.lower() in AUDIO:
            sidecar = path.with_suffix(".txt")
            yield path, sidecar.read_text(encoding="utf-8-sig").strip() if sidecar.is_file() else ""


def split_of(text, validation, test):
    """A stable split from the sentence itself: lower case, no marks, no spaces."""
    key = re.sub(r"[\W_]+", "", text.lower())
    share = int(hashlib.sha256(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "test" if share < test else "validation" if share < test + validation else "train"


def load(path):
    import librosa
    wave, _ = librosa.load(path, sr=RATE, mono=True)        # resamples; mp3 and m4a need ffmpeg
    return wave.astype(np.float32)


def trimmed(wave, margin=0.15, below_peak_db=40):
    """Cut silence before and after the speech, keeping ``margin`` seconds."""
    import librosa
    _, (start, end) = librosa.effects.trim(wave, top_db=below_peak_db, frame_length=1024, hop_length=256)
    pad = int(margin * RATE)
    return wave[max(0, start - pad):min(len(wave), end + pad)]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--voice", required=True, help="Voice name, one of the model's speakers (F1 and M1 by default)")
    parser.add_argument("--recordings", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--validation", type=float, default=0.04, help="Share of sentences held out for validation")
    parser.add_argument("--test", type=float, default=0.03, help="Share of sentences held out for testing")
    parser.add_argument("--keep-silence", action="store_true", help="Do not cut the silence at the start and end of a clip")
    args = parser.parse_args()
    audio = args.output / "audio" / args.voice
    audio.mkdir(parents=True, exist_ok=True)
    rows, skipped, seconds = {split: [] for split in SPLITS}, [], 0.0
    for path, text in clips(args.recordings):
        identifier = f"{args.voice}_{hashlib.sha256((args.voice + '/' + path.name).encode()).hexdigest()[:16]}"
        try:
            if not text:
                raise ValueError("no text")
            if not path.is_file():
                raise ValueError("audio file not found")
            wave = load(path)
            if not args.keep_silence:
                wave = trimmed(wave)
            peak = float(np.abs(wave).max()) if len(wave) else 0.0
            if not np.isfinite(wave).all() or peak < 1e-3:
                raise ValueError("silent or invalid audio")
            duration = len(wave) / RATE
            if not 0.6 <= duration <= 30:
                raise ValueError(f"duration {duration:.1f} s is outside 0.6-30 s")
        except Exception as error:
            skipped.append({"file": str(path), "reason": f"{type(error).__name__}: {error}"})
            continue
        sf.write(audio / (identifier + ".flac"), wave * (0.95 / peak), RATE, subtype="PCM_16")
        split = split_of(text, args.validation, args.test)
        rows[split].append({"id": identifier, "text": text, "voice_id": args.voice, "split": split,
                            "audio": f"audio/{args.voice}/{identifier}.flac", "duration_seconds": round(duration, 3),
                            "origin": "recording", "source_id": path.name})
        seconds += duration
    for split in SPLITS:
        manifest = args.output / (split + ".jsonl")
        kept = []
        if manifest.exists():       # keep the other voices, replace this one
            kept = [row for row in map(json.loads, filter(str.strip, manifest.read_text(encoding="utf-8").splitlines()))
                    if row["voice_id"] != args.voice]
        manifest.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in kept + rows[split]),
                            encoding="utf-8", newline="\n")
    if skipped:
        with (args.output / "skipped.jsonl").open("a", encoding="utf-8", newline="\n") as stream:
            stream.writelines(json.dumps(row, ensure_ascii=False) + "\n" for row in skipped)
    print(json.dumps({"voice": args.voice, "hours": round(seconds / 3600, 3), "skipped": len(skipped),
                      **{split: len(rows[split]) for split in SPLITS}}))
    if not rows["validation"] or not rows["test"]:
        print("warning: validation or test is empty; annotation needs all three splits. Add clips or raise --validation/--test.")


if __name__ == "__main__":
    main()
