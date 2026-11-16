"""Choose where the model runs: an NVIDIA GPU, an Apple Silicon GPU or the CPU."""

import os
import torch


def pick_device(name="auto"):
    """``"auto"`` -> ``cuda`` if there is an NVIDIA GPU, else ``mps`` on Apple
    Silicon, else ``cpu``. Any other name is returned as it is.

    On Apple Silicon a few operations are not implemented on the GPU; PyTorch
    runs them on the CPU when ``PYTORCH_ENABLE_MPS_FALLBACK=1`` is set before it
    starts. ``python -m mini_voz.train`` etc. cannot set it late, so the README
    tells you to export it; this function only warns when it is missing.
    """
    if name != "auto":
        return name
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        if os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") != "1":
            print("note: set PYTORCH_ENABLE_MPS_FALLBACK=1 so operations missing on the Apple GPU run on the CPU", flush=True)
        return "mps"
    return "cpu"


def is_cuda(device):
    return str(device).startswith("cuda")


def stay_awake():
    """Keep the computer from going to sleep while this process runs (Windows).

    Long jobs die when the machine sleeps. This asks Windows to stay awake for
    the life of the process only; no setting is changed. On macOS start the
    command with ``caffeinate -i`` instead.
    """
    if os.name == "nt":
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
