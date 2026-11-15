"""Create a reference clip for a new voice from a text description. Needs an NVIDIA GPU.

Qwen3-TTS VoiceDesign invents a voice that matches the description; no
recording of a real person is involved. Listen to the candidates, keep the one
you like, and it becomes the voice that ``generate_audio.py`` clones.

    python scripts/design_voice.py --voice F1 --output voices \\
        --describe "Mujer de unos treinta y cinco años, voz cálida y clara, acento castellano neutro, ritmo tranquilo."

Writes ``<output>/<voice>-1.wav`` ... ``-N.wav``. Then choose one:

    python scripts/design_voice.py --voice F1 --output voices --choose 2

which copies it to ``<output>/<voice>.wav`` and records it in ``<output>/voices.json``.
To use a real recording instead (your own voice, or one you have permission to
use), put 10 to 20 seconds of clean speech in ``<output>/<voice>.wav`` and run
``--choose 0 --text "exactly what the clip says"``.
"""

import argparse
import json
from pathlib import Path
import shutil

MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
TEXT = ("Hola, esta es la voz que he elegido para el proyecto. Me gusta leer despacio y con claridad, "
        "¿verdad que se entiende bien? ¡Vamos a comprobarlo con unas cuantas frases más!")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--voice", required=True, help="Voice name, for example F1 or M1")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--describe", help="The voice in words (Spanish or English)")
    parser.add_argument("--text", default=TEXT, help="What the reference clip says")
    parser.add_argument("--candidates", type=int, default=4)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--choose", type=int, help="Keep candidate N as the voice's reference (0: <voice>.wav is already there)")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    reference, index = args.output / f"{args.voice}.wav", args.output / "voices.json"
    if args.choose is not None:
        if args.choose:
            shutil.copyfile(args.output / f"{args.voice}-{args.choose}.wav", reference)
        if not reference.is_file():
            parser.error(f"{reference} does not exist")
        voices = json.loads(index.read_text(encoding="utf-8")) if index.exists() else {}
        voices[args.voice] = {"audio": reference.name, "text": args.text}
        index.write_text(json.dumps(voices, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"{args.voice}: {reference} recorded in {index}")
        return
    if not args.describe:
        parser.error("--describe is needed to design a voice")
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel
    model = Qwen3TTSModel.from_pretrained(MODEL, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    for number in range(1, args.candidates + 1):
        torch.manual_seed(args.seed + number)
        waves, rate = model.generate_voice_design(text=args.text, instruct=args.describe, language="Spanish")
        path = args.output / f"{args.voice}-{number}.wav"
        sf.write(path, waves[0], rate)
        print(path)
    print(f"Listen to them, then: python scripts/design_voice.py --voice {args.voice} --output {args.output} --choose N")


if __name__ == "__main__":
    main()
