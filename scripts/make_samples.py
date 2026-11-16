"""Speak the same text with every saved checkpoint of a run, to hear the model improve.

    python scripts/make_samples.py --run runs/v1 --output docs/samples

For each ``step-*.pt`` (and ``inference.pt`` as "final") it writes
``<output>/<step>/<voice>.mp3`` for every voice. Existing files are kept, so it
can be run again while training goes on and only the new checkpoints are
spoken. Needs ffmpeg for the MP3s (small enough to commit).
"""

import argparse
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import soundfile as sf
import torch

from mini_voz.config import Config
from mini_voz.infer import limit_peak, speak_text
from mini_voz.model import MiniVoz
from mini_voz.train import export_model

TEXT = ("¡Hola! Esto es mini voz, un modelo de voz pequeño que funciona en cualquier ordenador. "
        "¿Qué tal suena? El tren a Zaragoza sale a las nueve y media, y hoy llueve en Valencia.")


def load(path):
    """An inference model from a training checkpoint (step-*.pt) or an exported one (inference.pt)."""
    state = torch.load(path, map_location="cpu", weights_only=True)
    model = MiniVoz(Config.from_dict(state["config"]))
    if "system" in state:
        weights = {k.removeprefix("model."): v for k, v in state["system"].items() if k.startswith("model.")}
    else:
        weights = state["model"]
    model.load_state_dict(weights, strict=True)
    return model.eval(), state.get("step")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", type=Path, required=True, help="Training output folder, for example runs/v1")
    parser.add_argument("--output", type=Path, default=Path("docs/samples"))
    parser.add_argument("--text", default=TEXT)
    parser.add_argument("--final", action="store_true", help="Also speak inference.pt, named 'final'")
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        parser.error("ffmpeg is needed to write the MP3 files")
    jobs = []
    for path in sorted(args.run.glob("step-*.pt")):
        step = int(re.search(r"step-(\d+)", path.name).group(1))
        jobs.append((f"{step:06d}", path))
    if args.final:
        jobs.append(("final", args.run / "inference.pt"))
    for name, path in jobs:
        folder = args.output / name
        model, saved_step = load(path)
        todo = [v for v in model.config.speakers if not (folder / f"{v}.mp3").exists()]
        for voice in todo:
            wave, _ = speak_text(model, args.text, voice, peak=None)
            wave = limit_peak(wave)
            folder.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory() as scratch:
                wav = Path(scratch) / "x.wav"
                sf.write(wav, wave.numpy(), model.config.sample_rate, subtype="PCM_16")
                subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(wav), "-b:a", "64k", str(folder / f"{voice}.mp3")], check=True)
            print(f"{name} (step {saved_step}) {voice}", flush=True)
    print("done")


if __name__ == "__main__":
    main()
