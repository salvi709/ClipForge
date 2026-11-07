"""
Enhanced high-recall candidate generation for Discovery Intelligence V2.
Discovers moments throughout the entire video timeline with overlapping windows,
sentence boundary alignment, and audio/scene event integration.
"""
import hashlib
import logging
import math
import re
from typing import Dict, List, Tuple

from .sentences import sentence_units, excerpt_for_range
from .candidates import terms, topic_groups, TRANSITION

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = 'discovery-4.0-intelligence-v2'


def build_enhanced_candidates(transcript: Dict, duration: float, settings,
                             audio_analysis: Dict = None, scene_analysis: Dict = None,
                             units=None, groups=None, cancel=None) -> Tuple[List[Dict], List]:
    """
    Generate candidate pool across the entire video timeline for high recall.
    
    Guarantees:
    - Entire timeline is analyzed with overlapping windows
    - Preserves transcription uncertainty as metadata without discarding regions or hallucinating words
    - Snaps boundaries cleanly to sentence units
    - Avoids creating candidates with empty or meaningless speech
    - Integrates audio speech events and visual scene boundaries
    """
    from .media import check_cancel

    units = sentence_units(transcript, duration) if units is None else units
    if not units:
        return [], []

    total_words = sum(len(u.get('text', '').split()) for u in units)
    if total_words < 18 and duration > settings.clip_min_seconds:
        # Check if there is enough speech to form even one clip
        if total_words < 10:
            return [], []

    groups = topic_groups(units) if groups is None else groups
    topic_starts = {group[0]['id'] for group in groups}
    uncertain_ranges = transcript.get('uncertain_ranges', []) if transcript else []

    all_windows = {}

    # Target window durations to evaluate across the timeline
    min_dur = settings.clip_min_seconds
    max_dur = settings.clip_max_seconds
    mid_dur = (min_dur + max_dur) / 2.0
    targets = [min_dur, mid_dur, max_dur]

    # Source 1: Transcript-based sliding windows starting at every sentence
    for index, first in enumerate(units):
        check_cancel(cancel)
        selected = []
        remaining_targets = list(targets)
        has_uncertain = False
        matching_spans = []

        for unit in units[index:]:
            # Gap detection: pause > 3.0s between units suggests a scene or topic boundary
            if selected and unit['start'] - selected[-1]['end'] > 3.0:
                break

            # Check for uncertain speech spans overlapping this window
            for span in uncertain_ranges:
                if span['start'] < unit['end'] and span['end'] > first['start']:
                    has_uncertain = True
                    matching_spans.append(span)

            selected.append(unit)
            length = unit['end'] - first['start']

            if length > max_dur:
                break

            next_topic = (unit['id'] + 1 in topic_starts)
            at_target = bool(remaining_targets and length >= remaining_targets[0])
            is_complete = bool(unit.get('complete', False))

            if at_target or next_topic or unit == units[-1] or (is_complete and length >= min_dur):
                excerpt = ' '.join(item['text'] for item in selected).strip()
                word_count = len(excerpt.split())

                if min_dur <= length <= max_dur and word_count >= 18:
                    key = (round(first['start'], 3), round(unit['end'], 3))
                    priority = _calculate_candidate_priority(first, unit, selected, excerpt, topic_starts, has_uncertain)
                    all_windows[key] = {
                        'id': hashlib.sha256(f'{key[0]}:{key[1]}'.encode()).hexdigest()[:12],
                        'start': key[0],
                        'end': key[1],
                        'duration': round(length, 3),
                        'excerpt': excerpt,
                        'sentence_ids': [s['id'] for s in selected],
                        'duration_exception': False,
                        'has_uncertain_speech': has_uncertain,
                        'uncertain_spans': matching_spans,
                        'source': 'transcript',
                        'audio_score': 85.0 if not has_uncertain else 70.0,
                        'visual_score': 75.0,
                        '_priority': priority,
                    }

                while remaining_targets and length >= remaining_targets[0]:
                    remaining_targets.pop(0)

            if length >= max_dur:
                break

    # Source 2: Timeline-wide overlapping windows snapped to sentence boundaries
    # Step across timeline with 50% overlap to ensure ZERO gaps between adjacent analysis windows
    step = max(min_dur * 0.5, 10.0)
    current_time = 0.0

    while current_time + min_dur <= duration:
        check_cancel(cancel)
        window_end_target = min(current_time + max_dur, duration)
        
        # Find sentence units overlapping [current_time, window_end_target]
        overlapping_units = [
            u for u in units
            if u['end'] > current_time and u['start'] < window_end_target
        ]

        if overlapping_units:
            # Snap start to first unit start, end to last unit end
            snap_start = overlapping_units[0]['start']
            snap_end = overlapping_units[-1]['end']
            snap_dur = snap_end - snap_start

            # If snapped duration is within [min_dur, max_dur] and has sufficient words
            if min_dur <= snap_dur <= max_dur:
                excerpt = ' '.join(u['text'] for u in overlapping_units).strip()
                if len(excerpt.split()) >= 18:
                    key = (round(snap_start, 3), round(snap_end, 3))
                    if key not in all_windows:
                        has_uncertain = any(
                            span['start'] < snap_end and span['end'] > snap_start
                            for span in uncertain_ranges
                        )
                        priority = _calculate_candidate_priority(
                            overlapping_units[0], overlapping_units[-1], overlapping_units,
                            excerpt, topic_starts, has_uncertain
                        )
                        all_windows[key] = {
                            'id': hashlib.sha256(f'{key[0]}:{key[1]}'.encode()).hexdigest()[:12],
                            'start': key[0],
                            'end': key[1],
                            'duration': round(snap_dur, 3),
                            'excerpt': excerpt,
                            'sentence_ids': [u['id'] for u in overlapping_units],
                            'duration_exception': False,
                            'has_uncertain_speech': has_uncertain,
                            'source': 'timeline_window',
                            'audio_score': 80.0,
                            'visual_score': 75.0,
                            '_priority': priority,
                        }

        current_time += step

    # Source 3: Audio event integration (speech regions & volume peaks)
    if audio_analysis and audio_analysis.get('speech_regions'):
        for region in audio_analysis['speech_regions']:
            check_cancel(cancel)
            r_start, r_end = region['start'], region['end']
            # Find sentence units in this speech region
            in_region = [u for u in units if u['start'] >= r_start - 1.0 and u['end'] <= r_end + 1.0]
            if in_region:
                s_start = in_region[0]['start']
                s_end = in_region[-1]['end']
                s_dur = s_end - s_start
                if min_dur <= s_dur <= max_dur:
                    excerpt = ' '.join(u['text'] for u in in_region).strip()
                    if len(excerpt.split()) >= 18:
                        key = (round(s_start, 3), round(s_end, 3))
                        if key not in all_windows:
                            all_windows[key] = {
                                'id': hashlib.sha256(f'{key[0]}:{key[1]}'.encode()).hexdigest()[:12],
                                'start': key[0],
                                'end': key[1],
                                'duration': round(s_dur, 3),
                                'excerpt': excerpt,
                                'sentence_ids': [u['id'] for u in in_region],
                                'duration_exception': False,
                                'has_uncertain_speech': False,
                                'source': 'audio_event',
                                'audio_score': 92.0,
                                'visual_score': 75.0,
                                '_priority': 2,
                            }

    # Source 4: Visual scene change integration
    if scene_analysis and scene_analysis.get('scene_changes'):
        scene_timestamps = [sc['timestamp'] for sc in scene_analysis['scene_changes']]
        for sc_time in scene_timestamps:
            # Check windows that begin or end near this scene change
            for key, cand in list(all_windows.items()):
                if abs(cand['start'] - sc_time) < 1.5 or abs(cand['end'] - sc_time) < 1.5:
                    cand['visual_score'] = 90.0
                    cand['scene_aligned'] = True

    candidates = list(all_windows.values())
    if not candidates:
        return [], groups

    # Distribute candidates evenly across the entire video timeline within budget
    budget = getattr(settings, 'clip_max_candidates', 24)
    selected_candidates = _distribute_across_timeline(candidates, duration, budget)

    return sorted(selected_candidates, key=lambda c: c['start']), groups


def _calculate_candidate_priority(first_unit, last_unit, selected_units, excerpt, topic_starts, has_uncertain):
    """Compute candidate priority heuristic before LLM evaluation."""
    priority = (2 if first_unit['id'] in topic_starts else 0) + (2 if last_unit.get('complete', False) else 0)
    priority += int(bool(re.search(r'\b(example|means|because|understand|why|how|learn|model|important|solution|result)\b', excerpt, re.I)))
    priority += int(bool(TRANSITION.search(first_unit['text'])))
    priority += 2 * int(bool(re.search(r'\b(that is (?:how|why)|therefore|in summary|in short|as a result)\b', last_unit['text'], re.I)))
    priority -= 2 * int(last_unit['text'].rstrip().endswith('?'))
    if has_uncertain:
        priority -= 1
    return priority


def _distribute_across_timeline(candidates: List[Dict], duration: float, budget: int) -> List[Dict]:
    """
    Distribute the bounded assessment budget across the full timeline,
    ensuring beginning, middle, and end all receive candidate opportunities.
    """
    # Create temporal buckets proportional to video length (at least 6 buckets)
    num_buckets = max(6, min(12, int(duration / 30.0)))
    buckets = [[] for _ in range(num_buckets)]

    for cand in candidates:
        bucket_idx = min(num_buckets - 1, int(cand['start'] / max(1.0, duration) * num_buckets))
        buckets[bucket_idx].append(cand)

    # Sort candidates inside each bucket by priority
    for b in buckets:
        b.sort(key=lambda c: (-c.get('_priority', 0), c['start']))

    selected = []
    used_starts = set()

    while any(buckets) and len(selected) < budget:
        for b in buckets:
            if b and len(selected) < budget:
                # Prefer distinct sentence starts before nearly identical overlapping windows
                idx = next((i for i, item in enumerate(b) if item['start'] not in used_starts), 0)
                cand = b.pop(idx)
                used_starts.add(cand['start'])
                cand.pop('_priority', None)
                selected.append(cand)

    return selected
