"""Build the list of sentences that the teacher TTS will read (``generate_audio.py``).

Sources:
* Plain text files with one Spanish sentence per line (``--sentences``). The
  Mozilla Common Voice sentence files are a good, CC0-licensed source:
  https://github.com/common-voice/common-voice/tree/main/server/data/es
* Template sentences made here (numbers, dates, money, names, questions,
  lists), so the model hears those often enough.

Every sentence passes the front end without unknown phonemes. A quarter are
questions and a tenth exclamations, because plain statements dominate any
corpus and the model needs to learn the other melodies too. Sentences are
assigned to train, validation or test by their text.

    python scripts/build_text.py --sentences frases/*.txt --count 9000 --output data/scripts.jsonl
"""

import argparse
import hashlib
import json
from pathlib import Path
import random
import re

from mini_voz.text import phonemize

OK = re.compile(r"^[¿¡]?[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ ,;¿¡\-]+[.?!]$")
NOMBRES = ("María José Carmen Antonio Lucía Manuel Sofía Javier Paula Diego Elena Pablo Marta Sergio Laura Andrés Irene Álvaro "
           "Nuria Hugo Rocío Íñigo Beatriz Guillermo Jimena Raúl Begoña Joaquín Valeria Ignacio Aitana Óscar Montserrat Enrique").split()
APELLIDOS = "García Rodríguez Fernández López Martínez Sánchez Pérez Gómez Jiménez Ruiz Muñoz Álvarez Navarro Domínguez Vázquez Ibáñez".split()
LUGARES = ["Madrid", "Sevilla", "Valencia", "Zaragoza", "Bilbao", "Málaga", "Córdoba", "Gijón", "Cádiz", "Salamanca", "Buenos Aires",
           "Ciudad de México", "Bogotá", "Lima", "Santiago", "la biblioteca", "el aeropuerto", "la farmacia", "la panadería",
           "la estación de tren"]
COSAS = ["manzanas", "pilas", "cuadernos", "entradas", "mantas", "bocadillos", "paraguas", "velas", "sillas", "postales"]
UNIDADES = ("uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho "
            "diecinueve veinte veintiuno veintidós veintitrés veinticuatro veinticinco veintiséis veintisiete veintiocho veintinueve").split()
DECENAS = "treinta cuarenta cincuenta sesenta setenta ochenta noventa".split()
CENTENAS = "ciento doscientos trescientos cuatrocientos quinientos seiscientos setecientos ochocientos novecientos".split()
MESES = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split()
DIAS = "lunes martes miércoles jueves viernes sábado domingo".split()


def numero(rng, low=1, high=999):
    """A number in words, as it is said before a masculine noun ("veintiún", "un")."""
    n = rng.randint(low, high)
    if n == 100:
        return "cien"
    words = []
    if n >= 100:
        words.append(CENTENAS[n // 100 - 1])
        n %= 100
    if n >= 30:
        words.append(DECENAS[n // 10 - 3] + (" y " + UNIDADES[n % 10 - 1] if n % 10 else ""))
    elif n:
        words.append(UNIDADES[n - 1])
    text = " ".join(words)
    return re.sub(r"veintiuno$", "veintiún", re.sub(r"\buno$", "un", text))


def hora(rng):
    hour = rng.choice(["la una", "las dos", "las tres", "las cuatro", "las cinco", "las seis", "las siete", "las ocho", "las nueve",
                       "las diez", "las once", "las doce"])
    return f"{hour} {rng.choice(['en punto', 'y cuarto', 'y media', 'menos cuarto', 'y diez', 'y veinte'])} " \
           f"{rng.choice(['de la mañana', 'de la tarde', 'de la noche'])}"


def templates(rng, count):
    nombre = lambda: rng.choice(NOMBRES)
    completo = lambda: f"{rng.choice(NOMBRES)} {rng.choice(APELLIDOS)}"
    ciudad = lambda: rng.choice(LUGARES[:15])
    lugar = lambda: rng.choice(LUGARES)
    patterns = [
        lambda: f"¡Hola, {nombre()}, bienvenido de nuevo! ¿Qué tal te ha ido el día?",
        lambda: f"{nombre()}, ¿podrías llamar a {completo()} antes de {hora(rng)}?",
        lambda: f"La reunión con {completo()} se ha pasado al {rng.choice(DIAS)}, {numero(rng, 1, 28)} de {rng.choice(MESES)}.",
        lambda: f"Cuesta {numero(rng)} euros con {numero(rng, 2, 99)} céntimos, impuestos incluidos.",
        lambda: f"Necesitamos {numero(rng, 2, 60)} {rng.choice(COSAS)}, {numero(rng, 2, 60)} {rng.choice(COSAS)} y {numero(rng, 2, 60)} {rng.choice(COSAS)}.",
        lambda: f"¿El vuelo a {ciudad()} sale a {hora(rng)}, o se ha vuelto a retrasar?",
        lambda: f"Me llamo {completo()} y vivo a unos {numero(rng, 2, 90)} kilómetros de {ciudad()}.",
        lambda: f"¿De verdad {nombre()} terminó los {numero(rng, 3, 40)} capítulos en {numero(rng, 2, 12)} días?",
        lambda: f"Por favor, trae {numero(rng, 2, 20)} {rng.choice(COSAS)} a {lugar()} antes del {rng.choice(DIAS)}.",
        lambda: f"El {numero(rng, 2, 28)} de {rng.choice(MESES)}, {nombre()} y {nombre()} viajan en coche a {ciudad()}.",
        lambda: f"¡Son {numero(rng, 101, 999)} pasos, {numero(rng, 2, 30)} arriba o abajo!",
        lambda: f"¿Quién le dijo a {nombre()} que la tienda cierra a {hora(rng)}?",
        lambda: f"Primero paramos en {lugar()}, luego en {lugar()} y por último en {lugar()}.",
        lambda: f"{completo()} sacó un {numero(rng, 40, 99)} por ciento, {numero(rng, 2, 30)} puntos más que la última vez.",
        lambda: f"Espera, ¿estás diciendo que {nombre()} se fue hace {numero(rng, 2, 50)} minutos?",
        lambda: f"Les pedí a {nombre()}, a {nombre()} y a {nombre()} que nos esperaran en {lugar()}.",
        lambda: f"La receta lleva {numero(rng, 2, 12)} tazas de harina, {numero(rng, 2, 6)} huevos y una pizca de sal.",
        lambda: f"Sinceramente, {nombre()}, ¡nunca pensé que vendrían {numero(rng, 50, 900)} personas!",
        lambda: f"¿Me recuerdas si {completo()} prefiere el {rng.choice(DIAS)} o el {rng.choice(DIAS)}?",
        lambda: f"Llovió durante {numero(rng, 2, 14)} días en {ciudad()}, así que nos quedamos en casa leyendo.",
    ]
    out = set()
    while len(out) < count:
        out.add(rng.choice(patterns)())
    return sorted(out)


def usable(line):
    line = re.sub(r"\s+", " ", line.strip())
    if not OK.match(line) or not 28 <= len(line) <= 170 or not 5 <= len(line.split()) <= 30:
        return None
    if re.search(r"\b[A-ZÁÉÍÓÚÑ]{2,}\b|--|\b[b-df-np-xz]\b", line):          # acronyms, dashes, stray single letters
        return None
    if line.count("¿") != line.count("?") or line.count("¡") != line.count("!"):
        return None
    return line


def split_of(text, validation, test):
    key = re.sub(r"[\W_]+", "", text.lower())
    share = int(hashlib.sha256(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "test" if share < test else "validation" if share < test + validation else "train"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sentences", type=Path, nargs="*", default=[], help="Text files, one sentence per line")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, default=9000, help="Sentences from the files (each is read once by every voice)")
    parser.add_argument("--template-count", type=int, default=900)
    parser.add_argument("--validation", type=float, default=0.04)
    parser.add_argument("--test", type=float, default=0.03)
    parser.add_argument("--source-license", default="cc0-1.0", help="Licence of the sentence files")
    parser.add_argument("--source-url", default="https://github.com/common-voice/common-voice/tree/main/server/data/es")
    parser.add_argument("--seed", type=int, default=20261115)
    args = parser.parse_args()
    rng = random.Random(args.seed)
    seen, rows = set(), []

    def take(lines, count, origin, url, licence, category):
        pool = sorted({s for s in (usable(l) for l in lines) if s and s.lower() not in seen})
        rng.shuffle(pool)
        quota = {"?": round(0.25 * count), "!": round(0.10 * count)}
        quota["."] = count - sum(quota.values())
        pool.sort(key=lambda s: len(s) < 45)        # longer sentences first within the shuffled order
        taken, kept = {"?": 0, "!": 0, ".": 0}, 0
        for text in pool:
            if kept == count:
                break
            if taken[text[-1]] >= quota[text[-1]]:
                continue
            try:
                phones = phonemize(text)
            except Exception:
                continue
            if phones.unknown or len(phones) > 300:
                continue
            taken[text[-1]] += 1
            seen.add(text.lower())
            identifier = hashlib.sha256(text.encode()).hexdigest()[:16]
            rows.append({"id": identifier, "text": text, "category": category, "origin": origin, "source_id": identifier,
                         "source_url": url, "source_license": licence, "split": split_of(text, args.validation, args.test),
                         "word_count": len(text.split()), "character_count": len(text)})
            kept += 1
        return kept
    lines = [line for path in args.sentences for line in path.read_text(encoding="utf-8", errors="ignore").splitlines()]
    counts = {"sentences": take(lines, args.count, "sentence_files", args.source_url, args.source_license, "reading") if lines else 0,
              "templates": take(templates(rng, args.template_count * 2), args.template_count, "mini_voz_templates",
                                "https://github.com/ElMariones/mini-voz", "project-own", "pronunciation")}
    rows.sort(key=lambda r: (r["character_count"], r["id"]))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8", newline="\n")
    characters = sum(r["character_count"] for r in rows)
    print(json.dumps({"scripts": len(rows), **counts, "questions": sum(r["text"].endswith("?") for r in rows),
                      "exclamations": sum(r["text"].endswith("!") for r in rows),
                      "by_split": {s: sum(r["split"] == s for r in rows) for s in ("train", "validation", "test")},
                      "estimated_hours_per_voice": round(characters / 15 / 3600, 1)}))


if __name__ == "__main__":
    main()
