"""mini-voz: a small Spanish TTS trained from scratch (a Spanish adaptation of tiny-voca).

The speech model loads no pretrained weights. A pretrained phoneme recogniser
is used only by the annotation step, and an ASR model only by evaluation.
"""

from .config import Config
from .model import MiniVoz

__all__ = ["Config", "MiniVoz"]
