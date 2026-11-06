"""Opt-in real-engine acceptance check. Run with the project Python; see docs/testing.md."""
import argparse
import hashlib
import os
import socket
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app

parser = argparse.ArgumentParser()
parser.add_argument('video', type=Path)
parser.add_argument('--model', type=Path, required=True)
parser.add_argument('--ffmpeg', default='ffmpeg')
parser.add_argument('--ffprobe', default='ffprobe')
args = parser.parse_args()
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
original_connect = socket.socket.connect


def local_connections_only(sock, address):
    if isinstance(address, tuple) and address[0] not in {'localhost', '127.0.0.1', '::1'}:
        raise AssertionError(f'Unexpected outbound connection: {address[0]}')
    return original_connect(sock, address)


def process(client, video):
    with video.open('rb') as source:
        response = client.post('/api/projects', content=source, headers={'content-type': 'video/mp4', 'x-filename': video.name})
    assert response.status_code == 202, response.text
    project_id = response.json()['id']
    started, last = time.monotonic(), None
    while time.monotonic() - started < 1200:
        row = client.get(f'/api/projects/{project_id}').json()
        if row['status'] != last:
            print(f'{project_id}: {row["status"]}', flush=True)
            last = row['status']
        assert row['status'] != 'failed', row['error']
        if row['status'] == 'completed':
            result = client.get(f'/api/projects/{project_id}/transcript').json()
            assert result['segments'], 'Speech was not detected'
            assert all(0 <= s['start'] <= s['end'] <= row['metadata']['duration'] + 1 for s in result['segments'])
            assert any(s['words'] for s in result['segments']), 'No word timestamps'
            assert 119 <= row['metadata']['duration'] <= 121, row['metadata']
            print(f'Completed in {time.monotonic() - started:.1f}s; language={result["language"]}; device={result["device"]}; {len(result["segments"])} segments', flush=True)
            print('Transcript excerpt:', ' '.join(s['text'] for s in result['segments'])[:600], flush=True)
            return project_id, result
        time.sleep(.5)
    raise AssertionError('Transcription timed out')


source_hash = hashlib.sha256(args.video.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='clipforge-acceptance-') as temporary:
    settings = Settings(data_dir=Path(temporary), model_path=args.model.resolve(), device='cpu', ffmpeg=args.ffmpeg, ffprobe=args.ffprobe)
    with patch.object(socket.socket, 'connect', local_connections_only):
        with TestClient(create_app(settings)) as client:
            project_id, transcript = process(client, args.video)
            assert client.get(f'/api/projects/{project_id}/video', headers={'Range':'bytes=0-1023'}).status_code == 206
            assert client.post(f'/api/projects/{project_id}/process').json()['status'] == 'completed'
        with TestClient(create_app(settings)) as client:
            assert client.get(f'/api/projects/{project_id}/transcript').json() == transcript
            print('Restart persistence and completed-project cache: PASS', flush=True)
            process(client, args.video)
            print('Fresh transcription with outbound connections blocked: PASS', flush=True)
assert hashlib.sha256(args.video.read_bytes()).hexdigest() == source_hash
print('Source unchanged; actual FFmpeg + faster-whisper acceptance: PASS', flush=True)
