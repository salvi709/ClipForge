"""Real Phase 2 acceptance; explicit local media only, no test doubles.

Use --stage transcription while installing Ollama, then --stage discovery.
Project data is retained for browser review under --data-dir (gitignored default).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app


def wait_for(client, url, terminal, timeout=1800):
    deadline, previous = time.monotonic() + timeout, None
    while time.monotonic() < deadline:
        result = client.get(url).json()
        marker = (result['status'], result.get('evaluated'))
        if marker != previous:
            print(marker, flush=True)
            previous = marker
        assert result['status'] != 'failed', result.get('error')
        if result['status'] == terminal:
            return result
        time.sleep(1)
    raise AssertionError('Processing timed out')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path)
    parser.add_argument('--data-dir', type=Path, default=ROOT / '.runtime' / 'phase2-acceptance')
    parser.add_argument('--stage', choices=['all', 'transcription', 'discovery'], default='all')
    parser.add_argument('--quality', choices=['fast', 'accurate'], default='accurate')
    args = parser.parse_args()
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    portable = next((ROOT / '.runtime' / 'ffmpeg').glob('*/bin/ffmpeg.exe'), None)
    if portable:
        os.environ.setdefault('CLIPFORGE_FFMPEG', str(portable))
        os.environ.setdefault('CLIPFORGE_FFPROBE', str(portable.with_name('ffprobe.exe')))
    settings = Settings(data_dir=args.data_dir.resolve(), device='cpu')
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    report_path = settings.data_dir / 'acceptance-report.json'
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    original_connect = socket.socket.connect

    def loopback_only(sock, address):
        if isinstance(address, tuple) and address[0] not in {'127.0.0.1', '::1', 'localhost'}:
            raise AssertionError('Unexpected outbound connection')
        return original_connect(sock, address)

    with patch.object(socket.socket, 'connect', loopback_only):
        with TestClient(create_app(settings)) as client:
            if args.stage in {'all', 'transcription'}:
                if not args.video:
                    parser.error('--video is required for transcription')
                source_hash = hashlib.sha256(args.video.read_bytes()).hexdigest()
                started = time.monotonic()
                with args.video.open('rb') as source:
                    response = client.post(f'/api/projects?language=en&quality={args.quality}', content=source,
                                           headers={'x-filename': 'educational-acceptance.mp4', 'content-type': 'video/mp4'})
                assert response.status_code == 202, response.text
                project_id = response.json()['id']
                project = wait_for(client, f'/api/projects/{project_id}', 'completed')
                transcript = client.get(f'/api/projects/{project_id}/transcript').json()
                assert transcript['language'] == 'en' and transcript['transcription_options']['language'] == 'en'
                assert transcript['segments'] and transcript['sentences']
                assert hashlib.sha256(args.video.read_bytes()).hexdigest() == source_hash
                report = {'project_id': project_id, 'transcription_seconds': round(time.monotonic() - started, 2),
                          'duration': project['metadata']['duration'], 'quality': args.quality, 'sentence_count': len(transcript['sentences'])}
                report_path.write_text(json.dumps(report, indent=2))
                print('Transcription PASS', json.dumps(report), flush=True)
                print('Excerpt:', ' '.join(s['text'] for s in transcript['segments'])[:500], flush=True)
            if args.stage in {'all', 'discovery'}:
                project_id = report['project_id']
                project = client.get(f'/api/projects/{project_id}').json()
                transcript_path = settings.data_dir / 'projects' / project_id / 'transcript.json'
                before = transcript_path.read_bytes()
                started = time.monotonic()
                response = client.post(f'/api/projects/{project_id}/discovery')
                assert response.status_code == 202, response.text
                result = wait_for(client, f'/api/projects/{project_id}/discovery', 'completed')
                assert result['clips'], result.get('message')
                for clip in result['clips']:
                    assert 0 <= clip['start'] < clip['end'] <= project['metadata']['duration']
                    assert clip['excerpt'] and clip['reason'] and clip['evidence']
                    print(json.dumps({key: clip[key] for key in ('rank', 'title', 'start', 'end', 'score', 'reason', 'excerpt')}, ensure_ascii=False), flush=True)
                assert transcript_path.read_bytes() == before
                assert client.post(f'/api/projects/{project_id}/discovery').json()['status'] == 'completed'
                report.update(discovery_seconds=round(time.monotonic() - started, 2), clip_count=len(result['clips']), model=result['model'])
                report_path.write_text(json.dumps(report, indent=2))
        if args.stage in {'all', 'discovery'}:
            with TestClient(create_app(settings)) as client:
                restored = client.get(f'/api/projects/{project_id}/discovery').json()
                assert restored['clips'] == result['clips']
            print('Discovery, unchanged transcript, cache and restart persistence: PASS', flush=True)
    print('Python inference connections limited to loopback; no dependency/model download occurred.', flush=True)


if __name__ == '__main__':
    main()
