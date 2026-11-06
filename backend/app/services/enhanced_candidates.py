"""
Enhanced high-recall candidate generation using multiple sources.
Combines transcript, audio events, scene boundaries, and overlapping windows.
"""
import hashlib
import logging
import re
from typing import Dict, List, Tuple, Set

from .sentences import sentence_units
from .candidates import terms, topic_groups, STOPWORDS, TRANSITION

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = 'discovery-4.0-high-recall'


def build_enhanced_candidates(transcript: Dict, duration: float, settings,
                             audio_analysis: Dict = None, scene_analysis: Dict = None,
                             units=None, groups=None, cancel=None) -> Tuple[List[Dict], List]:
    """
    Generate candidates using multiple sources for high recall.
    
    Sources:
    1. Transcript-based windows (original method)
    2. Audio event boundaries (speech regions, silence gaps)
    3. Scene change boundaries
    4. Fixed overlapping windows
    
    Args:
        transcript: Parsed transcript with segments
        duration: Video duration
        settings: Discovery settings
        audio_analysis: Optional audio analysis results
        scene_analysis: Optional scene analysis results
        units: Pre-computed sentence units
        groups: Pre-computed topic groups
        cancel: Cancellation callback
    
    Returns:
        (candidates, topic_groups)
    """
    from .media import check_cancel
    
    units = sentence_units(transcript, duration) if units is None else units
    groups = topic_groups(units) if groups is None else groups
    
    # Track all candidate windows
    all_windows = {}
    
    # Source 1: Transcript-based candidates (original method, but DON'T reject uncertain ranges)
    transcript_candidates = _build_transcript_candidates(
        transcript, duration, settings, units, groups, cancel
    )
    for cand in transcript_candidates:
        key = (cand['start'], cand['end'])
        all_windows[key] = cand
    
    logger.info('Generated %d transcript-based candidates', len(transcript_candidates))
    
    # Source 2: Audio event candidates (if available)
    if audio_analysis and audio_analysis.get('speech_regions'):
        audio_candidates = _build_audio_candidates(
            audio_analysis, settings.clip_min_seconds, settings.clip_max_seconds
        )
        new_count = 0
        for start, end in audio_candidates:
            key = (start, end)
            if key not in all_windows:
                all_windows[key] = _create_candidate(start, end, transcript, units, source='audio')
                new_count += 1
        
        logger.info('Generated %d audio-based candidates (%d new)', len(audio_candidates), new_count)
    
    # Source 3: Scene-based candidates (if available)
    if scene_analysis and scene_analysis.get('scene_changes'):
        scene_candidates = _build_scene_candidates(
            scene_analysis, duration, settings.clip_min_seconds, settings.clip_max_seconds
        )
        new_count = 0
        for start, end in scene_candidates:
            key = (start, end)
            if key not in all_windows:
                all_windows[key] = _create_candidate(start, end, transcript, units, source='scene')
                new_count += 1
        
        logger.info('Generated %d scene-based candidates (%d new)', len(scene_candidates), new_count)
    
    # Source 4: Fixed overlapping windows for comprehensive coverage (only if we don't have enough candidates yet)
    if len(all_windows) < settings.clip_max_candidates:
        fixed_candidates = _build_fixed_windows(
            duration, settings.clip_min_seconds, settings.clip_max_seconds
        )
        new_count = 0
        for start, end in fixed_candidates:
            key = (start, end)
            if key not in all_windows:
                all_windows[key] = _create_candidate(start, end, transcript, units, source='fixed')
                new_count += 1
                if len(all_windows) >= settings.clip_max_candidates * 1.5:  # Don't generate too many
                    break
        
        logger.info('Generated %d fixed-window candidates (%d new)', len(fixed_candidates), new_count)
    
    # Convert to list and prioritize
    candidates = list(all_windows.values())
    
    # Prioritize candidates with stronger evidence
    for candidate in candidates:
        _calculate_priority(candidate, transcript, units, groups)
    
    # Sort by priority and temporal distribution
    candidates = _distribute_candidates(candidates, duration, settings.clip_max_candidates)
    
    logger.info('Total candidates after merging: %d (budget: %d)',
               len(candidates), settings.clip_max_candidates)
    
    return candidates, groups


def _build_transcript_candidates(transcript, duration, settings, units, groups, cancel):
    """Build candidates from transcript (original method, enhanced to handle uncertainty)."""
    from .media import check_cancel
    
    if not units:
        return []
    
    topic_starts = {group[0]['id'] for group in groups}
    windows = {}
    targets = (settings.clip_min_seconds, (settings.clip_min_seconds + settings.clip_max_seconds) / 2, settings.clip_max_seconds)
    uncertain_ranges = transcript.get('uncertain_ranges', [])
    
    for index, first in enumerate(units):
        check_cancel(cancel)
        selected = []
        remaining_targets = list(targets)
        has_uncertain = False
        
        for unit in units[index:]:
            if selected and unit['start'] - selected[-1]['end'] > 3:
                break
            
            # Check for uncertain speech but DON'T automatically reject
            for span in uncertain_ranges:
                if span['start'] < unit['end'] and span['end'] > first['start']:
                    has_uncertain = True
            
            selected.append(unit)
            length = unit['end'] - first['start']
            
            if length > settings.clip_max_seconds:
                break
            
            next_topic = unit['id'] + 1 in topic_starts
            at_target = bool(remaining_targets and length >= remaining_targets[0])
            
            if at_target or next_topic or unit == units[-1] or (unit['complete'] and length >= settings.clip_min_seconds):
                excerpt = ' '.join(item['text'] for item in selected)
                if settings.clip_min_seconds <= length <= settings.clip_max_seconds and len(excerpt.split()) >= 18:
                    key = (first['start'], unit['end'])
                    priority = (2 if first['id'] in topic_starts else 0) + (2 if unit['complete'] else 0)
                    priority += int(bool(re.search(r'\b(example|means|because|understand|why|how|learn|model|important)\b', excerpt, re.I)))
                    priority += int(bool(TRANSITION.search(first['text'])))
                    priority += 2 * int(bool(re.search(r'\b(that is (?:how|why)|therefore|in summary|in short|as a result)\b', unit['text'], re.I)))
                    priority -= 2 * int(unit['text'].rstrip().endswith('?'))
                    
                    # Reduce priority if has uncertain speech, but don't reject
                    if has_uncertain:
                        priority -= 1
                    
                    windows[key] = {
                        'id': hashlib.sha256(f'{key}'.encode()).hexdigest()[:12],
                        'start': key[0],
                        'end': key[1],
                        'duration': round(length, 3),
                        'excerpt': excerpt,
                        'sentence_ids': [s['id'] for s in selected],
                        'duration_exception': False,
                        'has_uncertain_speech': has_uncertain,
                        'source': 'transcript',
                        '_priority': priority
                    }
                
                while remaining_targets and length >= remaining_targets[0]:
                    remaining_targets.pop(0)
            
            if length >= settings.clip_max_seconds:
                break
    
    return list(windows.values())


def _build_audio_candidates(audio_analysis: Dict, min_duration: float, max_duration: float) -> List[Tuple[float, float]]:
    """Generate candidates from audio event boundaries."""
    candidates = []
    speech_regions = audio_analysis.get('speech_regions', [])
    
    for region in speech_regions:
        start = region['start']
        end = region['end']
        duration = region['duration']
        
        if min_duration <= duration <= max_duration:
            candidates.append((start, end))
        elif duration > max_duration:
            # Create overlapping windows within long speech regions
            current = start
            step = max_duration * 0.5  # 50% overlap
            while current + min_duration <= end:
                window_end = min(current + max_duration, end)
                if window_end - current >= min_duration:
                    candidates.append((current, window_end))
                current += step
    
    return candidates


def _build_scene_candidates(scene_analysis: Dict, duration: float, min_duration: float, max_duration: float) -> List[Tuple[float, float]]:
    """Generate candidates from scene boundaries."""
    candidates = []
    scene_changes = scene_analysis.get('scene_changes', [])
    
    if not scene_changes:
        return candidates
    
    boundaries = [0] + [sc['timestamp'] for sc in scene_changes] + [duration]
    
    for i in range(len(boundaries) - 1):
        scene_start = boundaries[i]
        scene_end = boundaries[i + 1]
        scene_duration = scene_end - scene_start
        
        if min_duration <= scene_duration <= max_duration:
            candidates.append((scene_start, scene_end))
        elif scene_duration > max_duration:
            # Windows within long scenes
            current = scene_start
            step = max_duration * 0.5
            while current + min_duration <= scene_end:
                window_end = min(current + max_duration, scene_end)
                if window_end - current >= min_duration:
                    candidates.append((current, window_end))
                current += step
        
        # Cross-boundary candidates
        if i < len(boundaries) - 2:
            boundary_start = max(0, boundaries[i + 1] - max_duration / 2)
            boundary_end = min(duration, boundaries[i + 1] + max_duration / 2)
            if min_duration <= boundary_end - boundary_start <= max_duration:
                candidates.append((boundary_start, boundary_end))
    
    return candidates


def _build_fixed_windows(duration: float, min_duration: float, max_duration: float) -> List[Tuple[float, float]]:
    """Generate fixed overlapping windows for comprehensive coverage."""
    candidates = []
    step = max_duration * 0.5  # 50% overlap
    current = 0
    
    while current + min_duration <= duration:
        window_end = min(current + max_duration, duration)
        if window_end - current >= min_duration:
            candidates.append((current, window_end))
        current += step
    
    return candidates


def _create_candidate(start: float, end: float, transcript: Dict, units: List, source: str = 'unknown') -> Dict:
    """Create a candidate dictionary from time range."""
    from .sentences import excerpt_for_range
    
    duration = end - start
    excerpt = excerpt_for_range(transcript, start, end) if transcript else ''
    
    # Find overlapping sentence IDs
    sentence_ids = []
    for unit in units:
        if unit['start'] < end and unit['end'] > start:
            sentence_ids.append(unit['id'])
    
    # If no excerpt but we have sentence IDs, try to get text from units
    if not excerpt and sentence_ids and units:
        overlapping_units = [u for u in units if u['id'] in sentence_ids]
        if overlapping_units:
            excerpt = ' '.join(u.get('text', '') for u in overlapping_units)
    
    return {
        'id': hashlib.sha256(f'{start}:{end}'.encode()).hexdigest()[:12],
        'start': start,
        'end': end,
        'duration': round(duration, 3),
        'excerpt': excerpt,
        'sentence_ids': sentence_ids,
        'duration_exception': False,
        'source': source,
        '_priority': 0
    }


def _calculate_priority(candidate: Dict, transcript: Dict, units: List, groups: List):
    """Calculate priority score for a candidate."""
    priority = 0
    
    # Source bonus
    if candidate['source'] == 'transcript':
        priority += 2
    elif candidate['source'] == 'audio':
        priority += 1
    
    # Has text content
    if candidate.get('excerpt'):
        word_count = len(candidate['excerpt'].split())
        if word_count >= 18:
            priority += 2
        elif word_count >= 10:
            priority += 1
    
    # Topic start bonus
    if units:
        topic_starts = {group[0]['id'] for group in groups}
        if any(sid in topic_starts for sid in candidate.get('sentence_ids', [])):
            priority += 2
    
    # Completeness indicators
    if candidate.get('excerpt'):
        text = candidate['excerpt'].lower()
        if any(word in text for word in ['example', 'because', 'understand', 'important', 'learn']):
            priority += 1
        if any(phrase in text for phrase in ['in summary', 'in short', 'therefore', 'as a result']):
            priority += 2
    
    # Penalize uncertainty
    if candidate.get('has_uncertain_speech'):
        priority -= 1
    
    candidate['_priority'] = priority


def _distribute_candidates(candidates: List[Dict], duration: float, budget: int) -> List[Dict]:
    """Distribute candidates across video using bucketing strategy."""
    # Create 6 temporal buckets
    buckets = [[] for _ in range(6)]
    for candidate in candidates:
        bucket = min(5, int(candidate['start'] / max(1, duration) * 6))
        buckets[bucket].append(candidate)
    
    # Sort each bucket by priority
    for bucket in buckets:
        bucket.sort(key=lambda c: (-c.get('_priority', 0), c['start']))
    
    # Round-robin selection from buckets
    selected = []
    used_starts = set()
    
    while any(buckets) and len(selected) < budget:
        for bucket in buckets:
            if bucket and len(selected) < budget:
                # Prefer distinct start times
                index = next((i for i, item in enumerate(bucket) if item['start'] not in used_starts), 0)
                if index < len(bucket):
                    candidate = bucket.pop(index)
                    used_starts.add(candidate['start'])
                    candidate.pop('_priority', None)  # Remove temporary field
                    selected.append(candidate)
    
    return sorted(selected, key=lambda c: c['start'])
