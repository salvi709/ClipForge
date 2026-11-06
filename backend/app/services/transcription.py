import gc
import logging
import re
from pathlib import Path

from .media import ProcessingError, Cancelled, check_cancel
from .performance import measure
from ..core.cuda import configure_cuda
from .sentences import sentence_units

REQUIRED_MODEL_FILES = ('model.bin', 'config.json', 'tokenizer.json')
logger = logging.getLogger(__name__)


def model_ready(path: Path):
    files = all((path / name).is_file() and (path / name).stat().st_size > 0 for name in REQUIRED_MODEL_FILES)
    vocabulary = any((path / name).is_file() and (path / name).stat().st_size > 0 for name in ('vocabulary.txt', 'vocabulary.json'))
    return files and vocabulary


def mark_uncertain(rows):
    """Keep raw recognition for inspection, but never rank obvious decoding failures."""
    for row in rows:
        confidence = sum(w['probability'] for w in row['words']) / max(1, len(row['words']))
        rate = len(row['text'].split()) / max(.1, row['end'] - row['start'])
        row['uncertain_reason'] = None
        if row.get('avg_logprob', 0) < -1 or row['words'] and confidence < .4:
            row['uncertain_reason'] = 'Low recognition confidence'
        elif row.get('compression_ratio', 0) > 2.4 or len(row['text'].split()) >= 6 and rate > 7:
            row['uncertain_reason'] = 'Repetitive or implausibly dense recognition'
    index = 0
    while index < len(rows):
        end = index + 1
        normalized = re.sub(r'\W+', ' ', rows[index]['text'].lower()).strip()
        while end < len(rows) and re.sub(r'\W+', ' ', rows[end]['text'].lower()).strip() == normalized and rows[end]['start'] - rows[end - 1]['end'] < 2:
            end += 1
        if end - index >= 3:
            for row in rows[index:end]:
                row['uncertain_reason'] = 'Repeated recognition; review the original audio'
        index = end
    return [{'start': r['start'], 'end': r['end'], 'reason': r['uncertain_reason']} for r in rows if r['uncertain_reason']]


class Transcriber:
    """Frontend-independent engine; one worker owns its model instance."""
    def __init__(self, settings):
        self.settings = settings
        self.model = None
        self.device = None
        self.warning = None
        self.active_path = settings.model_path
        self.gpu_failure = None
        self.progress = lambda **event: None
        self.cancel = None

    def _load(self, device):
        configure_cuda(self.settings)
        from faster_whisper import WhisperModel
        self.model = WhisperModel(str(self.active_path), device=device,
                                  compute_type='float16' if device == 'cuda' else 'int8',
                                  cpu_threads=self.settings.cpu_threads, local_files_only=True)
        self.device = device

    def release(self):
        self.model = None
        self.device = None
        self.warning = None
        gc.collect()

    def transcribe(self, audio, on_warning, language='auto', quality='fast', on_progress=None, cancel=None, project_id=None):
        self.progress = on_progress or (lambda **event: None)
        self.cancel = cancel
        timings = {}
        check_cancel(cancel)
        reused = self.model is not None
        warned = False

        def warn_once(message):
            nonlocal warned
            self.warning = message
            if not warned:
                on_warning(message)
                warned = True

        path = self.settings.quality_model_path if quality == 'accurate' else self.settings.model_path
        if self.model is not None and self.active_path != path:
            self.release()
            reused = False
        self.active_path = path
        if not model_ready(path):
            if quality == 'accurate':
                raise ProcessingError('Quality model is missing. Run: python scripts/download_model.py --model small (setup only), then retry.')
            raise ProcessingError('Local Whisper model is missing or incomplete. Run: python scripts/download_model.py --model base (internet needed for setup only), then retry.')
        if self.model is None:
            device = 'cpu'
            self.progress(status='loading_model', model=path.name)
            if self.gpu_failure:
                self.warning = self.gpu_failure
            if self.settings.device != 'cpu' and not self.gpu_failure:
                try:
                    with measure(timings, 'gpu_detection', project_id):
                        configure_cuda(self.settings)
                        import ctranslate2
                        if ctranslate2.get_cuda_device_count() > 0:
                            device = 'cuda'
                        else:
                            self.warning = 'CUDA is unavailable. Processing on CPU.'
                except Exception:
                    logger.warning('CUDA detection failed', exc_info=True)
                    self.warning = 'CUDA detection failed. Processing on CPU.'
            try:
                with measure(timings, f'{device}_model_load', project_id):
                    self._load(device)
            except Exception as error:
                if device != 'cuda':
                    raise ProcessingError('Could not load the local model on CPU. Check model files and backend dependencies.') from None
                logger.warning('GPU initialization failed; retrying on CPU', exc_info=True)
                self.warning = self._fallback_warning(error, 'initialization')
                self.gpu_failure = self.warning
                self.model = None
                gc.collect()
                with measure(timings, 'cpu_model_load', project_id):
                    self._load('cpu')
        if self.warning:
            warn_once(self.warning)
        try:
            check_cancel(cancel)
            self.progress(status='transcribing', device=self.device, compute_type='float16' if self.device == 'cuda' else 'int8', model=path.name, model_reused=reused)
            with measure(timings, f'{self.device}_inference', project_id):
                result = self._run(audio, language, quality)
        except Cancelled:
            raise
        except Exception as error:
            if self.device != 'cuda':
                raise
            logger.warning('GPU inference failed; retrying on CPU', exc_info=True)
            warn_once(self._fallback_warning(error, 'transcription'))
            self.gpu_failure = self.warning
            check_cancel(cancel)
            self.model = None
            gc.collect()
            self.progress(status='loading_model', device='cpu', compute_type='int8', processed_seconds=0)
            with measure(timings, 'cpu_fallback_load', project_id):
                self._load('cpu')
            check_cancel(cancel)
            self.progress(status='transcribing', device='cpu', compute_type='int8')
            with measure(timings, 'cpu_inference', project_id):
                result = self._run(audio, language, quality)
        result['performance'] = {'timings': timings, 'model_reused': reused,
                                 'compute_type': 'float16' if self.device == 'cuda' else 'int8'}
        self.progress(timings=timings, model_reused=reused)
        return result

    @staticmethod
    def _fallback_warning(error, stage):
        # Expose only a DLL basename, never raw exception text containing file paths/audio.
        dll = re.search(r'\b[a-zA-Z0-9_]+\.dll\b', str(error))
        detail = f" {dll.group()} could not be loaded." if dll else ' See backend logs for the GPU exception.'
        return f'GPU {stage} failed. Using CPU fallback.{detail}'

    def _run(self, audio, language, quality):
        segments, info = self.model.transcribe(
            str(audio), language=None if language == 'auto' else 'en', beam_size=5,
            word_timestamps=True, vad_filter=True,
            vad_parameters={'threshold': .55, 'min_speech_duration_ms': 250, 'min_silence_duration_ms': 500, 'speech_pad_ms': 250},
            condition_on_previous_text=False, temperature=0, no_speech_threshold=.6,
            log_prob_threshold=-1.0, compression_ratio_threshold=2.4, hallucination_silence_threshold=1.0,
        )
        rows = []
        for segment in segments:
            check_cancel(self.cancel)
            rows.append({'id': segment.id, 'start': segment.start, 'end': segment.end, 'text': segment.text.strip(),
                 'avg_logprob': getattr(segment, 'avg_logprob', 0), 'compression_ratio': getattr(segment, 'compression_ratio', 0),
                 'words': [{'start': word.start, 'end': word.end, 'word': word.word, 'probability': word.probability}
                           for word in (segment.words or [])]})
            self.progress(processed_seconds=min(segment.end, info.duration), total_seconds=info.duration)
        check_cancel(self.cancel)
        uncertain = mark_uncertain(rows)
        result = {'schema_version': 2, 'language': info.language, 'language_probability': info.language_probability,
                  'duration': info.duration, 'device': self.device, 'segments': rows, 'uncertain_ranges': uncertain,
                  'transcription_options': {'language': language, 'quality': quality, 'model': self.active_path.name,
                                            'vad': 'conservative-v2', 'condition_on_previous_text': False}}
        result['sentences'] = sentence_units(result, info.duration)
        logger.info('Transcription completed using %s (%s)', self.device, self.active_path.name)
        return result
