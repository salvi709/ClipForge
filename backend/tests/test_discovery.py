import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.database.store import Store
from app.main import create_app
from app.models.discovery import Assessment
from app.services.candidates import build_candidates, quality_score, rank_candidates
from app.services.discovery import Discovery
from app.services.media import ProcessingError
from app.services.ollama import Ollama
from app.services.sentences import sentence_units


PASSAGES = [
    'A machine learning model learns patterns from examples. For example, label news articles as sports or politics, then train on these labels. The model can classify a new article using the patterns it learned.',
    'Language models work with human language. They learn patterns in text and can generate replies, summaries, poems or computer code. These tasks all depend on understanding and generating language, which explains the name language model.',
    'Evaluation needs data the model has never seen. If you test only on training examples, memorization can look like learning. Reserve a separate test set so your accuracy measures generalization to new examples.',
    'Clear audio helps transcription. Move the microphone closer to the speaker and reduce background noise before recording. This makes speech easier to recognize and reduces the time you spend correcting a transcript afterward.',
]


def speech():
    return {'segments': [{'id': i, 'start': i * 32.0, 'end': i * 32.0 + 30, 'text': text, 'words': []} for i, text in enumerate(PASSAGES)], 'language': 'en'}


def assessment(candidate, **overrides):
    # Extract evidence from excerpt, ensuring minimum 8 characters for validation
    excerpt_words = candidate['excerpt'].split()[:8]
    evidence_text = ' '.join(excerpt_words) if excerpt_words else 'Sample evidence text'
    # Ensure evidence meets minimum length requirement (8 chars)
    if len(evidence_text) < 8:
        evidence_text = 'Sample evidence text'
    
    return Assessment(candidate_id=candidate['id'], suitable=True, title='Useful explanation', reason='Provides a concrete explanation and a clear takeaway.',
                      evidence=evidence_text, **({'hook_strength': 3, 'informational_value': 4, 'context_completeness': 4, 'clarity': 4} | overrides))


class FakeOllama:
    def __init__(self, ready=True, gate=None):
        self.ready, self.gate, self.calls = ready, gate, 0

    def status(self):
        return {'status': 'ready' if self.ready else 'unavailable', 'model': 'test-local', 'digest': 'test', 'message': 'Ollama is not reachable. Start ollama serve.'}

    def assess(self, candidates, **kwargs):
        self.calls += 1
        if self.gate:
            assert self.gate.wait(5)
        return [assessment(candidate) for candidate in candidates]


class NoTranscription:
    def __init__(self):
        self.released = False

    def release(self):
        self.released = True

    def transcribe(self, *args, **kwargs):
        pytest.fail('Discovery must never re-transcribe')


def save_project(client, settings, transcript=None):
    project_id = str(uuid4())
    directory = settings.data_dir / 'projects' / project_id
    directory.mkdir(parents=True)
    source, target = directory / 'source.mp4', directory / 'transcript.json'
    source.write_bytes(b'original video')
    target.write_text(json.dumps(transcript if transcript is not None else speech()))
    client.app.state.store.create(project_id, 'lesson.mp4', source, source.stat().st_size)
    client.app.state.store.update(project_id, status='completed', metadata={'duration': 150}, transcript_path=str(target))
    return project_id, target


def wait_discovery(client, project_id):
    for _ in range(200):
        result = client.get(f'/api/projects/{project_id}/discovery').json()
        if result['status'] in {'completed', 'failed'}:
            return result
        time.sleep(.01)
    pytest.fail('Discovery did not finish')


def test_candidate_timing_ranking_and_strict_duration(tmp_path):
    settings = Settings(data_dir=tmp_path)
    candidates, groups = build_candidates(speech(), 150, settings)
    assert groups and candidates
    assert all(0 <= c['start'] < c['end'] <= 150 for c in candidates)
    assert all(c['start'] in {0, 32, 64, 96} and c['end'] in {30, 62, 94, 126} for c in candidates)
    assessments = [assessment(c) for c in candidates]
    assert quality_score(assessments[0]) == 80  # Educational score excludes hook strength
    ranked = rank_candidates(candidates, assessments, 4)
    assert len(ranked) == 4 and [c['rank'] for c in ranked] == [1, 2, 3, 4]
    short = {'segments': [{'start': 1, 'end': 10, 'text': PASSAGES[0], 'words': []}]}
    assert build_candidates(short, 11, settings)[0] == []
    assert build_candidates({'segments': [{'start': 0, 'end': 2, 'text': 'Hello there.', 'words': []}]}, 2, settings)[0] == []


def test_sentence_splitting_preserves_real_word_times_and_zero_length_words():
    words = [{'start': 0, 'end': .5, 'word': 'One'}, {'start': .5, 'end': .5, 'word': ' small'},
             {'start': .5, 'end': 1, 'word': ' thought.'}, {'start': 1.5, 'end': 2, 'word': 'Another'}, {'start': 2, 'end': 3, 'word': ' thought.'}]
    units = sentence_units({'segments': [{'words': words}]}, 2.8)
    assert [(u['start'], u['end']) for u in units] == [(0, 1), (1.5, 2.8)]
    assert units[0]['text'] == 'One small thought.'


def test_overlap_and_incomplete_candidates_are_removed(tmp_path):
    candidates, _ = build_candidates(speech(), 150, Settings(data_dir=tmp_path))
    duplicate = {**candidates[0], 'id': 'duplicate', 'start': 2, 'end': 30}
    ranked = rank_candidates([*candidates, duplicate], [*[assessment(c) for c in candidates], assessment(duplicate)], 10)
    assert len(ranked) == 4
    assert not rank_candidates(candidates, [assessment(c, context_completeness=2) for c in candidates], 4)


def test_discovery_cache_restart_adjustments_and_staleness(tmp_path):
    settings = Settings(data_dir=tmp_path)
    ollama, transcriber = FakeOllama(), NoTranscription()
    with TestClient(create_app(settings, transcriber, ollama)) as client:
        project_id, path = save_project(client, settings)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert client.post(f'/api/projects/{project_id}/discovery').status_code == 202
        result = wait_discovery(client, project_id)
        assert result['status'] == 'completed' and len(result['clips']) == 4
        assert transcriber.released
        calls = ollama.calls
        client.post(f'/api/projects/{project_id}/discovery')
        assert ollama.calls == calls
        clip = result['clips'][0]
        response = client.patch(f'/api/projects/{project_id}/clips/{clip["id"]}', json={'start': 2, 'end': 20})
        assert response.status_code == 200
        assert response.json()['clips'][0]['adjusted']
        assert client.patch(f'/api/projects/{project_id}/clips/{clip["id"]}', json={'start': 10, 'end': 9}).status_code == 422
        assert client.patch(f'/api/projects/{project_id}/clips/{clip["id"]}', json={'start': 0, 'end': 151}).status_code == 422
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
        assert 'result_path' not in response.json() and 'fingerprint' not in response.json()
    with TestClient(create_app(settings, NoTranscription(), FakeOllama(ready=False))) as client:
        restored = client.get(f'/api/projects/{project_id}/discovery').json()
        assert restored['clips'][0]['start'] == 2  # saved edits work with Ollama unavailable
        path.write_text(json.dumps({'segments': []}))
        assert client.get(f'/api/projects/{project_id}/discovery').json()['status'] == 'stale'


@pytest.mark.parametrize('transcript', [{'segments': []}, {'segments': [{'start': 0, 'end': 2, 'text': 'Hello there.', 'words': []}]}])
def test_empty_and_short_speech_need_no_llm(tmp_path, transcript):
    settings, ollama = Settings(data_dir=tmp_path), FakeOllama(ready=False)
    with TestClient(create_app(settings, NoTranscription(), ollama)) as client:
        project_id, _ = save_project(client, settings, transcript)
        client.post(f'/api/projects/{project_id}/discovery')
        result = wait_discovery(client, project_id)
        assert result['status'] == 'completed' and not result['clips'] and 'No reliable clips' in result['message']
        assert ollama.calls == 0


def test_unavailable_ollama_is_actionable(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama(ready=False))) as client:
        project_id, _ = save_project(client, settings)
        client.post(f'/api/projects/{project_id}/discovery')
        result = wait_discovery(client, project_id)
        assert result['status'] == 'failed' and 'ollama serve' in result['error']


def test_duplicate_analysis_and_retranscription_are_guarded(tmp_path):
    settings, gate = Settings(data_dir=tmp_path), threading.Event()
    ollama = FakeOllama(gate=gate)
    with TestClient(create_app(settings, NoTranscription(), ollama)) as client:
        project_id, _ = save_project(client, settings)
        client.post(f'/api/projects/{project_id}/discovery')
        client.post(f'/api/projects/{project_id}/discovery')
        assert client.post(f'/api/projects/{project_id}/transcription', json={'language': 'en', 'quality': 'fast'}).status_code == 409
        gate.set()
        assert wait_discovery(client, project_id)['status'] == 'completed'
        assert ollama.calls == 4


def test_old_database_migrates_without_losing_projects(tmp_path):
    db = sqlite3.connect(tmp_path / 'clipforge.sqlite3')
    db.execute('CREATE TABLE projects (id TEXT PRIMARY KEY, filename TEXT, source_path TEXT, size INTEGER, metadata TEXT, status TEXT, created_at TEXT, transcript_path TEXT, error TEXT, warning TEXT)')
    db.execute("INSERT INTO projects (id,filename,status) VALUES ('old','lesson.mp4','completed')")
    db.commit(); db.close()
    store = Store(tmp_path)
    assert store.get('old')['filename'] == 'lesson.mp4'
    assert store.get('old')['language'] == 'auto' and store.get('old')['quality'] == 'fast'
    store.update_discovery('old', status='evaluating_candidates')
    store.recover()
    assert store.discovery('old')['status'] == 'failed'


def test_model_response_validation_and_bounded_retry(tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path)
    candidate = {'id': 'real', 'excerpt': PASSAGES[0]}
    calls = []
    def responder(request):
        calls.append(json.loads(request.content))
        content = 'not json' if len(calls) == 1 else json.dumps({'assessments': [assessment(candidate).model_dump()]})
        return httpx.Response(200, json={'message': {'content': content}})
    engine = Ollama(settings)
    monkeypatch.setattr(engine, '_client', lambda timeout: httpx.Client(base_url=settings.ollama_url, transport=httpx.MockTransport(responder)))
    assert engine.assess([candidate])[0].candidate_id == 'real'
    assert len(calls) == 2 and calls[0]['keep_alive'] == '5m' and 'think' not in calls[0]
    assert calls[0]['model'] == 'qwen2.5:3b'
    variant = calls[0]['format']['properties']['assessments']['items']['anyOf'][0]
    assert variant['properties']['candidate_id']['enum'] == ['real']
    assert all(quote in candidate['excerpt'] for quote in variant['properties']['evidence']['enum'])
    assert 'format' in calls[0] and 'timestamp' not in json.dumps(calls[0]['format'])


def test_ungrounded_model_evidence_rejected(tmp_path, monkeypatch):
    candidate = {'id': 'real', 'excerpt': PASSAGES[0]}
    invalid = assessment(candidate).model_dump() | {'evidence': 'invented facts not in the speech'}
    engine = Ollama(Settings(data_dir=tmp_path))
    monkeypatch.setattr(engine, '_client', lambda timeout: httpx.Client(base_url=engine.settings.ollama_url, transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'message': {'content': json.dumps({'assessments': [invalid]})}}))))
    with pytest.raises(ProcessingError, match='invalid or ungrounded'):
        engine.assess([candidate])


def test_remote_ollama_configuration_forbidden():
    with pytest.raises(ValueError, match='loopback'):
        Settings(ollama_url='https://cloud.example')


def test_candidates_do_not_bridge_uncertain_speech(tmp_path):
    transcript = speech()
    transcript['uncertain_ranges'] = [{'start': 12, 'end': 18, 'reason': 'unreliable'}]
    candidates, _ = build_candidates(transcript, 150, Settings(data_dir=tmp_path))
    assert candidates and all(c['start'] >= 18 or c['end'] <= 12 for c in candidates)


def test_cloud_backed_ollama_model_is_rejected(tmp_path, monkeypatch):
    engine = Ollama(Settings(data_dir=tmp_path))
    def response(request):
        return httpx.Response(200, json={'models': [{'name': engine.settings.ollama_model}]} if request.url.path == '/api/tags' else {'remote_model': 'cloud-model', 'remote_host': 'ollama.com'})
    monkeypatch.setattr(engine, '_client', lambda timeout: httpx.Client(base_url=engine.settings.ollama_url, transport=httpx.MockTransport(response)))
    assert engine.status()['status'] == 'unsupported'


@pytest.mark.parametrize('scenario,status', [('ready','ready'), ('missing','model_missing'), ('offline','unavailable'), ('invalid','invalid_response'), ('timeout','timeout')])
def test_model_availability_diagnostics(monkeypatch, scenario, status):
    engine = Ollama(Settings())
    def response(request):
        if scenario == 'offline': raise httpx.ConnectError('refused')
        if scenario == 'timeout': raise httpx.ReadTimeout('timed out')
        if scenario == 'invalid': return httpx.Response(200, json={'models': [None]})
        if request.url.path == '/api/tags':
            return httpx.Response(200, json={'models': [] if scenario == 'missing' else [{'name': 'qwen2.5:3b', 'digest': 'local'}]})
        assert json.loads(request.content)['model'] == 'qwen2.5:3b'
        return httpx.Response(200, json={'capabilities': ['completion']})
    monkeypatch.setattr(engine, '_client', lambda timeout: httpx.Client(base_url=engine.settings.ollama_url, transport=httpx.MockTransport(response)))
    result = engine.status()
    assert result['status'] == status and result['model'] == 'qwen2.5:3b'
    assert result['message']


def test_model_override_and_qwen3_only_thinking(monkeypatch):
    monkeypatch.delenv('CLIPFORGE_OLLAMA_MODEL', raising=False)
    assert Settings().ollama_model == 'qwen2.5:3b'
    monkeypatch.setenv('CLIPFORGE_OLLAMA_MODEL', 'qwen3:4b')
    engine = Ollama(Settings())
    candidate = {'id': 'real', 'excerpt': PASSAGES[0]}
    def response(request):
        payload = json.loads(request.content)
        assert payload['model'] == 'qwen3:4b' and payload['think'] is False
        return httpx.Response(200, json={'message': {'content': json.dumps({'assessments': [assessment(candidate).model_dump()]})}})
    monkeypatch.setattr(engine, '_client', lambda timeout: httpx.Client(base_url=engine.settings.ollama_url, transport=httpx.MockTransport(response)))
    assert engine.assess([candidate])


def test_generation_timeout_no_retry(monkeypatch):
    engine, calls = Ollama(Settings()), []
    def response(request):
        calls.append(request)
        raise httpx.ReadTimeout('timeout')
    monkeypatch.setattr(engine, '_client', lambda timeout: httpx.Client(base_url=engine.settings.ollama_url, transport=httpx.MockTransport(response)))
    with pytest.raises(ProcessingError, match='timed out'):
        engine.assess([{'id': 'real', 'excerpt': PASSAGES[0]}])
    assert len(calls) == 1


def test_ranked_suggestions_persist_in_sqlite_without_json_file(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        project_id, path = save_project(client, settings)
        client.post(f'/api/projects/{project_id}/discovery')
        expected = wait_discovery(client, project_id)
        saved = client.app.state.store.discovery(project_id)
        assert json.loads(saved['result_json'])['clips'] == expected['clips']
        (path.parent / 'clips.json').unlink()
    with TestClient(create_app(settings, NoTranscription(), FakeOllama(ready=False))) as client:
        assert client.get(f'/api/projects/{project_id}/discovery').json()['clips'] == expected['clips']


def test_invalid_word_timestamps_do_not_escape_video(tmp_path):
    transcript = speech()
    transcript['segments'].extend([{'start': -20, 'end': 10, 'text': PASSAGES[0]}, {'start': 999, 'end': 1000, 'text': PASSAGES[0]}, {'start': float('nan'), 'end': 99, 'text': PASSAGES[0]}])
    candidates, _ = build_candidates(transcript, 110, Settings(data_dir=tmp_path))
    assert candidates and all(0 <= c['start'] < c['end'] <= 110 for c in candidates)


def test_long_transcript_candidate_budget_keeps_diverse_starts(tmp_path):
    transcript = {'segments': [{'start': i * 8, 'end': i * 8 + 7.5, 'text': PASSAGES[i % 4]} for i in range(200)]}
    candidates, _ = build_candidates(transcript, 1600, Settings(data_dir=tmp_path))
    assert len(candidates) == 60  # Updated from 24 to 60 for v0.4 high-recall discovery
    assert len({c['start'] for c in candidates}) >= 24  # Still ensures diversity of start times
    assert max(c['start'] for c in candidates) > 1300


def test_previous_default_model_failure_does_not_show_stale_pull_advice(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        project_id, _ = save_project(client, settings)
        client.app.state.store.update_discovery(project_id, status='failed', error='Local model missing. Run: ollama pull qwen3:4b (first-time setup needs internet).')
        result = client.get(f'/api/projects/{project_id}/discovery').json()
        assert result['status'] == 'stale' and result['error'] is None
        assert result['model'] == 'qwen2.5:3b' and 'qwen3' not in json.dumps(result)
