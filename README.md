# mini-voz

mini-voz is a small Spanish text-to-speech model: 4.5M parameters, 18 MB, fast
enough to run on a CPU. It is trained from scratch on your own data.

It is a Spanish adaptation of [tiny-voca](https://github.com/n4ze3m/tiny-voca)
by Muhammed Nazeem: same model and training recipe, a Spanish text front end,
and a pipeline that runs on Windows, macOS and Linux.

**Status: a first model is trained** (104,000 steps, four synthetic voices, 27
hours of audio, about 8 hours on an RTX 4070 Ti SUPER). The weights are in
[`models/`](models) (`mini-voz.pt` for PyTorch, `mini-voz.onnx` for ONNX
Runtime), and you can train your own with the steps below.
Figures marked "tiny-voca" are those of the original English model, which has
the same architecture.

## Features

- **Small**: 4,533,451 parameters, waveform generator included.
- **Fast**: tiny-voca runs about 70x real time on four CPU threads.
- **Spanish**: Castilian (`es`, the default) or Latin American (`es-419`)
  pronunciation. `¿` and `¡` are tokens, so the model knows a question from its
  first word.
- **Four voices** by default: two female (`F1`, `F2`) and two male (`M1`, `M2`), 24 kHz. Names and count are configurable.
- **Runs anywhere**: PyTorch and ONNX Runtime.

## Which machine to train on

| Machine | Device | Training time |
|---|---|---|
| PC with an NVIDIA GPU | `cuda` | tiny-voca took 7.7 h on an RTX 4090. An RTX 4070 Ti SUPER should need roughly 11 to 13 h (estimate, not measured). |
| MacBook Pro (Apple Silicon) | `mps` | Supported in the code but **not tested**, and expected to be several times slower. |

Use the NVIDIA PC for training. Making synthetic training audio (route B
below) also needs the NVIDIA GPU. The Mac is fine for everything else:
preparing recordings, speaking with a trained model, running tests.

Every command picks the device by itself (`--device auto`).

## Install

You need [uv](https://docs.astral.sh/uv/), eSpeak NG and ffmpeg.

Windows:

```bash
winget install eSpeak-NG.eSpeak-NG
```

macOS:

```bash
brew install espeak-ng ffmpeg
```

Then, on either:

```bash
git clone https://github.com/ElMariones/mini-voz.git
```

```bash
cd mini-voz
```

```bash
uv sync --extra all
```

`uv sync` creates `.venv` with Python 3.11 and the right PyTorch build (CUDA
on Windows and Linux, MPS on macOS). Run commands with `uv run`.

On a Mac, also set this once per terminal, so operations the Apple GPU lacks
fall back to the CPU:

```bash
export PYTORCH_ENABLE_MPS_FALLBACK=1
```

For Latin American pronunciation, set `MINI_VOZ_ACCENT=es-419` for **every**
step: annotation, training and speaking must agree.

## Data

The model needs about 8 to 10 hours of clean speech per voice, with the exact
text of every clip. tiny-voca used 17.6 hours for two voices. There are two
ways to get it.

### Route A: your own recordings

Put the clips of one voice in a folder, with a `metadata.csv` of `file|text`
lines (or a `.txt` next to every audio file):

```
grabaciones/F1/metadata.csv
grabaciones/F1/clip0001.wav
grabaciones/F1/clip0002.wav
```

```
clip0001|¿Has visto dónde dejé las llaves del coche?
clip0002|El tren a Zaragoza sale a las nueve y media.
```

One sentence per clip, 1 to 20 seconds, one speaker, the same microphone and
room throughout, no music or noise. Any sample rate and format: it is
converted to 24 kHz mono.

```bash
uv run python scripts/build_manifest.py --voice F1 --recordings grabaciones/F1 --output data
```

Run it again with `--voice F2`, `M1` and `M2` for the other voices.

### Route B: synthetic voices (what tiny-voca did)

No recording of a real person. A large TTS model (Qwen3-TTS) invents a voice
from a description, or clones a 10 to 20 second reference clip, and reads
thousands of sentences. It needs the NVIDIA GPU and
`uv sync --extra all --extra synthetic`.

```bash
uv run python scripts/design_voice.py --voice F1 --output voices --describe "Mujer de unos treinta y cinco años, voz cálida y clara, acento castellano neutro."
```

```bash
uv run python scripts/design_voice.py --voice F1 --output voices --choose 2
```

```bash
uv run python scripts/build_text.py --sentences frases/*.txt --count 9000 --output data/scripts.jsonl
```

```bash
uv run python scripts/generate_audio.py --scripts data/scripts.jsonl --voices voices/voices.json --root data
```

`frases/*.txt` are plain text files with one Spanish sentence per line, for
example the CC0 sentence files of
[Mozilla Common Voice](https://github.com/common-voice/common-voice/tree/main/server/data/es).
To clone a real voice instead of designing one, see the notes at the top of
`scripts/design_voice.py`. Only clone a voice you have permission to use.

Notes from running this route on an RTX 4070 Ti SUPER:

- Designed voices speak with seseo ("z" sounds like "s") whatever the
  description says. The cloning step follows the accent of the reference clip.
- Four voices and 7,173 sentences took about 10 hours and gave 29 hours of
  accepted audio. Close other programs that use the GPU first: if its memory
  fills up, generation runs ten times slower.
- To pause, create a file named `data/STOP`. Delete it and run the same
  command again to continue.

## Training

Both routes leave `data/train.jsonl`, `data/validation.jsonl` and
`data/test.jsonl`. From there:

```bash
uv run python -m mini_voz.prepare --inputs data/train.jsonl --split train --output features --workers 12
```

```bash
uv run python -m mini_voz.prepare --inputs data/validation.jsonl --split validation --output features
```

```bash
uv run python -m mini_voz.prepare --inputs data/test.jsonl --split test --output features
```

```bash
uv run python -m mini_voz.annotate --features features --output annotations
```

```bash
uv run python -m mini_voz.train --train annotations/train.jsonl --validation annotations/validation.jsonl --output runs/v1 --steps 104000 --gan-start 8000 --gan-ratio 0.7 --teacher-final 0
```

```bash
uv run python -m mini_voz.evaluate --checkpoint runs/v1/inference.pt --annotations annotations --output eval/v1
```

- `prepare` computes the spectrogram and pitch of every clip. It runs on the
  CPU and the pitch tracker takes a few seconds per clip, so give the training
  split most of your cores with `--workers`: 25,000 clips took about an hour
  and a half on ten.
- `annotate` finds how long every phoneme lasts with a pretrained recogniser
  (downloaded once, 1.2 GB) and rejects clips whose audio and text do not
  match. Read `annotations/summary.json` before training.
- `train` saves `runs/v1/last.pt` every 1,000 steps. To stop it cleanly, pass
  `--stop-file runs/STOP` and create that file. Continue with the same command
  plus `--resume runs/v1/last.pt`. `runs/v1/inference.pt` is the model to
  speak with.

To use other voice names or a different number of voices, pass a JSON file
with the full configuration to every step with `--config`. `config.json` in
any run folder has the form.

## How it improves while training

The same text, spoken by every saved checkpoint of the first run
(`runs/v1`, 104,000 steps). The text is: "¡Hola! Esto es mini voz, un
modelo de voz pequeño que funciona en cualquier ordenador. ¿Qué tal suena? El
tren a Zaragoza sale a las nueve y media, y hoy llueve en Valencia."

| Step | F1 | F2 | M1 | M2 |
|---|---|---|---|---|
| 8,000 (before the adversarial phase) | [F1](docs/samples/008000/F1.mp3) | [F2](docs/samples/008000/F2.mp3) | [M1](docs/samples/008000/M1.mp3) | [M2](docs/samples/008000/M2.mp3) |
| 10,000 | [F1](docs/samples/010000/F1.mp3) | [F2](docs/samples/010000/F2.mp3) | [M1](docs/samples/010000/M1.mp3) | [M2](docs/samples/010000/M2.mp3) |
| 20,000 | [F1](docs/samples/020000/F1.mp3) | [F2](docs/samples/020000/F2.mp3) | [M1](docs/samples/020000/M1.mp3) | [M2](docs/samples/020000/M2.mp3) |
| 30,000 | [F1](docs/samples/030000/F1.mp3) | [F2](docs/samples/030000/F2.mp3) | [M1](docs/samples/030000/M1.mp3) | [M2](docs/samples/030000/M2.mp3) |
| 40,000 | [F1](docs/samples/040000/F1.mp3) | [F2](docs/samples/040000/F2.mp3) | [M1](docs/samples/040000/M1.mp3) | [M2](docs/samples/040000/M2.mp3) |
| 50,000 | [F1](docs/samples/050000/F1.mp3) | [F2](docs/samples/050000/F2.mp3) | [M1](docs/samples/050000/M1.mp3) | [M2](docs/samples/050000/M2.mp3) |
| 60,000 | [F1](docs/samples/060000/F1.mp3) | [F2](docs/samples/060000/F2.mp3) | [M1](docs/samples/060000/M1.mp3) | [M2](docs/samples/060000/M2.mp3) |
| 70,000 | [F1](docs/samples/070000/F1.mp3) | [F2](docs/samples/070000/F2.mp3) | [M1](docs/samples/070000/M1.mp3) | [M2](docs/samples/070000/M2.mp3) |
| 80,000 | [F1](docs/samples/080000/F1.mp3) | [F2](docs/samples/080000/F2.mp3) | [M1](docs/samples/080000/M1.mp3) | [M2](docs/samples/080000/M2.mp3) |
| 90,000 | [F1](docs/samples/090000/F1.mp3) | [F2](docs/samples/090000/F2.mp3) | [M1](docs/samples/090000/M1.mp3) | [M2](docs/samples/090000/M2.mp3) |
| 100,000 | [F1](docs/samples/100000/F1.mp3) | [F2](docs/samples/100000/F2.mp3) | [M1](docs/samples/100000/M1.mp3) | [M2](docs/samples/100000/M2.mp3) |
| 104,000 (final) | [F1](docs/samples/final/F1.mp3) | [F2](docs/samples/final/F2.mp3) | [M1](docs/samples/final/M1.mp3) | [M2](docs/samples/final/M2.mp3) |

`scripts/make_samples.py` makes them from the saved checkpoints
(`python scripts/make_samples.py --run runs/v1 --output docs/samples`).

### Results of the first run

Speech recognition (faster-whisper `small`) reads the model's speech back with a
word error rate of 2.6% on 32 sentences it never saw in training (8 per voice),
and 4.1% on 16 test-split sentences, where the recordings themselves score 2.5%.
Speed on four CPU threads: 100 to 146 times faster than real time with ONNX
Runtime (`scripts/check_onnx.py`). The model is 4,534,219 parameters; the ONNX
file is 21 MB. These come from small samples, so read them as a rough guide.

## Usage

```bash
uv run python -m mini_voz.infer --checkpoint runs/v1/inference.pt --voice F1 --text "¡Hola! Esto es mini voz." --output hola.wav
```

| Option | Default | Meaning |
|---|---|---|
| `--text-file` | | Read the text from a file instead of `--text` |
| `--voice` | the first voice | One of the voices the model was trained with |
| `--speed` | 1.0 | Speaking rate |
| `--pitch-shift` | 0 | Raise or lower the pitch |
| `--pitch-range` | 1.0 | More or less pitch movement |

Long text is fine. It is read one sentence at a time and the audio is joined.
A text that ends without a mark gets a full stop. Numbers, times and common
abbreviations (`Sr.`, `Dra.`, `EE.UU.`) are read out by eSpeak NG. In Python,
`mini_voz.infer.speak_text` does the same.

## ONNX

```bash
uv run python -m mini_voz.export --checkpoint runs/v1/inference.pt --output mini-voz.onnx
```

## Tests

Windows (Git Bash):

```bash
PYTHONPATH="src;tests" uv run python -m unittest discover -s tests
```

macOS and Linux:

```bash
PYTHONPATH=src:tests uv run python -m unittest discover -s tests
```

## Limits

- Spanish only. Fixed voices. No voice cloning at inference time.
- Pronunciation comes from eSpeak NG, so foreign names are read with Spanish
  rules, and eSpeak NG (GPL-3.0) must be installed wherever the model speaks.
- No browser demo: tiny-voca's demo depends on an English-only phonemizer and
  was removed.
- No streaming.

## Changes from tiny-voca

- Package renamed to `mini_voz`. Spanish phoneme inventory (56 symbols) and
  text handling. The English `dizione` front end and the web demo are removed.
- Automatic device choice (CUDA, MPS, CPU). Windows support: file locking,
  UTF-8 everywhere, eSpeak NG found in its default install folder.
- New `scripts/build_manifest.py`, `scripts/build_text.py` and
  `scripts/design_voice.py`. `scripts/generate_audio.py` adapted to Spanish.
- Training has no time limit by default (it was one hour per run).

More about the model is in [docs/model.md](docs/model.md).

## License

Apache-2.0, like tiny-voca. See [LICENSE](LICENSE).

## Credits

mini-voz is built on tiny-voca. If you use it, please cite the original:

```bibtex
@software{nazeem2026tinyvoca,
  author = {Nazeem, Muhammed},
  title  = {tiny-voca: a 4.5M-parameter two-voice English text-to-speech model},
  year   = {2026},
  url    = {https://huggingface.co/n4ze3m/tiny-voca}
}
```
