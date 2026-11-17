"""Check that the browser demo makes the same phoneme tokens as this package.

    python scripts/check_site_frontend.py --texts data/scripts.jsonl --count 1500

Phonemizes sentences here, then runs scripts/check_site_frontend.mjs (Node),
which does the same with site/tts/frontend.js and the WebAssembly eSpeak NG and
reports every difference.
"""

import argparse
import json
from pathlib import Path
import random
import subprocess
import sys
import tempfile

from mini_voz.infer import finished, sentences, shorter
from mini_voz.text import NothingToPronounce, phonemize

HARD = [
    "¡Hola! ¿Qué tal estás?", "El Sr. García y la Dra. López llegaron a las 9:30. Luego se fueron.",
    "Cuesta 1.250,50 euros... ¡carísimo!", "EE.UU. y EE. UU. son lo mismo; p. ej. en los periódicos.",
    "«No sé», dijo ella — y se fue.", "hola", "Hola :)", "😀 !!!", "¿¿Seguro?? ¡¡Sí!!", "El software del iPhone y el hardware de Google.",
    "A las 7 a. m. o a las 8 p. m., da igual", "Llueve en Sevilla - dicen - toda la semana", "Tel. 912 345 678, pág. 12, núm. 3.",
    "Ñandú, pingüino, cigüeña y güisqui.", "D. Juan vive en la Av. de América (Madrid).", "L'Hospitalet d'Or y O'Donnell",
    "El 50% de 3,5 km son 1.75 km.", "Texto [entre corchetes] y {llaves}.", "Primera frase. segunda sin mayúscula. Tercera, sí; cuarta: no",
    "WhatsApp, YouTube, Wi-Fi y Bluetooth", "Año 1999, siglo XXI, 3º piso, 2ª planta", "pero ¿por qué? —preguntó",
    "El 16/11/2026 y el 05-03-99, pero no 1/2 ni 32/13/2020.", "Cuesta 19,99 €, 1 €, 1,01 € o €1.250,50.",
    "Vale 20$ o $3,5.", "Felipe VI, Isabel II, Siglo XXI, Alfonso XIII, Juan Pablo II y Capítulo IV.", "MAYÚSCULAS VI y Rocky II",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--texts", type=Path, help="JSON lines with a 'text' field, or plain text with one sentence per line")
    parser.add_argument("--count", type=int, default=1500)
    args = parser.parse_args()
    texts = list(HARD)
    if args.texts:
        lines = args.texts.read_text(encoding="utf-8").splitlines()
        found = [json.loads(line)["text"] if line.startswith("{") else line for line in lines if line.strip()]
        random.Random(0).shuffle(found)
        texts += found[:args.count]
        texts += [" ".join(found[i:i + 3]) for i in range(args.count, args.count + 150, 3)]     # several sentences at once
    rows = []
    for text in texts:
        try:
            phones = phonemize(text)
            phones = {"ids": list(phones.ids), "stress": list(phones.stress)}
        except NothingToPronounce:
            phones = None
        rows.append({"text": text, "phones": phones, "sentences": sentences(finished(text)), "shorter": shorter(text)})
    with tempfile.TemporaryDirectory() as scratch:
        reference = Path(scratch) / "reference.json"
        reference.write_text(json.dumps({"rows": rows}, ensure_ascii=False), encoding="utf-8")
        sys.exit(subprocess.run(["node", str(Path(__file__).with_suffix(".mjs")), str(reference)]).returncode)


if __name__ == "__main__":
    main()
