import json
import logging
import threading
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .media import ProcessingError, Cancelled, check_cancel, extract, probe
from .performance import measure, record
from .transcription import Transcriber
from .discovery import Discovery
from .deletion import DeletionError, remove_project_files
from .content_profiler import ContentProfiler
from .audio_analyzer import AudioAnalyzer
from .scene_analyzer import SceneAnalyzer
from ..models.discovery import DiscoveryOptions

logger = logging.getLogger(__name__)


class Jobs:
    def __init__(self, settings, store, transcriber=None, ollama=None):
        self.settings, self.store = settings, store
        self.transcriber = transcriber or Transcriber(settings)
        self.profiler = ContentProfiler()
        self.audio_analyzer = AudioAnalyzer(settings.ffmpeg)
        self.scene_analyzer = SceneAnalyzer(settings.ffmpeg)
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='clipforge')
        self.lock = threading.Lock()
        self.pending = set()
        self.cancellations = {}
        self.futures = {}
        self.discovery_cancellations = {}
        self.discovery_futures = {}
        self.discovery = Discovery(settings, store, ollama)

    def _project(self, project_id):
        row = self.store.get(project_id)
        if not row:
            raise KeyError('Project not found')
        if row['status'] in {'deleting', 'deletion_failed'}:
            raise ProcessingError('Project deletion is pending. Retry Delete Project before doing further work.')
        return row

    def delete(self, project_id):
        # Same lock as every job submission: no new work can race file removal.
        with self.lock:
            row = self.store.get(project_id)
            if not row:
                raise KeyError('Project not found')
            if project_id in self.pending or row['status'] in {'waiting', 'preparing', 'queued', 'extracting', 'loading_model', 'transcribing', 'saving'}:
                raise ProcessingError('This project is processing. Wait for transcription or clip discovery to finish before deleting it.')
            self.store.update(project_id, status='deleting', error=None)
            try:
                remove_project_files(self.settings, row, self.store.discovery(project_id))
                self.store.delete(project_id)
            except (OSError, sqlite3.Error, DeletionError) as error:
                logger.warning('Project deletion incomplete for %s (%s)', project_id, type(error).__name__)
                message = str(error) if isinstance(error, DeletionError) else 'Deletion incomplete. Local files or database records may remain. Close any video players or file locks, check storage permissions, then retry Delete Project.'
                self.store.update(project_id, status='deletion_failed', error=message)
                raise DeletionError(message) from None

    def submit(self, project_id, options=None):
        with self.lock:
            if project_id in self.pending:
                if options is not None:
                    raise ProcessingError('This project is already processing. Wait for it to finish.')
                return
            row = self._project(project_id)
            if options is None and row['status'] == 'completed' and row['transcript_path']:
                try:
                    cached = json.loads(Path(row['transcript_path']).read_text(encoding='utf-8'))
                    if isinstance(cached.get('segments'), list) and cached.get('project_id') == project_id:
                        return
                except (OSError, ValueError, AttributeError):
                    pass
            self.pending.add(project_id)
            self.cancellations[project_id] = threading.Event()
            previous = json.loads(row.get('processing') or '{}')
            self.store.update(project_id, status='queued', error=None, warning=None, processing={'queued_at': time.time(), 'upload_seconds': previous.get('upload_seconds')}, **(options or {}))
            self.futures[project_id] = self.pool.submit(self._run, project_id)

    def submit_discovery(self, project_id, options=None):
        options = options or DiscoveryOptions()
        with self.lock:
            if project_id in self.pending:
                state = self.store.discovery(project_id)
                if project_id in self.discovery_cancellations and json.loads(state.get('settings_json') or '{}') == options.model_dump():
                    return
                raise ProcessingError('This project is already processing. Wait or cancel before changing discovery settings.')
            row = self._project(project_id)
            if row['status'] != 'completed':
                raise ProcessingError('Complete transcription before finding clips.')
            duration = json.loads(row['metadata'])['duration']
            if duration < options.min_seconds:
                raise ValueError(f'This video is {duration:.1f}s long, shorter than the {options.min_seconds:g}s minimum. Choose a shorter duration.')
            try:
                fingerprint = self.discovery.fingerprint(Path(row['transcript_path']).read_bytes(), options)
            except OSError:
                raise ProcessingError('The saved transcript is missing. Re-transcribe before finding clips.') from None
            state = self.store.discovery(project_id)
            if state and state['fingerprint'] == fingerprint and self.discovery.result(project_id)['status'] == 'completed':
                return
            self.pending.add(project_id)
            self.discovery_cancellations[project_id] = threading.Event()
            self.store.update_discovery(project_id, status='queued', error=None, evaluated=0, total=0,
                settings_json=options.model_dump_json(), progress_json=json.dumps({'queued_at': time.time(), 'stage': 'queued'}))
            self.discovery_futures[project_id] = self.pool.submit(self._discover, project_id, options)

    def _discover(self, project_id, options):
        try:
            self.transcriber.release()
            self.discovery.run(project_id, options, self.discovery_cancellations[project_id].is_set, self.lock)
        except Exception:
            logger.exception('Could not start discovery for project %s', project_id)
            self.store.update_discovery(project_id, status='failed', error='The local engine could not start clip discovery. Check backend logs and retry.')
        finally:
            with self.lock:
                self.pending.discard(project_id)
                self.discovery_cancellations.pop(project_id, None)
                self.discovery_futures.pop(project_id, None)

    def cancel_discovery(self, project_id):
        with self.lock:
            self._project(project_id)
            event = self.discovery_cancellations.get(project_id)
            if event is None:
                return
            state = self.store.discovery(project_id)
            if state['status'] in {'completed', 'failed', 'cancelled'}:
                return
            if state['status'] == 'saving_results':
                raise ProcessingError('Results are being committed. Wait for saving to finish.')
            event.set()
            data = json.loads(state.get('progress_json') or '{}')
            data['cancel_requested'] = True
            if self.discovery_futures[project_id].cancel():
                data.update(stage='cancelled', finished_at=time.time())
                self.store.update_discovery(project_id, status='cancelled', error=None, progress_json=json.dumps(data))
                self.pending.discard(project_id)
                self.discovery_cancellations.pop(project_id, None)
                self.discovery_futures.pop(project_id, None)
            else:
                self.store.update_discovery(project_id, progress_json=json.dumps(data))

    def cancel(self, project_id):
        with self.lock:
            row = self._project(project_id)
            event = self.cancellations.get(project_id)
            if event is None:
                if row['status'] in {'completed', 'failed', 'cancelled'}:
                    return
                raise ProcessingError('This operation cannot be cancelled here.')
            if row['status'] == 'saving':
                raise ProcessingError('The transcript is being committed. Wait for saving to finish.')
            event.set()
            if self.futures[project_id].cancel():
                self.store.update(project_id, status='cancelled', error=None)
                self.pending.discard(project_id)
                self.cancellations.pop(project_id, None)
                self.futures.pop(project_id, None)

    def _run(self, project_id):
        started = time.perf_counter()
        row = self.store.get(project_id)
        source = Path(row['source_path'])
        audio, temporary = source.parent / 'audio.wav', source.parent / 'transcript.tmp'
        event = self.cancellations[project_id]
        stopped, progress_lock = threading.Event(), threading.Lock()
        data = json.loads(row.get('processing') or '{}')
        data.update(started_at=time.time(), processed_seconds=0, timings={})
        timings = data['timings']
        last_write = [0.0]

        def progress(**values):
            with progress_lock:
                status = values.pop('status', None)
                if 'timings' in values:
                    timings.update(values.pop('timings'))
                data.update(values)
                if 'processed_seconds' in values:
                    data['last_progress_at'] = time.time()
                now = time.perf_counter()
                if not status and now - last_write[0] < .5:
                    return
                data.update(elapsed_seconds=round(now-started, 2), heartbeat_at=time.time(), cancel_requested=event.is_set())
                self.store.update(project_id, processing=data, **({'status': status} if status else {}))
                last_write[0] = now

        def heartbeat():
            while not stopped.wait(2):
                progress()

        monitor = threading.Thread(target=heartbeat, daemon=True)
        monitor.start()
        try:
            check_cancel(event.is_set)
            progress(status='extracting')
            with measure(timings, 'probe', project_id):
                metadata = probe(source, self.settings.ffprobe)
            self.store.update(project_id, metadata=metadata)
            progress(total_seconds=metadata['duration'])
            with measure(timings, 'audio_extraction', project_id):
                extract(source, audio, self.settings.ffmpeg, cancel=event.is_set)
            check_cancel(event.is_set)
            progress(status='loading_model')
            with measure(timings, 'transcription', project_id):
                result = self.transcriber.transcribe(audio, lambda warning: self.store.update(project_id, warning=warning),
                    language=row['language'], quality=row['quality'], on_progress=progress, cancel=event.is_set, project_id=project_id)
            # Serialize the final cancellation check with Cancel requests.
            with self.lock:
                check_cancel(event.is_set)
                progress(status='saving')
            result['project_id'] = project_id
            with measure(timings, 'transcript_save', project_id):
                temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
                temporary.replace(source.parent / 'transcript.json')
            
            # Generate content profile after transcription
            try:
                with measure(timings, 'content_profiling', project_id):
                    profile = self.profiler.profile(result, metadata)
                    self.store.update(project_id, 
                                    content_profile=profile.to_dict(),
                                    detected_category=profile.primary_category,
                                    category_confidence=str(round(profile.confidence, 3)))
                    logger.info('Content profile saved: %s (%.2f confidence)', 
                              profile.primary_category, profile.confidence)
            except Exception:
                # Content profiling failure should not block transcription completion
                logger.warning('Content profiling failed for project %s', project_id, exc_info=True)
            
            # Audio and scene analysis for enhanced discovery
            audio_analysis, scene_analysis = {}, {}
            try:
                with measure(timings, 'audio_analysis', project_id):
                    audio_analysis = self.audio_analyzer.analyze(source, metadata['duration'])
                    logger.info('Audio analysis: %d speech regions, %d silence periods',
                              len(audio_analysis.get('speech_regions', [])),
                              len(audio_analysis.get('silence_periods', [])))
            except Exception:
                logger.warning('Audio analysis failed for project %s', project_id, exc_info=True)
            
            try:
                with measure(timings, 'scene_analysis', project_id):
                    scene_analysis = self.scene_analyzer.analyze(source, metadata['duration'])
                    logger.info('Scene analysis: %d scene changes detected',
                              len(scene_analysis.get('scene_changes', [])))
            except Exception:
                logger.warning('Scene analysis failed for project %s', project_id, exc_info=True)
            
            # Store analysis results in metadata
            enhanced_metadata = metadata.copy()
            if audio_analysis:
                enhanced_metadata['audio_analysis'] = audio_analysis
            if scene_analysis:
                enhanced_metadata['scene_analysis'] = scene_analysis
            self.store.update(project_id, metadata=enhanced_metadata)
            
            with measure(timings, 'database_save', project_id):
                self.store.invalidate_discovery(project_id)
                self.store.update(project_id, transcript_path=str(source.parent / 'transcript.json'), error=None)
            timings['total_processing'] = round(time.perf_counter()-started, 4)
            progress(status='completed', finished_at=time.time(), device=result.get('device'), processed_seconds=metadata['duration'])
        except Cancelled:
            progress(status='cancelled', finished_at=time.time())
        except Exception as error:
            self.transcriber.release()
            message = str(error) if isinstance(error, ProcessingError) else 'Local processing failed. Check backend logs and retry.'
            logger.exception('Processing failed for project %s', project_id)
            self.store.update(project_id, error=message)
            progress(status='failed', finished_at=time.time())
        finally:
            stopped.set()
            monitor.join()
            record(project_id, 'total_processing', time.perf_counter()-started)
            for path in (audio, temporary):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    logger.warning('Could not remove temporary artifact for %s', project_id)
            with self.lock:
                self.pending.discard(project_id)
                self.cancellations.pop(project_id, None)
                self.futures.pop(project_id, None)

    def shutdown(self):
        for event in [*self.cancellations.values(), *self.discovery_cancellations.values()]:
            event.set()
        self.pool.shutdown(wait=True)
        self.transcriber.release()
