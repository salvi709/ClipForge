import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv('CLIPFORGE_DATA_DIR', ROOT / 'data')).resolve())
    model_path: Path = field(default_factory=lambda: Path(os.getenv('CLIPFORGE_MODEL_PATH', ROOT / 'models' / 'base')).resolve())
    device: str = field(default_factory=lambda: os.getenv('CLIPFORGE_DEVICE', 'auto'))
    cuda_dll_dir: str = field(default_factory=lambda: os.getenv('CLIPFORGE_CUDA_DLL_DIR', ''))
    max_upload_bytes: int = field(default_factory=lambda: int(os.getenv('CLIPFORGE_MAX_UPLOAD_MB', '2048')) * 1024 * 1024)
    ffmpeg: str = field(default_factory=lambda: os.getenv('CLIPFORGE_FFMPEG', 'ffmpeg'))
    ffprobe: str = field(default_factory=lambda: os.getenv('CLIPFORGE_FFPROBE', 'ffprobe'))
    cpu_threads: int = field(default_factory=lambda: int(os.getenv('CLIPFORGE_CPU_THREADS', '4')))
    quality_model_path: Path = field(default_factory=lambda: Path(os.getenv('CLIPFORGE_QUALITY_MODEL_PATH', ROOT / 'models' / 'small')).resolve())
    ollama_url: str = field(default_factory=lambda: os.getenv('CLIPFORGE_OLLAMA_URL', 'http://127.0.0.1:11434'))
    ollama_model: str = field(default_factory=lambda: os.getenv('CLIPFORGE_OLLAMA_MODEL', 'qwen2.5:3b').strip())
    ollama_timeout: int = field(default_factory=lambda: int(os.getenv('CLIPFORGE_OLLAMA_TIMEOUT', '240')))
    clip_min_seconds: float = field(default_factory=lambda: float(os.getenv('CLIPFORGE_CLIP_MIN_SECONDS', '15')))
    clip_max_seconds: float = field(default_factory=lambda: float(os.getenv('CLIPFORGE_CLIP_MAX_SECONDS', '60')))
    clip_max_results: int = field(default_factory=lambda: int(os.getenv('CLIPFORGE_CLIP_MAX_RESULTS', '4')))
    clip_max_candidates: int = field(default_factory=lambda: int(os.getenv('CLIPFORGE_CLIP_MAX_CANDIDATES', '60')))

    def __post_init__(self):
        if not self.ollama_model or any(c.isspace() for c in self.ollama_model):
            raise ValueError('CLIPFORGE_OLLAMA_MODEL must be a nonempty local model tag')
        if self.device not in {'auto', 'cpu', 'cuda'}:
            raise ValueError('CLIPFORGE_DEVICE must be auto, cpu or cuda')
        if self.max_upload_bytes <= 0 or self.cpu_threads <= 0:
            raise ValueError('Upload limit and CPU threads must be positive')
        url = urlparse(self.ollama_url)
        if url.scheme != 'http' or url.hostname not in {'127.0.0.1', 'localhost', '::1'} or url.username or url.password or url.path not in {'', '/'} or url.query or url.fragment:
            raise ValueError('Ollama must use a loopback HTTP URL without credentials or a path')
        if not 5 <= self.clip_min_seconds < self.clip_max_seconds <= 120:
            raise ValueError('Clip duration settings must satisfy 5 <= minimum < maximum <= 120')
        if not 1 <= self.clip_max_results <= 10 or not 4 <= self.clip_max_candidates <= 100 or self.ollama_timeout <= 0:
            raise ValueError('Invalid discovery limits')
