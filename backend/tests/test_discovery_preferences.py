import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models.discovery import DiscoveryOptions
from app.services.candidates import valid_candidate
from app.services.media import ProcessingError
from test_discovery import FakeOllama, NoTranscription, save_project, wait_discovery


@pytest.mark.parametrize('count', [1, 5, 10])
def test_count_target_settings_persist_and_fewer_results(tmp_path, count):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        pid, _ = save_project(client, settings)
        options = {'clip_count': count, 'min_seconds': 30, 'max_seconds': 60}
        assert client.post(f'/api/projects/{pid}/discovery', json=options).status_code == 202
        result = wait_discovery(client, pid)
        assert result['status'] == 'completed' and len(result['clips']) == min(count, 4)
        assert result['result_settings'] == result['settings'] == options
        assert f'out of {count} requested' in result['message']
        saved = json.loads(client.app.state.store.discovery(pid)['result_json'])
        assert saved['settings'] == options and len(saved['clips']) == min(count, 4)
        assert result['progress']['stage'] == 'completed'
        assert result['progress']['completed_stages'] == ['queued', 'preparing_transcript', 'analyzing_topics',
            'generating_candidates', 'validating_timestamps', 'evaluating_candidates', 'ranking_clips', 'saving_results']
        assert result['progress']['elapsed_seconds'] >= 0


@pytest.mark.parametrize('minimum,maximum', [(15, 30), (30, 60), (60, 90), (45, 70)])
def test_presets_and_custom_ranges_reach_candidate_engine(tmp_path, minimum, maximum):
    settings, engine = Settings(data_dir=tmp_path), FakeOllama()
    original = engine.assess
    seen = []
    def assess(candidates, **kwargs):
        seen.append(kwargs['preferences'].model_dump())
        assert all(minimum <= c['end'] - c['start'] <= maximum for c in candidates)
        return original(candidates, **kwargs)
    engine.assess = assess
    with TestClient(create_app(settings, NoTranscription(), engine)) as client:
        pid, _ = save_project(client, settings)
        options = {'clip_count': 3, 'min_seconds': minimum, 'max_seconds': maximum}
        client.post(f'/api/projects/{pid}/discovery', json=options)
        result = wait_discovery(client, pid)
        assert result['status'] == 'completed' and result['clips'] and seen
        assert all(item == options for item in seen)
        assert all(minimum <= c['duration'] <= maximum for c in result['clips'])


@pytest.mark.parametrize('options', [{'clip_count': 0}, {'clip_count': 11}, {'clip_count': 1.5},
    {'min_seconds': 60, 'max_seconds': 30}, {'min_seconds': 30, 'max_seconds': 30},
    {'min_seconds': 0}, {'max_seconds': 121}, {'extra': True}])
def test_invalid_options_do_not_enqueue(tmp_path, options):
    with TestClient(create_app(Settings(data_dir=tmp_path), NoTranscription(), FakeOllama())) as client:
        pid, _ = save_project(client, client.app.state.settings)
        assert client.post(f'/api/projects/{pid}/discovery', json=options).status_code == 422
        assert pid not in client.app.state.jobs.pending


def test_too_short_source_and_no_matching_duration(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        pid, _ = save_project(client, settings)
        client.app.state.store.update(pid, metadata={'duration': 12})
        response = client.post(f'/api/projects/{pid}/discovery')
        assert response.status_code == 422 and 'shorter' in response.json()['detail']
        client.app.state.store.update(pid, metadata={'duration': 150})
        client.post(f'/api/projects/{pid}/discovery', json={'min_seconds': 35, 'max_seconds': 40})
        result = wait_discovery(client, pid)
        assert result['status'] == 'completed' and not result['clips']
        assert 'different duration range' in result['message']


def test_changed_settings_bypass_cache_same_settings_reuse_it(tmp_path):
    settings, engine = Settings(data_dir=tmp_path), FakeOllama()
    with TestClient(create_app(settings, NoTranscription(), engine)) as client:
        pid, _ = save_project(client, settings)
        client.post(f'/api/projects/{pid}/discovery', json={'clip_count': 1})
        first = wait_discovery(client, pid)
        calls = engine.calls
        client.post(f'/api/projects/{pid}/discovery', json={'clip_count': 1})
        assert engine.calls == calls
        client.post(f'/api/projects/{pid}/discovery', json={'clip_count': 3})
        second = wait_discovery(client, pid)
        assert engine.calls > calls and len(first['clips']) == 1 and len(second['clips']) == 3


def test_failure_and_cancellation_keep_previous_results_and_do_not_complete(tmp_path):
    settings, engine = Settings(data_dir=tmp_path), FakeOllama()
    with TestClient(create_app(settings, NoTranscription(), engine)) as client:
        pid, _ = save_project(client, settings)
        client.post(f'/api/projects/{pid}/discovery')
        previous = wait_discovery(client, pid)['clips']
        def invalid(*args, **kwargs):
            raise ProcessingError('Local AI returned invalid or ungrounded results twice.')
        original = engine.assess
        engine.assess = invalid
        client.post(f'/api/projects/{pid}/discovery', json={'clip_count': 2})
        failed = wait_discovery(client, pid)
        assert failed['status'] == 'failed' and failed['error'] and failed['previous_result']
        assert failed['clips'] == previous
        entered, gate = threading.Event(), threading.Event()
        def blocked(candidates, **kwargs):
            entered.set()
            assert gate.wait(5)
            return original(candidates, **kwargs)
        engine.assess = blocked
        client.post(f'/api/projects/{pid}/discovery', json={'clip_count': 2})
        assert entered.wait(3)
        active = client.get(f'/api/projects/{pid}/discovery').json()
        assert active['status'] == 'evaluating_candidates' and active['evaluated'] == 0 and active['total'] > 0
        assert client.get('/api/health').status_code == 200
        assert client.post(f'/api/projects/{pid}/discovery', json={'clip_count': 3}).status_code == 409
        assert client.post(f'/api/projects/{pid}/discovery', json={'clip_count': 2}).status_code == 202
        try:
            response = client.post(f'/api/projects/{pid}/discovery/cancel')
            assert response.status_code == 202 and response.json()['progress']['cancel_requested']
            assert client.delete(f'/api/projects/{pid}').status_code == 409
        finally:
            gate.set()
        for _ in range(100):
            result = client.get(f'/api/projects/{pid}/discovery').json()
            if result['status'] == 'cancelled': break
            time.sleep(.01)
        assert result['status'] == 'cancelled' and result['clips'] == previous
        assert result['progress']['stage'] == 'cancelled'
        assert 'saving_results' not in result['progress']['completed_stages']
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        result = client.get(f'/api/projects/{pid}/discovery').json()
        assert result['status'] == 'cancelled' and result['clips'] == previous


def test_queued_discovery_can_cancel_without_calling_model(tmp_path):
    settings, engine, gate = Settings(data_dir=tmp_path), FakeOllama(), threading.Event()
    with TestClient(create_app(settings, NoTranscription(), engine)) as client:
        pid, _ = save_project(client, settings)
        client.app.state.jobs.pool.submit(gate.wait, 5)
        try:
            client.post(f'/api/projects/{pid}/discovery')
            assert client.get(f'/api/projects/{pid}/discovery').json()['status'] == 'queued'
            cancelled = client.post(f'/api/projects/{pid}/discovery/cancel').json()
            assert cancelled['status'] == 'cancelled' and not engine.calls
            assert client.delete(f'/api/projects/{pid}').status_code == 200
        finally:
            gate.set()


@pytest.mark.parametrize('start,end', [(-1, 40), (0, 29), (0, 61), (60, 110), (float('nan'), 40), (10, float('inf'))])
def test_final_validation_rejects_invalid_ranges(start, end):
    assert not valid_candidate({'start': start, 'end': end}, 100, DiscoveryOptions())


def test_prompt_contains_requested_preferences(monkeypatch):
    import httpx
    from app.services.ollama import Ollama
    from test_discovery import PASSAGES, assessment
    engine = Ollama(Settings())
    candidate = {'id': 'actual', 'excerpt': PASSAGES[0]}
    def respond(request):
        payload = json.loads(request.content)
        prompt = payload['messages'][0]['content']
        assert 'up to 2 distinct clips' in prompt and '20–40 seconds' in prompt
        assert 'never a quota' in prompt and payload['keep_alive'] == '5m'
        return httpx.Response(200, json={'message': {'content': json.dumps({'assessments': [assessment(candidate).model_dump()]})}})
    monkeypatch.setattr(engine, '_client', lambda timeout: httpx.Client(base_url=engine.settings.ollama_url, transport=httpx.MockTransport(respond)))
    assert engine.assess([candidate], preferences=DiscoveryOptions(clip_count=2, min_seconds=20, max_seconds=40))


def test_failure_before_discovery_starts_is_terminal(tmp_path):
    transcriber = NoTranscription()
    def fail():
        raise RuntimeError('release failed')
    with TestClient(create_app(Settings(data_dir=tmp_path), transcriber, FakeOllama())) as client:
        pid, _ = save_project(client, client.app.state.settings)
        transcriber.release = fail
        try:
            client.post(f'/api/projects/{pid}/discovery')
            result = wait_discovery(client, pid)
            assert result['status'] == 'failed' and 'could not start' in result['error']
        finally:
            transcriber.release = lambda: None


def test_educational_scoring_needs_no_hook_and_lower_confidence_is_bounded():
    from app.services.candidates import rank_candidates, quality_score, rejection_reasons
    from test_discovery import assessment, PASSAGES
    c = {'id': 'a', 'start': 0, 'end': 22, 'duration': 22, 'excerpt': PASSAGES[0]}
    calm = assessment(c, hook_strength=0, informational_value=3, context_completeness=3, clarity=3)
    assert quality_score(calm) == 60 and not rejection_reasons(calm)
    assert rank_candidates([c], [calm], 1)[0]['confidence'] == 'strong'
    partial = assessment(c, hook_strength=0, informational_value=2, context_completeness=2, clarity=3)
    partial.suitable = False
    assert not rank_candidates([c], [partial], 1)
    lower = rank_candidates([c], [partial], 1, allow_lower=True)
    assert len(lower) == 1 and lower[0]['confidence'] == 'lower' and lower[0]['score'] == 45
    assert 'model_suitable_false' in lower[0]['quality_rejections']
    partial.informational_value = 0
    assert not rank_candidates([c], [partial], 1, allow_lower=True)


def test_model_score_scale_and_decision_order():
    from app.models.discovery import Assessment
    from pydantic import ValidationError
    from test_discovery import assessment, PASSAGES
    a = assessment({'id': 'a', 'excerpt': PASSAGES[0]}).model_dump()
    a['informational_value'] = .8
    with pytest.raises(ValidationError): Assessment(**a)
    keys = list(Assessment.model_json_schema()['properties'])
    assert keys.index('evidence') < keys.index('suitable') and keys.index('clarity') < keys.index('suitable')
