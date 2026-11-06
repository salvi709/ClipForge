import hashlib
import re
import math

from .sentences import sentence_units

ALGORITHM_VERSION = 'discovery-3.2'
WEIGHTS = {'hook_strength': 0, 'informational_value': .40, 'context_completeness': .35, 'clarity': .25}
STOPWORDS = set('a an the of in on and or but is are was were to for with that this these those it its we you they have has as by be can will from at so then when what how which our your about not just'.split())
TRANSITION = re.compile(r'^(?:so[ ,]+)?(?:now|next|first|second|finally|for example|in conclusion|let.s (?:start|talk)|when we talk|to summarize)\b', re.I)


def terms(text):
    return {word for word in re.findall(r'\b\w+\b', text.lower()) if len(word) > 2 and word not in STOPWORDS}


def topic_groups(units):
    """Lexical continuity and explicit transitions are a cheap local topic heuristic."""
    groups, current = [], []
    for unit in units:
        boundary = False
        if current:
            elapsed = current[-1]['end'] - current[0]['start']
            previous, incoming = terms(' '.join(s['text'] for s in current[-2:])), terms(unit['text'])
            similarity = len(previous & incoming) / max(1, len(previous | incoming))
            boundary = unit['start'] - current[-1]['end'] > 2 or (elapsed >= 15 and (TRANSITION.search(unit['text']) or similarity < .035))
        if boundary:
            groups.append(current)
            current = []
        current.append(unit)
    if current:
        groups.append(current)
    return groups


def build_candidates(transcript, duration, settings, *, units=None, groups=None, cancel=None):
    from .media import check_cancel
    units = sentence_units(transcript, duration) if units is None else units
    if not units:
        return [], []
    groups = topic_groups(units) if groups is None else groups
    topic_starts = {group[0]['id'] for group in groups}
    windows = {}
    targets = (settings.clip_min_seconds, (settings.clip_min_seconds + settings.clip_max_seconds) / 2, settings.clip_max_seconds)
    for index, first in enumerate(units):
        check_cancel(cancel)
        selected = []
        remaining_targets = list(targets)
        for unit in units[index:]:
            if selected and unit['start'] - selected[-1]['end'] > 3:
                break
            if any(span['start'] < unit['end'] and span['end'] > first['start'] for span in transcript.get('uncertain_ranges', [])):
                break
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
                    windows[key] = {'id': hashlib.sha256(f'{key}'.encode()).hexdigest()[:12], 'start': key[0], 'end': key[1],
                                    'duration': round(length, 3), 'excerpt': excerpt, 'sentence_ids': [s['id'] for s in selected],
                                    'duration_exception': False,
                                    '_priority': priority}
                while remaining_targets and length >= remaining_targets[0]:
                    remaining_targets.pop(0)
            if length >= settings.clip_max_seconds:
                break
    # Distribute the bounded assessment budget across the full video, not just its opening.
    buckets = [[] for _ in range(6)]
    for candidate in windows.values():
        bucket = min(5, int(candidate['start'] / max(1, duration) * 6))
        buckets[bucket].append(candidate)
    for bucket in buckets:
        bucket.sort(key=lambda c: (-c['_priority'], abs(c['duration'] - sum(targets) / 3), c['start']))
    candidates, used_starts = [], set()
    while any(buckets) and len(candidates) < settings.clip_max_candidates:
        for bucket in buckets:
            if bucket and len(candidates) < settings.clip_max_candidates:
                # Give distinct sentence starts a turn before another almost-identical
                # window can consume the same region's small assessment budget.
                index = next((i for i, item in enumerate(bucket) if item['start'] not in used_starts), 0)
                candidate = bucket.pop(index)
                used_starts.add(candidate['start'])
                candidate.pop('_priority')
                candidates.append(candidate)
    return sorted(candidates, key=lambda c: c['start']), groups


def valid_candidate(candidate, duration, options):
    start, end = candidate['start'], candidate['end']
    return (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= duration
            and options.min_seconds <= end - start <= options.max_seconds)


def quality_score(assessment):
    return round(sum(getattr(assessment, key) * weight for key, weight in WEIGHTS.items()) * 20)


def rejection_reasons(a, candidate=None):
    reasons = []
    if not a.suitable: reasons.append('model_suitable_false')
    if a.informational_value < 3: reasons.append('informational_value_below_3_of_5')
    if a.context_completeness < 3: reasons.append('context_completeness_below_3_of_5')
    if a.clarity < 2: reasons.append('clarity_below_2_of_5')
    if quality_score(a) < 60: reasons.append('weighted_score_below_60_of_100')
    if candidate:
        excerpt = candidate['excerpt'].strip()
        if not re.search(r'[.!?。！？][\"\'’”)]*$', excerpt):
            reasons.append('incomplete_sentence_ending')
        if re.search(r'\b(my name is|by the end of the session|I assure you)\b', excerpt[:len(excerpt)//2], re.I):
            reasons.append('introduction_or_future_promise')
    return reasons


def rank_candidates(candidates, assessments, limit, deduplicate=True, allow_lower=False):
    by_id = {candidate['id']: candidate for candidate in candidates}
    ranked = []
    for assessment in assessments:
        candidate = by_id[assessment.candidate_id]
        score = quality_score(assessment)
        reasons = rejection_reasons(assessment, candidate)
        if reasons and not (allow_lower and assessment.informational_value >= 2 and assessment.context_completeness >= 2 and assessment.clarity >= 3 and score >= 40):
            continue
        ranked.append({**candidate, 'title': assessment.title, 'reason': assessment.reason, 'evidence': assessment.evidence,
                       'score': score, 'confidence': 'lower' if reasons else 'strong', 'quality_rejections': reasons, 'criteria': {key: getattr(assessment, key) for key in WEIGHTS}})
    ranked.sort(key=lambda c: (c['confidence'] == 'lower', -c['score'], -c['criteria']['context_completeness'], c['start']))
    chosen = []
    for candidate in ranked:
        duplicate = False
        for previous in chosen if deduplicate else []:
            overlap = max(0, min(candidate['end'], previous['end']) - max(candidate['start'], previous['start']))
            a, b = terms(candidate['excerpt']), terms(previous['excerpt'])
            if overlap / min(candidate['duration'], previous['duration']) >= .35 or len(a & b) / max(1, len(a | b)) >= .72:
                duplicate = True
                break
        if not duplicate:
            chosen.append({**candidate, 'rank': len(chosen) + 1, 'original_start': candidate['start'], 'original_end': candidate['end'], 'adjusted': False})
        if len(chosen) >= limit:
            break
    return chosen
