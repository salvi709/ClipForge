"""Explicit online setup step; never imported by the processing engine."""
import argparse
from pathlib import Path

from huggingface_hub import snapshot_download

parser = argparse.ArgumentParser(description='Download a local faster-whisper model (requires internet).')
parser.add_argument('--model', choices=['tiny', 'base', 'base.en', 'small', 'small.en', 'medium', 'large-v3'], default='base')
parser.add_argument('--output', type=Path)
args = parser.parse_args()
destination = args.output or Path(__file__).resolve().parents[1] / 'models' / args.model
print(f'Downloading Systran/faster-whisper-{args.model} to {destination.resolve()}')
snapshot_download(repo_id=f'Systran/faster-whisper-{args.model}', local_dir=str(destination),
                  allow_patterns=['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.*', 'preprocessor_config.json'])
print('Setup complete. Processing will use local files only.')
