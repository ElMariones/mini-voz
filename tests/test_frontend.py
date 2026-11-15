import unittest
from unittest.mock import patch

from mini_voz import text
from mini_voz.config import Config
from mini_voz.text import (BOS, EOS, PHONE_SET, PHONES, SP, SYMBOLS, SYMBOL_TO_ID, UNK, canonical, chunks, frontend_fingerprint,
                            normalize_text, parse_espeak, phonemize, tokenize)

try:
    text.espeak_executable()
    ESPEAK = True
except RuntimeError:
    ESPEAK = False


class FrontEndTests(unittest.TestCase):
    def test_inventory_is_consistent_with_the_model_vocabulary(self):
        self.assertEqual(len(SYMBOLS), len(set(SYMBOLS)))
        self.assertEqual(Config().vocab_size, len(SYMBOLS))
        self.assertEqual(SYMBOL_TO_ID["<pad>"], 0)
        self.assertEqual(len(PHONES), 37)
        self.assertIn("¿", SYMBOLS)
        self.assertIn("¡", SYMBOLS)
        with self.assertRaises(ValueError):
            Config(vocab_size=259)

    def test_chunks_keep_numbers_and_abbreviations(self):
        pieces = list(chunks(normalize_text("¿El Dr. Pérez pagó 3,14 a las 3:45 por 1.000 días en EE.UU., verdad?")))
        self.assertEqual([p for punctuation, p in pieces if punctuation], ["¿", ",", "?"])
        self.assertIn("El Dr. Pérez pagó 3,14 a las 3:45 por 1.000 días en Estados Unidos", pieces[1][1])
        self.assertEqual(normalize_text("«Espera…»  dijo -- ‘no’ [aparte]..."), '"Espera…" dijo — \'no\' (aparte)…')
        # A dot between letters is a mark, not something to spell out as "punto".
        self.assertEqual([p for punctuation, p in chunks("a.b") if punctuation], ["."])

    def test_separated_espeak_output_becomes_phones_with_stress_features(self):
        words = parse_espeak("ˈo_l_a m_ˈu_n_d_o\nθ_ˌe_n e_s__\n")
        self.assertEqual(words[0], [("o", 1), ("l", 0), ("a", 0)])
        self.assertEqual(words[2], [("θ", 0), ("e", 2), ("n", 0)])
        self.assertEqual(words[3], [("e", 0), ("s", 0)])               # empty units are dropped
        result = tokenize([(True, "¿"), (False, words[:2]), (True, ","), (True, ","), (False, words[2:]), (True, "?")])
        self.assertEqual(result.symbols, (BOS, "¿", "o", "l", "a", SP, "m", "u", "n", "d", "o", ",", "θ", "e", "n", SP, "e", "s", "?", EOS))
        self.assertEqual(result.stress, (0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0))
        self.assertEqual(result.ids, tuple(SYMBOL_TO_ID[s] for s in result.symbols))
        self.assertTrue(all(s in PHONE_SET or s in SYMBOLS for s in result.symbols))
        # Stress is never a token, so nothing but phones, pauses and punctuation needs frames.
        self.assertNotIn("ˈ", "".join(result.symbols))

    def test_out_of_inventory_phones_fall_back_or_are_reported(self):
        self.assertEqual(canonical("z"), ("s",))
        self.assertEqual(canonical("pː"), ("p",))
        self.assertEqual(canonical("ɑ̃"), ("a", "n"))
        self.assertIsNone(canonical("ʘ"))
        result = tokenize([(False, [[("ts", 0), ("ʘ", 0), ("ɚ", 1)]])])
        self.assertEqual(result.symbols, (BOS, "t", "s", UNK, "e", "ɾ", EOS))
        self.assertEqual(result.stress, (0, 0, 0, 0, 1, 0, 0))
        self.assertEqual(result.unknown, ("ʘ",))
        with self.assertRaises(ValueError):
            tokenize([(True, ".")])

    def test_fingerprint_tracks_inventory_version_and_accent(self):
        baseline = frontend_fingerprint()
        with patch.object(text, "FRONTEND_VERSION", 999):
            self.assertNotEqual(frontend_fingerprint(), baseline)
        with patch.object(text, "SYMBOLS", SYMBOLS + ("new",)):
            self.assertNotEqual(frontend_fingerprint(), baseline)
        with patch.object(text, "ESPEAK_VOICE", "es-419" if text.ESPEAK_VOICE == "es" else "es"):
            self.assertNotEqual(frontend_fingerprint(), baseline)

    @unittest.skipUnless(ESPEAK, "requires the espeak-ng executable")
    def test_real_espeak_keeps_the_last_phoneme_of_every_clause(self):
        # Regression: without a final newline eSpeak NG 1.51 drops the last character.
        self.assertEqual(phonemize("los labios del rey").symbols[-3:], ("r", "eɪ", EOS))
        self.assertEqual(phonemize("Hola").symbols[1:-1], ("o", "l", "a"))
        self.assertEqual(phonemize("niño").symbols[1:-1], ("n", "i", "ɲ", "o"))          # UTF-8 reaches eSpeak intact
        result = phonemize("¡Elige, corre! ¿Es un déjà vu?")
        self.assertEqual([s for s in result.symbols if s in "¡,!¿?"], ["¡", ",", "!", "¿", "?"])
        self.assertEqual(result.unknown, ())
        self.assertNotEqual(phonemize("Lo hiciste.").ids, phonemize("¿Lo hiciste?").ids)
        self.assertEqual(phonemize("Lo hiciste.").ids, phonemize(" Lo  hiciste. ").ids)
        self.assertEqual(sum(phonemize("canción").stress), 1)                             # one primary stress

    @unittest.skipUnless(ESPEAK, "requires the espeak-ng executable")
    def test_real_espeak_units_are_inventory_phones(self):
        sample = ("El veloz murciélago hindú comía feliz cardillo y kiwi; la cigüeña tocaba el saxofón detrás del palenque de paja. "
                  "El Dr. Gómez pagó 3,14 euros por el coche cerca de Zaragoza, ¡y la guía oyó llover en la calle!")
        result = phonemize(sample)
        self.assertEqual(result.unknown, ())
        self.assertGreater(len(set(result.symbols) & PHONE_SET), 25)
        self.assertEqual(sum(result.stress[i] > 0 and s not in PHONE_SET for i, s in enumerate(result.symbols)), 0)

    @unittest.skipUnless(ESPEAK and text.ESPEAK_VOICE == "es", "requires espeak-ng and the Castilian accent")
    def test_castilian_distinguishes_z_from_s(self):
        self.assertIn("θ", phonemize("zapato").symbols)
        self.assertNotIn("θ", phonemize("sapo").symbols)


if __name__ == "__main__":
    unittest.main()
