"""Read local inference configuration; optionally test real transcription on a WAV.

No downloads, installations, driver changes, or transcript text in output.
"""
import argparse
import ctypes
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.core.config import Settings
from app.services.ollama import Ollama
from app.services.transcription import Transcriber


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, help='Existing local audio file for actual GPU/CPU inference')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    report = {'ollama': Ollama(settings).status(), 'device_preference': settings.device,
              'data_directory': str(settings.data_dir),
              'versions': {name: importlib.metadata.version(name) for name in ('faster-whisper', 'ctranslate2', 'onnxruntime')}}
    import ctranslate2
    try:
        report['cuda_device_count'] = ctranslate2.get_cuda_device_count()
        if report['cuda_device_count']:
            report['cuda_compute_types'] = sorted(ctranslate2.get_supported_compute_types('cuda'))
    except Exception as error:
        report['cuda_detection_error'] = str(error)
    if os.name == 'nt':
        report['runtime_libraries'] = {}
        for library in ('cublas64_12.dll', 'cublasLt64_12.dll', 'cudnn64_9.dll'):
            try:
                ctypes.WinDLL(library)
                report['runtime_libraries'][library] = 'loadable'
            except OSError:
                report['runtime_libraries'][library] = 'not loadable (missing or dependency/load-path problem)'
    if args.audio:
        engine, warnings = Transcriber(settings), []
        try:
            result = engine.transcribe(args.audio.resolve(), warnings.append, language='auto')
            report['inference'] = {'actual_device': result['device'], 'segment_count': len(result['segments']),
                                   'warning_count': len(warnings), 'warnings': warnings}
        finally:
            engine.release()
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
