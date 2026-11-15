"""Spanish front end: text -> phoneme tokens with a stress feature.

The same code runs during annotation, training-set preparation and inference,
so tokens can never drift between them.

* eSpeak NG is the only pronunciation source. It is an external rule-based
  program: no neural G2P and no downloaded weights. Spanish spelling is close
  to phonemic, so its rules are reliable. The accent is chosen with
  ``MINI_VOZ_ACCENT``: ``es`` (Castilian, the default: "z" and soft "c" are
  ``θ``) or ``es-419`` (Latin American: they are ``s``). Both use the same
  symbol inventory; a checkpoint records which one it was trained with.
* A token is one eSpeak phoneme exactly as eSpeak segments it (``--sep``), for
  example ``t``, ``ɾ``, ``tʃ`` or ``aɪ``. This is also the label inventory of
  the phoneme recogniser used for offline forced alignment, so one aligned
  label corresponds to exactly one token.
* Lexical stress is a parallel feature (0 none, 1 primary, 2 secondary), not a
  token, so it never has to be given audio frames.
* Punctuation (including the opening ``¿`` and ``¡``), word boundaries and the
  utterance edges are explicit tokens that may last zero frames. They carry
  pauses when the recording has them.

The input to eSpeak always ends with a newline: eSpeak NG 1.51 silently drops
the last character of unterminated standard input.
"""

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import unicodedata

FRONTEND_VERSION = 1
ACCENTS = ("es", "es-419")
ACCENT_VARIABLE = "MINI_VOZ_ACCENT"
ESPEAK_VARIABLE = "MINI_VOZ_ESPEAK"     # full path of espeak-ng when it is not on PATH
ESPEAK_VOICE = os.environ.get(ACCENT_VARIABLE, "es")
if ESPEAK_VOICE not in ACCENTS:
    raise ValueError(f"{ACCENT_VARIABLE} must be one of {ACCENTS}, not {ESPEAK_VOICE!r}")
SEPARATOR = "_"

PAD, BOS, EOS, SP, UNK = "<pad>", "<bos>", "<eos>", "<sp>", "<unk>"
SPECIALS = (PAD, BOS, EOS, SP, UNK)
PUNCTUATION = (",", ".", "?", "!", ";", ":", '"', "'", "(", ")", "—", "…", "¿", "¡")
CONSONANTS = ("p", "b", "t", "d", "k", "ɡ", "f", "θ", "s", "x", "ʃ", "tʃ", "m", "n", "ɲ", "ŋ", "l", "ʎ", "ɾ", "r",
              "j", "w", "β", "ð", "ɣ", "ʝ")
VOWELS = ("a", "e", "i", "o", "u", "ɛ", "aɪ", "eɪ", "oɪ", "aʊ", "eʊ")
PHONES = CONSONANTS + VOWELS
# Append-only: changing the order or removing a symbol invalidates checkpoints.
SYMBOLS = SPECIALS + PUNCTUATION + PHONES
SYMBOL_TO_ID = {symbol: index for index, symbol in enumerate(SYMBOLS)}
PHONE_SET = frozenset(PHONES)
PHONE_IDS = frozenset(SYMBOL_TO_ID[p] for p in PHONES) | {SYMBOL_TO_ID[UNK]}
VOICELESS = frozenset(("p", "t", "k", "f", "θ", "s", "x", "ʃ", "tʃ"))
VOWEL_SET = frozenset(VOWELS)
STRESS_MARKS = {"ˈ": 1, "ˌ": 2}

# eSpeak phonemes outside the inventory (loanwords, rare allophones) map to the
# closest inventory phone(s). Anything else becomes <unk> and is reported.
FALLBACK = {
    "z": ("s",), "v": ("b",), "h": ("x",), "ç": ("x",), "ɹ": ("ɾ",), "ɻ": ("ɾ",), "ʁ": ("r",), "ʀ": ("r",),
    "dʒ": ("ʝ",), "ʒ": ("ʝ",), "ɟ": ("ʝ",), "ʑ": ("ʝ",), "ɕ": ("ʃ",), "ts": ("t", "s"), "dz": ("d", "s"),
    "ɫ": ("l",), "ɬ": ("l",), "c": ("k",), "q": ("k",), "ɱ": ("m",),
    "ə": ("e",), "ɜ": ("e",), "ø": ("e",), "œ": ("e",), "æ": ("a",), "ɐ": ("a",), "ʌ": ("a",), "ɑ": ("a",), "ɒ": ("o",),
    "ɔ": ("o",), "ɪ": ("i",), "y": ("i",), "ʊ": ("u",), "ɚ": ("e", "ɾ"), "ɔɪ": ("oɪ",), "oʊ": ("o", "u"), "əʊ": ("o", "u"),
    "ɑ̃": ("a", "n"), "ɔ̃": ("o", "n"), "ɛ̃": ("e", "n"),
}

_QUOTES = str.maketrans({"‘": "'", "’": "'", "‚": "'", "‛": "'", "`": "'", "´": "'",
                         "“": '"', "”": '"', "„": '"', "‟": '"', "«": '"', "»": '"',
                         "–": "—", "―": "—", "[": "(", "{": "(", "]": ")", "}": ")"})
_PUNCTUATION_CHARS = frozenset(PUNCTUATION)
# Read as a word by eSpeak ("Sr." -> "señor"); their full stop is not a sentence mark.
ABBREVIATIONS = {"sr", "sra", "srta", "sres", "dr", "dra", "d", "dña", "ud", "uds", "vd", "vds", "prof", "etc",
                 "pág", "núm", "av", "avda", "tel", "art", "cap", "vol", "ej"}
_LANGUAGE_TAG = re.compile(r"\((?:_?[a-z0-9]_?){2,3}(?:-(?:_?[a-z0-9]_?)+)*\)")
_WINDOWS_ESPEAK = (r"C:\Program Files\eSpeak NG\espeak-ng.exe", r"C:\Program Files (x86)\eSpeak NG\espeak-ng.exe")


class NothingToPronounce(ValueError):
    """The text has no word, number or letter to say: only marks, emoji and the like."""


@dataclass(frozen=True)
class Phonemized:
    symbols: tuple
    ids: tuple
    stress: tuple
    unknown: tuple  # eSpeak phonemes that had no inventory mapping

    def __len__(self):
        return len(self.ids)


def frontend_identity():
    return {"frontend_version": FRONTEND_VERSION, "language": "es", "voice": ESPEAK_VOICE, "separator": SEPARATOR,
            "symbols": list(SYMBOLS), "fallback": {key: list(value) for key, value in sorted(FALLBACK.items())}}


def frontend_runtime():
    """What an annotation run records about the exact program behind its tokens."""
    return {"espeak_version": espeak_version()}


def frontend_fingerprint():
    return hashlib.sha256(json.dumps(frontend_identity(), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


# Written forms eSpeak would spell out letter by letter.
EXPANSIONS = (("EE. UU.", "Estados Unidos"), ("EE.UU.", "Estados Unidos"), ("EE UU", "Estados Unidos"),
              ("p. ej.", "por ejemplo"), ("a. m.", "de la mañana"), ("p. m.", "de la tarde"))


# Written forms eSpeak would spell out letter by letter.
EXPANSIONS = (("EE. UU.", "Estados Unidos"), ("EE.UU.", "Estados Unidos"), ("EE UU", "Estados Unidos"),
              ("p. ej.", "por ejemplo"), ("a. m.", "de la mañana"), ("p. m.", "de la tarde"))


# Written forms eSpeak would spell out letter by letter.
EXPANSIONS = (("EE. UU.", "Estados Unidos"), ("EE.UU.", "Estados Unidos"), ("EE UU", "Estados Unidos"),
              ("p. ej.", "por ejemplo"), ("a. m.", "de la mañana"), ("p. m.", "de la tarde"))


# Written forms eSpeak would spell out letter by letter.
EXPANSIONS = (("EE. UU.", "Estados Unidos"), ("EE.UU.", "Estados Unidos"), ("EE UU", "Estados Unidos"),
              ("p. ej.", "por ejemplo"), ("a. m.", "de la mañana"), ("p. m.", "de la tarde"))


def normalize_text(text):
    text = unicodedata.normalize("NFKC", text).translate(_QUOTES)
    for written, spoken in EXPANSIONS:
        text = text.replace(written, spoken)
    for written, spoken in EXPANSIONS:
        text = text.replace(written, spoken)
    for written, spoken in EXPANSIONS:
        text = text.replace(written, spoken)
    for written, spoken in EXPANSIONS:
        text = text.replace(written, spoken)
    text = re.sub(r"\.{3,}", "…", text)
    text = re.sub(r"-{2,}|\s-\s", "—", text)
    return re.sub(r"\s+", " ", text).strip()


def chunks(text):
    """Yield ``(is_punctuation, piece)``. Decimals, clock times, digit groups,
    apostrophes inside a word and title abbreviations stay inside the text piece
    for eSpeak; every other punctuation mark becomes its own token."""
    start = 0
    for i, char in enumerate(text):
        if char not in _PUNCTUATION_CHARS:
            continue
        previous = text[i-1] if i else ""
        following = text[i+1] if i+1 < len(text) else ""
        if char == "'" and previous.isalnum() and following.isalnum():
            continue
        if char in ".,:" and previous.isdigit() and following.isdigit():
            continue
        if char == ".":
            word = re.search(r"([^\W\d_]+)$", text[:i])
            if word and word[1].lower() in ABBREVIATIONS:
                continue
        if text[start:i].strip():
            yield False, text[start:i].strip()
        yield True, char
        start = i+1
    if text[start:].strip():
        yield False, text[start:].strip()


def espeak_executable():
    chosen = os.environ.get(ESPEAK_VARIABLE)
    if chosen:
        return chosen
    executable = shutil.which("espeak-ng")
    if executable is None:
        executable = next((path for path in _WINDOWS_ESPEAK if Path(path).is_file()), None)
    if executable is None:
        raise RuntimeError("espeak-ng was not found. macOS: brew install espeak-ng. Windows: winget install eSpeak-NG.eSpeak-NG. "
                           f"Or set {ESPEAK_VARIABLE} to the full path of the program.")
    return executable


def espeak_version():
    return subprocess.run([espeak_executable(), "--version"], capture_output=True, text=True, encoding="utf-8",
                          check=True, timeout=10).stdout.strip()


def espeak_words(piece):
    """Phonemize one text piece. Returns words as lists of ``(phone, stress)``."""
    result = subprocess.run(
        [espeak_executable(), "-q", "--ipa", "--sep=" + SEPARATOR, "-v", ESPEAK_VOICE, "--stdin"],
        input=piece.rstrip("\n") + "\n", text=True, encoding="utf-8", capture_output=True, check=True, timeout=30)
    return parse_espeak(result.stdout)


def parse_espeak(output):
    words = []
    for word in _LANGUAGE_TAG.sub("", output).split():
        units = []
        for unit in word.split(SEPARATOR):
            stress = 0
            for mark, level in STRESS_MARKS.items():
                if mark in unit:
                    stress = stress or level
                    unit = unit.replace(mark, "")
            unit = "".join(c for c in unit if unicodedata.category(c) != "Cf" and c not in "()")
            if unit:
                units.append((unit, stress))
        if units:
            words.append(units)
    return words


def canonical(phone):
    """Map an eSpeak phoneme to inventory phones; ``None`` when unknown."""
    if phone in PHONE_SET:
        return (phone,)
    if phone in FALLBACK:
        return FALLBACK[phone]
    stripped = "".join(c for c in unicodedata.normalize("NFD", phone) if not unicodedata.combining(c))
    for candidate in (stripped, stripped.replace("ː", ""), stripped + "ː"):
        if candidate != phone and candidate in PHONE_SET:
            return (candidate,)
        if candidate != phone and candidate in FALLBACK:
            return FALLBACK[candidate]
    return None


def tokenize(pieces):
    """Build the token sequence from ``(is_punctuation, value)`` pieces where a
    text piece's value is the parsed eSpeak word list. Pure function (testable
    without eSpeak)."""
    symbols, stress, unknown = [BOS], [0], []
    for punctuation, value in pieces:
        if punctuation:
            if symbols[-1] != value:  # collapse repeats such as "!!"
                symbols.append(value)
                stress.append(0)
            continue
        for word in value:
            if symbols[-1] in PHONE_SET or symbols[-1] == UNK:
                symbols.append(SP)
                stress.append(0)
            for phone, level in word:
                mapped = canonical(phone)
                if mapped is None:
                    unknown.append(phone)
                    mapped = (UNK,)
                # A fallback may expand to several phones: stress goes to its first vowel.
                carrier = next((i for i, item in enumerate(mapped) if item in VOWEL_SET), 0)
                for index, item in enumerate(mapped):
                    symbols.append(item)
                    stress.append(level if index == carrier else 0)
    symbols.append(EOS)
    stress.append(0)
    if not any(s in PHONE_SET or s == UNK for s in symbols):
        raise NothingToPronounce("the text has nothing to pronounce")
    return Phonemized(tuple(symbols), tuple(SYMBOL_TO_ID[s] for s in symbols), tuple(stress), tuple(unknown))


def phonemize(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text must not be empty")
    pieces = []
    for punctuation, piece in chunks(normalize_text(text)):
        pieces.append((True, piece) if punctuation else (False, espeak_words(piece)))
    return tokenize(pieces)


def is_phone(token_ids):
    """Boolean list/tensor helper: tokens that must be realised as audio."""
    return [int(i) in PHONE_IDS for i in token_ids]
