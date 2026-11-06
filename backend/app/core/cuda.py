"""Use existing Windows runtime libraries, scoped to this backend process only."""
import os
from pathlib import Path

_handles = []
_configured = set()


def configure_cuda(settings):
    if os.name != 'nt' or settings.device == 'cpu':
        return None
    explicit = settings.cuda_dll_dir
    if not explicit and not os.environ.get('LOCALAPPDATA'):
        return None
    # Official installed Ollama includes the same CUDA 12 cuBLAS runtime needed
    # by CTranslate2. No model/server/API interaction is involved here.
    directory = Path(explicit) if explicit else Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs/Ollama/lib/ollama/cuda_v12'
    if not all((directory / name).is_file() for name in ('cublas64_12.dll', 'cublasLt64_12.dll')):
        return None
    directory = str(directory.resolve())
    if directory not in _configured:
        _handles.append(os.add_dll_directory(directory))
        os.environ['PATH'] = directory + os.pathsep + os.environ.get('PATH', '')
        _configured.add(directory)
    return directory
