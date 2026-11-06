import os
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.instance import single_engine
from app.main import create_app
from app.services import deletion
from test_discovery import FakeOllama, NoTranscription, save_project, wait_discovery


def test_delete_removes_owned_files_and_all_records_only(tmp_path):
    settings = Settings(data_dir=tmp_path / 'data')
    shared = tmp_path / 'models' / 'model.bin'
    shared.parent.mkdir(); shared.write_bytes(b'model')
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        project_id, transcript = save_project(client, settings)
        other_id, other = save_project(client, settings)
        client.post(f'/api/projects/{project_id}/discovery')
        result = wait_discovery(client, project_id)
        client.patch(f'/api/projects/{project_id}/clips/{result["clips"][0]["id"]}', json={'start': 1, 'end': 10})
        (transcript.parent / 'audio.wav').write_bytes(b'temporary')
        previews = transcript.parent / 'previews'; previews.mkdir()
        (previews / 'preview.tmp').write_bytes(b'preview')
        response = client.delete(f'/api/projects/{project_id}')
        assert response.status_code == 200 and response.json()['deleted']
        assert not transcript.parent.exists()
        store = client.app.state.store
        assert store.get(project_id) is None and store.discovery(project_id) is None and store.edits(project_id) == {}
        assert other.exists() and store.get(other_id) and shared.read_bytes() == b'model'
        assert client.delete(f'/api/projects/{project_id}').status_code == 404
        assert client.post(f'/api/projects/{project_id}/process').status_code == 404
        assert client.post(f'/api/projects/{project_id}/discovery').status_code == 404
        with pytest.raises(KeyError): store.update_discovery(project_id, status='completed')


@pytest.mark.parametrize('work', ['transcription', 'discovery'])
def test_delete_busy_project_is_rejected(tmp_path, work):
    settings, gate = Settings(data_dir=tmp_path), threading.Event()
    with TestClient(create_app(settings, NoTranscription(), FakeOllama(gate=gate))) as client:
        project_id, transcript = save_project(client, settings)
        if work == 'transcription':
            client.app.state.store.update(project_id, status='transcribing')
        else:
            client.post(f'/api/projects/{project_id}/discovery')
        try:
            assert client.delete(f'/api/projects/{project_id}').status_code == 409
            assert transcript.exists()
        finally:
            gate.set()
        if work == 'discovery': assert wait_discovery(client, project_id)['status'] == 'completed'


def test_partial_failure_retains_record_blocks_jobs_and_can_retry(tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        project_id, transcript = save_project(client, settings)
        real = deletion.shutil.rmtree
        def fail(target):
            (target / 'transcript.json').unlink()
            raise PermissionError('locked source')
        monkeypatch.setattr(deletion.shutil, 'rmtree', fail)
        response = client.delete(f'/api/projects/{project_id}')
        assert response.status_code == 500 and 'incomplete' in response.json()['detail']
        assert client.app.state.store.get(project_id)['status'] == 'deletion_failed'
        assert (transcript.parent / 'source.mp4').exists()
        assert client.post(f'/api/projects/{project_id}/process').status_code == 409
        monkeypatch.setattr(deletion.shutil, 'rmtree', real)
        assert client.delete(f'/api/projects/{project_id}').status_code == 200
        assert not transcript.parent.exists()


def test_external_recorded_path_and_invalid_uuid_are_never_deleted(tmp_path):
    settings = Settings(data_dir=tmp_path / 'data')
    external = tmp_path / 'keep.txt'; external.write_text('keep')
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        project_id, transcript = save_project(client, settings)
        client.app.state.store.update(project_id, transcript_path=str(external))
        assert client.delete(f'/api/projects/{project_id}').status_code == 500
        assert external.read_text() == 'keep' and transcript.exists()
        assert client.delete('/api/projects/not-a-uuid').status_code == 422


def test_link_or_windows_junction_is_never_followed(tmp_path):
    settings = Settings(data_dir=tmp_path / 'data')
    outside = tmp_path / 'external'; outside.mkdir()
    (outside / 'keep.txt').write_text('keep')
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        project_id, transcript = save_project(client, settings)
        link = transcript.parent / 'escape'
        if os.name == 'nt':
            import _winapi
            _winapi.CreateJunction(str(outside), str(link))
        else:
            link.symlink_to(outside, target_is_directory=True)
        try:
            assert client.delete(f'/api/projects/{project_id}').status_code == 500
            assert (outside / 'keep.txt').read_text() == 'keep' and transcript.exists()
        finally:
            if os.name == 'nt': link.rmdir()
            else: link.unlink()


def test_second_engine_cannot_recover_or_recreate_active_projects(tmp_path):
    with single_engine(tmp_path):
        with pytest.raises(RuntimeError, match='Another ClipForge backend'):
            with single_engine(tmp_path):
                pytest.fail('Second engine acquired the data directory')
    with single_engine(tmp_path):
        pass  # OS lock is released after shutdown.


def test_interrupted_deletion_recovers_and_can_finish(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        project_id, target = save_project(client, settings)
        client.app.state.store.update(project_id, status='deleting')
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        assert client.get(f'/api/projects/{project_id}').json()['status'] == 'deletion_failed'
        assert client.delete(f'/api/projects/{project_id}').status_code == 200
        assert not target.parent.exists()
