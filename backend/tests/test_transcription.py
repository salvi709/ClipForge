import sys
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.services.media import ProcessingError, extract, probe
from app.services.transcription import REQUIRED_MODEL_FILES, Transcriber, mark_uncertain


def test_missing_dependencies(tmp_path):
    with pytest.raises(ProcessingError, match='ffprobe is missing'):
        probe(tmp_path / 'video.mp4', 'clipforge-nonexistent-ffprobe')
    with pytest.raises(ProcessingError, match='FFmpeg is missing'):
        extract(tmp_path / 'video.mp4', tmp_path / 'audio.wav', 'clipforge-nonexistent-ffmpeg')
    engine = Transcriber(Settings(model_path=tmp_path / 'missing'))
    with pytest.raises(ProcessingError, match='Local Whisper model is missing'):
        engine.transcribe(tmp_path / 'audio.wav', lambda message: None)


@pytest.mark.parametrize('failure', ['initialization', 'inference'])
def test_gpu_fallback_is_local_and_retains_words(tmp_path, monkeypatch, failure):
    for name in (*REQUIRED_MODEL_FILES, 'vocabulary.txt'):
        (tmp_path / name).write_text('test')
    calls, warnings = [], []
    class Model:
        def __init__(self, path, **kwargs):
            calls.append(kwargs)
            self.device = kwargs['device']
            if self.device == 'cuda' and failure == 'initialization':
                raise RuntimeError('CUDA DLL unavailable')

        def transcribe(self, *args, **kwargs):
            def segments():
                if self.device == 'cuda':
                    yield SimpleNamespace(id=99, start=0, end=.5, text='partial GPU result', words=[])
                    raise RuntimeError('GPU out of memory during lazy iteration')
                yield SimpleNamespace(id=0, start=0, end=1, text=' Hello', words=[SimpleNamespace(start=0, end=1, word=' Hello', probability=.9)])
            return segments(), SimpleNamespace(language='en', language_probability=.99, duration=1)
    monkeypatch.setitem(sys.modules, 'ctranslate2', SimpleNamespace(get_cuda_device_count=lambda: 1))
    monkeypatch.setitem(sys.modules, 'faster_whisper', SimpleNamespace(WhisperModel=Model))
    engine = Transcriber(Settings(model_path=tmp_path))
    result = engine.transcribe(tmp_path / 'audio.wav', warnings.append)
    assert [call['device'] for call in calls] == ['cuda', 'cpu']
    assert all(call['local_files_only'] for call in calls)
    assert calls[-1]['compute_type'] == 'int8'
    assert len(warnings) == 1 and result['device'] == 'cpu'
    assert len(result['segments']) == 1 and result['segments'][0]['id'] == 0
    assert result['segments'][0]['words'][0]['start'] == 0


def test_english_options_and_conservative_vad(tmp_path):
    calls = []
    class Model:
        def transcribe(self, audio, **kwargs):
            calls.append(kwargs)
            return iter([]), SimpleNamespace(language='en', language_probability=1, duration=2)
    engine = Transcriber(Settings(model_path=tmp_path))
    engine.model, engine.device = Model(), 'cpu'
    result = engine._run(tmp_path / 'audio.wav', 'en', 'fast')
    assert calls[0]['language'] == 'en'
    assert calls[0]['vad_filter'] and calls[0]['vad_parameters']['min_silence_duration_ms'] == 500
    assert not calls[0]['condition_on_previous_text']
    assert result['segments'] == []  # no invented text for silence


def test_repetitive_recognition_is_flagged_without_inventing_words():
    rows = [{'start': i, 'end': i + .8, 'text': 'These are language models.', 'words': []} for i in range(4)]
    before = [row['text'] for row in rows]
    uncertain = mark_uncertain(rows)
    assert len(uncertain) == 4
    assert before == [row['text'] for row in rows]
    from app.services.sentences import sentence_units
    assert sentence_units({'segments': rows}, 5) == []
