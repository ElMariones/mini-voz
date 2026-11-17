# mini-voz

A small Spanish text-to-speech model: 4.5M parameters, 21 MB, four voices,
24 kHz. It runs over 100 times faster than real time on a CPU, and entirely
inside a web browser.

mini-voz is a Spanish adaptation of
[tiny-voca](https://github.com/n4ze3m/tiny-voca) by Muhammed Nazeem. It keeps
tiny-voca's model and training recipe and replaces the English text front end
with a Spanish one.

## Try it

**In the browser.** The demo in [`site/`](site) speaks whatever you type,
without sending the text anywhere. It also plays the same sentence at each
stage of training, from 8,000 to 104,000 steps, so you can hear the model
learn. To run it locally:

```bash
node scripts/serve_site.mjs
```

To publish it, import this repository in Vercel. [`vercel.json`](vercel.json)
already points it at `site/`; there is no build step.

**From Python.** You need [uv](https://docs.astral.sh/uv/) and
[eSpeak NG](https://github.com/espeak-ng/espeak-ng).

```bash
uv sync --extra all
```

```bash
uv run python -m mini_voz.infer --checkpoint models/mini-voz.pt --voice F1 --text "¡Hola! Esto es mini voz." --output hola.wav
```

The voices are `F1`, `F2`, `M1` and `M2`. `--speed`, `--pitch-shift` and
`--pitch-range` change the delivery. Text of any length is read sentence by
sentence. [`models/mini-voz.onnx`](models) is the same model for ONNX Runtime.

## How it was made

- **Model.** A FastSpeech-style network predicts duration, pitch and energy
  for each phoneme, and a small source-filter vocoder turns that into sound.
  Both are trained together, from scratch. See [docs/model.md](docs/model.md).
- **Text.** eSpeak NG converts Spanish text to phonemes (Castilian
  pronunciation by default). `¿` and `¡` are tokens of their own, so the model
  knows a question from its first word.
- **Data.** 27 hours of synthetic speech. Four voices were designed with
  Qwen3-TTS, which then read 7,000 public-domain sentences from Mozilla Common
  Voice. Whisper transcribed every clip, and clips that did not match their
  text were dropped.
- **Training.** 104,000 steps: 8,000 on spectral losses alone, the rest with
  adversarial training as well. About 8 hours on one consumer GPU.
- **Result.** Whisper reads the model's speech back with a 2.6% word error
  rate on sentences it never saw (a small sample of 32).

## Train your own

Prepare `data/train.jsonl`, `data/validation.jsonl` and `data/test.jsonl`,
either from your own recordings (`scripts/build_manifest.py`) or from synthetic
voices (`scripts/design_voice.py`, `scripts/build_text.py`,
`scripts/generate_audio.py`). Each script explains its options with `--help`.
Plan for about 8 hours of clean speech per voice.

Compute the features of each split (`train`, `validation`, `test`):

```bash
uv run python -m mini_voz.prepare --inputs data/train.jsonl --split train --output features --workers 12
```

Then align, train and export:

```bash
uv run python -m mini_voz.annotate --features features --output annotations
```

```bash
uv run python -m mini_voz.train --train annotations/train.jsonl --validation annotations/validation.jsonl --output runs/v1 --steps 104000 --gan-start 8000 --gan-ratio 0.7 --teacher-final 0
```

```bash
uv run python -m mini_voz.export --checkpoint runs/v1/inference.pt --output mini-voz.onnx
```

Training saves a checkpoint every 1,000 steps and continues with
`--resume runs/v1/last.pt`.

## Limits

- Spanish only, with fixed voices: no voice cloning.
- Pronunciation comes from eSpeak NG, so foreign names are read with Spanish
  rules. eSpeak NG is GPL-3.0; the browser demo ships a WebAssembly build of it
  in `site/vendor/`.
- No streaming.

## License and credits

Apache-2.0, like tiny-voca. See [LICENSE](LICENSE).

mini-voz is built on tiny-voca. If you use it, please cite the original:

```bibtex
@software{nazeem2026tinyvoca,
  author = {Nazeem, Muhammed},
  title  = {tiny-voca: a 4.5M-parameter two-voice English text-to-speech model},
  year   = {2026},
  url    = {https://huggingface.co/n4ze3m/tiny-voca}
}
```
