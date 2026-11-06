import threading
import time
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import create_app
from app.services.media import check_cancel
from test_api import setup, upload, wait_for_job


def test_progress_completion_and_upload_idempotency(setup):
    settings, engine = setup
    with TestClient(create_app(settings, engine)) as client:
        key = str(uuid4())
        headers = {'x-upload-id': key, 'x-filename': 'test.mp4', 'content-type': 'video/mp4'}
        first = client.post('/api/projects', content=b'video', headers=headers)
        assert first.status_code == 202
        row = wait_for_job(client, key)
        assert row['status'] == 'completed'
        assert row['processing']['timings']['audio_extraction'] >= 0
        assert row['processing']['timings']['total_processing'] >= 0
        assert client.post('/api/projects', content=b'video', headers=headers).json()['id'] == key
        assert len(client.get('/api/projects').json()) == 1 and engine.calls == 1


def test_running_and_queued_cancellation_keep_source_and_api_responsive(setup):
    settings, engine = setup
    entered, finish = threading.Event(), threading.Event()
    def slow(audio, warning, **options):
        options['on_progress'](status='transcribing', processed_seconds=.5, total_seconds=2)
        entered.set()
        while not finish.wait(.01):
            check_cancel(options['cancel'])
        check_cancel(options['cancel'])
    engine.transcribe = slow
    with TestClient(create_app(settings, engine)) as client:
        first = upload(client).json()['id']
        assert entered.wait(3)
        second = upload(client).json()['id']
        assert client.get('/api/health').status_code == 200
        assert client.post(f'/api/projects/{second}/cancel').status_code == 202
        assert client.get(f'/api/projects/{second}').json()['status'] == 'cancelled'
        client.post(f'/api/projects/{first}/cancel')
        for _ in range(100):
            row = client.get(f'/api/projects/{first}').json()
            if row['status'] == 'cancelled': break
            time.sleep(.01)
        assert row['status'] == 'cancelled'
        directory = settings.data_dir / 'projects' / first
        assert (directory / 'source.mp4').exists() and not (directory / 'transcript.json').exists()
        finish.set()
