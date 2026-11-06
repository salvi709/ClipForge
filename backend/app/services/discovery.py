import hashlib
import json
import logging
import threading
import time
from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from ..models.discovery import DiscoveryOptions
from .candidates import ALGORITHM_VERSION, WEIGHTS, rank_candidates, valid_candidate, topic_groups, quality_score, rejection_reasons
from .enhanced_candidates import build_enhanced_candidates
from .media import ProcessingError, Cancelled, check_cancel
from .ollama import Ollama
from .sentences import excerpt_for_range, sentence_units
from .discovery_strategies import adjust_candidate_priorities

logger = logging.getLogger(__name__)
ACTIVE_STATES = {'queued', 'preparing_transcript', 'analyzing_topics', 'generating_candidates',
                 'validating_timestamps', 'evaluating_candidates', 'ranking_clips', 'saving_results'}


class Discovery:
    def __init__(self, settings, store, ollama=None):
        self.settings, self.store = settings, store
        self.ollama = ollama or Ollama(settings)

    def fingerprint(self, transcript_bytes, options=None):
        options = options or DiscoveryOptions()
        settings = {'algorithm': ALGORITHM_VERSION, 'model': self.settings.ollama_model,
                    **options.model_dump(), 'candidates': self.settings.clip_max_candidates}
        return hashlib.sha256(transcript_bytes + json.dumps(settings, sort_keys=True).encode()).hexdigest()

    def result(self, project_id):
        state = self.store.discovery(project_id)
        if not state:
            return {'status': 'idle', 'clips': [], 'error': None, 'evaluated': 0, 'total': 0,
                    'model': self.settings.ollama_model, 'settings': DiscoveryOptions().model_dump()}
        public = {key: value for key, value in state.items()
                  if key not in {'result_path', 'result_json', 'fingerprint', 'settings_json', 'progress_json'}}
        public.update(model=self.settings.ollama_model, clips=[],
                      settings=json.loads(state.get('settings_json') or 'null'),
                      progress=json.loads(state.get('progress_json') or '{}'))
        error = state.get('error') or ''
        if state['status'] == 'failed' and error.startswith('Local model missing. Run: ollama pull ') and f'ollama pull {self.settings.ollama_model} ' not in error:
            return {**public, 'status': 'stale', 'error': None,
                    'message': f'The configured model is now {self.settings.ollama_model}. Find Best Clips again to retry.'}
        if not state.get('result_json') and not state.get('result_path'):
            return public
        project = self.store.get(project_id)
        try:
            source = Path(project['transcript_path']).read_bytes()
            result = json.loads(state.get('result_json') or Path(state['result_path']).read_text(encoding='utf-8'))
            if not isinstance(result['clips'], list):
                raise ValueError('Invalid saved discovery')
            if hashlib.sha256(source).hexdigest() != result['transcript_sha256']:
                return {**public, 'status': 'stale', 'message': 'Transcript changed. Find Best Clips again.'}
            transcript = json.loads(source)
            edits = self.store.edits(project_id)
            for clip in result['clips']:
                if clip['id'] in edits:
                    clip.update({key: edits[clip['id']][key] for key in ('start', 'end')})
                    clip['duration'] = round(clip['end'] - clip['start'], 3)
                    clip['adjusted'] = clip['start'] != clip['original_start'] or clip['end'] != clip['original_end']
                    clip['excerpt'] = excerpt_for_range(transcript, clip['start'], clip['end'])
            saved = {key: value for key, value in result.items() if key not in {'fingerprint', 'assessments', 'settings'}}
            return {**saved, **public, 'clips': result['clips'], 'result_settings': result.get('settings'),
                    'previous_result': state['status'] != 'completed',
                    'message': result.get('message') if state['status'] == 'completed' else None}
        except (OSError, ValueError, TypeError, KeyError):
            if state['status'] in ACTIVE_STATES:
                return public
            return {**public, 'status': 'failed', 'error': 'Saved suggestions are missing or unreadable. Find Best Clips again.'}

    def run(self, project_id, options=None, cancel=None, commit_lock=None):
        options = options or DiscoveryOptions()
        started = time.perf_counter()
        state = self.store.discovery(project_id) or {}
        data = json.loads(state.get('progress_json') or '{}')
        data.update(started_at=time.time(), completed_stages=[], stage='queued')
        lock, stopped = threading.Lock(), threading.Event()
        temporary = None

        def progress(status=None, **values):
            with lock:
                previous = data['stage']
                if status and status != previous:
                    if previous in ACTIVE_STATES and status not in {'failed', 'cancelled'}:
                        data['completed_stages'].append(previous)
                    data['stage'] = status
                    data['stage_started_at'] = time.time()
                data.update(elapsed_seconds=round(time.perf_counter() - started, 2), heartbeat_at=time.time(),
                            cancel_requested=bool(cancel and cancel()))
                if status in {'completed', 'failed', 'cancelled'}:
                    data['finished_at'] = time.time()
                self.store.update_discovery(project_id, progress_json=json.dumps(data),
                    **({'status': status} if status else {}), **values)

        def heartbeat():
            while not stopped.wait(2):
                progress()

        monitor = threading.Thread(target=heartbeat, daemon=True)
        monitor.start()
        try:
            check_cancel(cancel)
            progress('preparing_transcript', error=None, evaluated=0, total=0, settings_json=options.model_dump_json())
            project = self.store.get(project_id)
            source = Path(project['transcript_path']).read_bytes()
            transcript = json.loads(source)
            metadata = json.loads(project['metadata'])
            duration = metadata['duration']
            
            # Get audio and scene analysis if available
            audio_analysis = metadata.get('audio_analysis', {})
            scene_analysis = metadata.get('scene_analysis', {})
            
            # Get detected content category for strategy selection
            category = project.get('user_category') or project.get('detected_category') or 'educational'
            logger.info('Discovery using %s strategy for project %s', category, project_id)
            logger.info('Enhanced discovery: audio_regions=%d scene_changes=%d',
                       len(audio_analysis.get('speech_regions', [])),
                       len(scene_analysis.get('scene_changes', [])))
            
            if duration < options.min_seconds:
                raise ProcessingError(f'This video is {duration:.1f}s long, shorter than the {options.min_seconds:g}s minimum. Choose a shorter duration.')
            units = sentence_units(transcript, duration)
            check_cancel(cancel)
            progress('analyzing_topics')
            groups = topic_groups(units)
            effective = replace(self.settings, clip_min_seconds=options.min_seconds, clip_max_seconds=options.max_seconds,
                                clip_max_results=options.clip_count)
            progress('generating_candidates')
            # Use enhanced candidate generation
            candidates, _ = build_enhanced_candidates(transcript, duration, effective,
                                                     audio_analysis=audio_analysis,
                                                     scene_analysis=scene_analysis,
                                                     units=units, groups=groups, cancel=cancel)
            
            # Apply category-specific priority adjustments
            for candidate in candidates:
                adjustment = adjust_candidate_priorities(category, candidate)
                if '_priority' not in candidate:
                    candidate['_priority'] = 0
                candidate['_priority'] += adjustment
            
            # Re-sort candidates by adjusted priority
            candidates.sort(key=lambda c: (-c.get('_priority', 0), c['start']))
            
            progress('validating_timestamps')
            valid = [c for c in candidates if valid_candidate(c, duration, options)]
            invalid_count = len(candidates) - len(valid)
            candidates = valid
            assessments, engine_status = [], {}
            if candidates:
                check_cancel(cancel)
                engine_status = self.ollama.status()
                if engine_status['status'] != 'ready':
                    raise ProcessingError(engine_status['message'])
                progress('evaluating_candidates', total=len(candidates))
                for offset, candidate in enumerate(candidates):
                    check_cancel(cancel)
                    assessments.extend(self.ollama.assess([candidate], preferences=options, cancel=cancel, category=category))
                    check_cancel(cancel)
                    progress(evaluated=offset + 1)
            check_cancel(cancel)
            progress('ranking_clips')
            clips = rank_candidates(candidates, assessments, options.clip_count, allow_lower=True)
            if not all(valid_candidate(c, duration, options) for c in clips):
                raise ProcessingError('Candidate timestamps failed final validation. No new suggestions were saved.')
            eligible = len(rank_candidates(candidates, assessments, len(candidates), deduplicate=False)) if candidates else 0
            strong = sum(c['confidence'] == 'strong' for c in clips)
            lower = len(clips) - strong
            message = f'Found {strong} strong {"clip" if strong == 1 else "clips"} out of {options.clip_count} requested.'
            if lower:
                message += f' Also showing {lower} lower-confidence suggestions for manual review; these did not pass the strong-clip criteria.' 
            if not units or sum(len(u['text'].split()) for u in units) < 18:
                message += ' No reliable clips: not enough meaningful timed speech. Review or re-transcribe the source.'
            elif not candidates:
                message += f' No reliable clips: no spoken passage fits {options.min_seconds:g}–{options.max_seconds:g}s without crossing uncertain speech or long gaps. Try a different duration range.'
            elif strong < options.clip_count:
                message += f' Assessed {len(candidates)} windows; {len(candidates) - eligible} did not meet quality thresholds.'
                if eligible > strong:
                    message += ' Overlapping or repetitive moments were also removed.'
                message += ' Try a different duration range or review transcription quality; the requested count is a target.'
            by_id = {a.candidate_id: a for a in assessments}
            selected = {c['id']: c['confidence'] for c in clips}
            audit = []
            for candidate in candidates:
                a = by_id[candidate['id']]
                entry = {'candidate_id': candidate['id'], 'start': candidate['start'], 'end': candidate['end'],
                         'duration': candidate['duration'], 'technical_failures': [],
                         'scores': {key: getattr(a, key) for key in WEIGHTS}, 'score': quality_score(a),
                         'quality_rejections': rejection_reasons(a, candidate), 'model_reason': a.reason,
                         'outcome': selected.get(candidate['id'], 'quality_rejected' if rejection_reasons(a, candidate) else 'overlap_or_count_limit')}
                audit.append(entry)
                logging.getLogger('uvicorn.error').info('clipforge.candidate %s', json.dumps({'project_id': project_id, **entry}))
            result = {'schema_version': 2, 'candidate_diagnostics': audit, 'algorithm_version': ALGORITHM_VERSION, 'fingerprint': self.fingerprint(source, options),
                      'settings': options.model_dump(), 'transcript_sha256': hashlib.sha256(source).hexdigest(),
                      'model': self.settings.ollama_model, 'model_digest': engine_status.get('digest'),
                      'created_at': datetime.now(timezone.utc).isoformat(), 'score_weights': WEIGHTS,
                      'score_label': 'Heuristic estimates, not guaranteed audience performance',
                      'candidate_count': len(candidates), 'topic_count': len(groups), 'clips': clips, 'message': message,
                      'diagnostics': {'invalid_timestamps': invalid_count, 'quality_rejected': len(candidates) - eligible,
                                      'quality_eligible': eligible, 'selected': len(clips), 'strong_returned': strong, 'lower_confidence_returned': lower},
                      'assessments': [a.model_dump() for a in assessments]}
            with commit_lock if commit_lock is not None else nullcontext():
                check_cancel(cancel)
                progress('saving_results')
            target = Path(project['source_path']).parent / 'clips.json'
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            temporary.replace(target)
            with lock:
                data['completed_stages'].append('saving_results')
                data.update(stage='completed', finished_at=time.time(), elapsed_seconds=round(time.perf_counter()-started, 2))
                self.store.complete_discovery(project_id, result, target, data)
            logger.info('Discovery %s: candidates=%s eligible=%s selected=%s', project_id, len(candidates), eligible, len(clips))
        except Cancelled:
            progress('cancelled', error=None)
        except ProcessingError as error:
            progress('failed', error=str(error))
        except Exception:
            logger.exception('Discovery failed for project %s', project_id)
            progress('failed', error='Clip discovery failed. Check the saved transcript and backend logs, then retry.')
        finally:
            stopped.set()
            monitor.join()
            if temporary:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    logger.warning('Could not remove discovery temporary artifact for %s', project_id)
