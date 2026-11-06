import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services import jobs
from app.services.media import ProcessingError


class FakeTranscriber:
    """Test double only; production always uses faster-whisper."""
    def __init__(self):
        self.calls = 0

    def release(self):
        pass

    def transcribe(self, audio, on_warning, **options):
        self.calls += 1
        assert audio.exists()
        return {'language': 'en', 'device': 'cpu', 'segments': [{'id': 0, 'start': 0.0, 'end': 1.2, 'text': 'Test speech.', 'words': []}]}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / 'data', model_path=tmp_path / 'model', max_upload_bytes=100)
    engine = FakeTranscriber()
    monkeypatch.setattr(jobs, 'probe', lambda *args: {'duration': 2.0, 'width': 320, 'height': 240, 'codec': 'h264'})
    monkeypatch.setattr(jobs, 'extract', lambda source, audio, command, **kwargs: audio.write_bytes(b'audio'))
    return settings, engine


def upload(client, content=b'video', filename='test.mp4'):
    return client.post('/api/projects', content=content, headers={'content-type': 'video/mp4', 'x-filename': filename})


def wait_for_job(client, project_id):
    for _ in range(150):
        row = client.get(f'/api/projects/{project_id}').json()
        if row['status'] in {'completed', 'failed'}:
            return row
        time.sleep(.02)
    pytest.fail('Worker did not finish')


def test_upload_process_cache_restart_and_range(setup):
    settings, engine = setup
    with TestClient(create_app(settings, engine)) as client:
        result = upload(client, filename='..%2F..%2Fsafe.mp4')
        assert result.status_code == 202
        project_id = result.json()['id']
        row = wait_for_job(client, project_id)
        assert row['status'] == 'completed'
        assert row['filename'] == 'safe.mp4'
        assert 'source_path' not in row and 'transcript_path' not in row
        transcript = client.get(f'/api/projects/{project_id}/transcript').json()
        assert transcript['segments'][0]['start'] == 0
        source = settings.data_dir / 'projects' / project_id / 'source.mp4'
        assert source.read_bytes() == b'video'
        assert not (source.parent / 'audio.wav').exists()
        assert client.get(f'/api/projects/{project_id}/video', headers={'Range': 'bytes=0-1'}).status_code == 206
        client.post(f'/api/projects/{project_id}/process')
        assert engine.calls == 1
    with TestClient(create_app(settings, engine)) as client:
        assert client.get('/api/projects').json()[0]['status'] == 'completed'
        assert client.get(f'/api/projects/{project_id}/transcript').json() == transcript


def test_reject_invalid_uploads_and_origins(setup):
    settings, engine = setup
    with TestClient(create_app(settings, engine)) as client:
        assert upload(client, filename='video.exe').status_code == 415
        assert upload(client, content=b'').status_code == 400
        assert upload(client, content=b'x' * 101).status_code == 413
        assert client.post('/api/projects', content=iter([b'x' * 60, b'x' * 60]), headers={'x-filename': 'a.mp4', 'content-type': 'video/mp4'}).status_code == 413
        assert client.get('/api/projects/not-a-uuid').status_code == 422
        assert client.get('/api/projects', headers={'Origin': 'https://untrusted.example'}).status_code == 403
        assert client.get('/api/projects', headers={'Host': 'untrusted.example'}).status_code == 400
        assert client.get('/api/projects').json() == []
    assert not list((settings.data_dir / 'projects').glob('*/source.mp4'))


def test_failure_and_retry(setup, monkeypatch):
    settings, engine = setup
    def broken(*args):
        raise ProcessingError('This video has no audio track.')
    monkeypatch.setattr(jobs, 'probe', broken)
    with TestClient(create_app(settings, engine)) as client:
        project_id = upload(client).json()['id']
        row = wait_for_job(client, project_id)
        assert row['status'] == 'failed'
        assert 'no audio' in row['error']
        assert client.get(f'/api/projects/{project_id}/transcript').status_code == 409
        monkeypatch.setattr(jobs, 'probe', lambda *args: {'duration': 2})
        client.post(f'/api/projects/{project_id}/process')
        assert wait_for_job(client, project_id)['status'] == 'completed'


def test_interrupted_jobs_recovered(setup):
    from app.database.store import Store
    settings, engine = setup
    store = Store(settings.data_dir)
    store.create('interrupted', 'test.mp4', Path('source.mp4'), 12)
    store.update('interrupted', status='transcribing')
    with TestClient(create_app(settings, engine)) as client:
        row = client.get('/api/projects').json()[0]
        assert row['status'] == 'failed' and 'interrupted' in row['error']


def test_missing_model_status(setup):
    settings, engine = setup
    with TestClient(create_app(settings, engine)) as client:
        health = client.get('/api/health').json()
        assert health['checks']['model'] is False
        assert health['status'] == 'setup_required'


def test_cache_missing_file_reprocessed(setup):
    settings, engine = setup
    with TestClient(create_app(settings, engine)) as client:
        project_id = upload(client).json()['id']
        wait_for_job(client, project_id)
        (settings.data_dir / 'projects' / project_id / 'transcript.json').unlink()
        assert client.get(f'/api/projects/{project_id}/transcript').status_code == 404
        client.post(f'/api/projects/{project_id}/process')
        assert wait_for_job(client, project_id)['status'] == 'completed'
        assert engine.calls == 2


def test_corrupted_cache_reprocessed(setup):
    settings, engine = setup
    with TestClient(create_app(settings, engine)) as client:
        project_id = upload(client).json()['id']
        wait_for_job(client, project_id)
        (settings.data_dir / 'projects' / project_id / 'transcript.json').write_text('not json')
        assert client.get(f'/api/projects/{project_id}/transcript').status_code == 404
        client.post(f'/api/projects/{project_id}/process')
        assert wait_for_job(client, project_id)['status'] == 'completed'
        assert engine.calls == 2


def test_store_releases_database_file_handles(tmp_path):
    from app.database.store import Store
    store = Store(tmp_path)
    store.create('example', 'test.mp4', tmp_path / 'source.mp4', 4)
    store.get('example')
    store.list()
    store.update('example', status='completed')
    store.path.unlink()  # Windows refuses this if any connection is still open.
    assert not store.path.exists()
