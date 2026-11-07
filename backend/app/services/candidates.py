import hashlib
import re
import math

from .sentences import sentence_units
from .discovery_strategies import get_category_weights, normalize_category

ALGORITHM_VERSION = 'discovery-4.0-intelligence-v2'
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


def quality_score(assessment, category=None):
    """
    Compute weighted quality score (0-100) based on category weights.
    Maintains exact backward compatibility for educational / default evaluations.
    """
    weights = get_category_weights(category) if category else WEIGHTS
    return round(sum(getattr(assessment, key) * weight for key, weight in weights.items()) * 20)


def compute_scoring_factors(assessment, candidate, category='educational'):
    """
    Compute structured individual scoring factors across 10 evaluation dimensions.
    """
    norm = normalize_category(category)
    weights = get_category_weights(norm)
    score = quality_score(assessment, norm)

    hook = assessment.hook_strength
    info = assessment.informational_value
    comp = assessment.context_completeness
    clar = assessment.clarity

    hook_score = round(hook * 20, 1)
    info_score = round(info * 20, 1)
    completeness_score = round(comp * 20, 1)
    clarity_score = round(clar * 20, 1)
    standalone_usefulness = round((comp * 0.6 + clar * 0.4) * 20, 1)

    excerpt = candidate.get('excerpt', '').strip()
    clean_start = not bool(re.match(r'^(and|but|or|so|because)\b', excerpt, re.I))
    clean_end = bool(re.search(r'[.!?。！？][\"\'’”)]*$', excerpt))
    boundary_quality = round((1.0 if clean_start else 0.6) * (1.0 if clean_end else 0.6) * 100, 1)

    evidence = getattr(assessment, 'evidence', '').strip()
    evidence_strength = round(min(1.0, len(evidence) / 40.0) * 100, 1) if evidence and evidence in excerpt else 60.0

    audio_relevance = round(candidate.get('audio_score', 80.0), 1)
    visual_relevance = round(candidate.get('visual_score', 75.0), 1)

    words = excerpt.split()
    unique_ratio = len(set(words)) / max(1, len(words))
    uniqueness = round(min(1.0, unique_ratio * 1.3) * 100, 1)

    category_relevance = round(min(100.0, score * 1.05), 1)

    return {
        'hook_strength': hook_score,
        'informational_value': info_score,
        'context_completeness': completeness_score,
        'clarity': clarity_score,
        'standalone_usefulness': standalone_usefulness,
        'boundary_quality': boundary_quality,
        'evidence_strength': evidence_strength,
        'audio_relevance': audio_relevance,
        'visual_relevance': visual_relevance,
        'uniqueness': uniqueness,
        'category_relevance': category_relevance,
        'composite_score': score,
    }


def rejection_reasons(a, candidate=None, category='educational'):
    """Determine explicit reasons for rejecting a candidate from the strong tier."""
    norm = normalize_category(category)
    reasons = []
    score = quality_score(a, norm)

    if not a.suitable:
        reasons.append('model_suitable_false')

    # Category-adapted thresholds
    min_info = 2 if norm in {'gaming', 'sports'} else 3
    if a.informational_value < min_info:
        reasons.append(f'informational_value_below_{min_info}_of_5')

    if a.context_completeness < 3:
        reasons.append('context_completeness_below_3_of_5')

    if a.clarity < 2:
        reasons.append('clarity_below_2_of_5')

    min_score = 50 if norm in {'gaming', 'sports'} else 60
    if score < min_score:
        reasons.append(f'weighted_score_below_{min_score}_of_100')

    if candidate:
        excerpt = candidate.get('excerpt', '').strip()
        if not re.search(r'[.!?。！？][\"\'’”)]*$', excerpt):
            reasons.append('incomplete_sentence_ending')
        if norm in {'educational', 'tutorials'} and re.search(r'\b(my name is|by the end of the session|I assure you)\b', excerpt[:len(excerpt)//2], re.I):
            reasons.append('introduction_or_future_promise')

    return reasons


def partition_discovery_candidates(candidates, assessments, limit, deduplicate=True, allow_lower=False, category='educational'):
    """
    Partition candidates into Top Picks and More Discoveries.
    
    Returns:
        (top_picks, more_discoveries)
    """
    norm = normalize_category(category)
    weights = get_category_weights(norm)
    by_id = {candidate['id']: candidate for candidate in candidates}
    ranked = []

    for assessment in assessments:
        candidate = by_id.get(assessment.candidate_id)
        if not candidate:
            continue
        score = quality_score(assessment, norm)
        reasons = rejection_reasons(assessment, candidate, norm)
        factors = compute_scoring_factors(assessment, candidate, norm)

        # In allow_lower mode, include reasonable secondary candidates
        if reasons and not (allow_lower and assessment.informational_value >= 2 and assessment.context_completeness >= 2 and assessment.clarity >= 2 and score >= 35):
            continue

        confidence = 'lower' if reasons else 'strong'
        ranked.append({
            **candidate,
            'title': assessment.title,
            'reason': assessment.reason,
            'evidence': assessment.evidence,
            'score': score,
            'confidence': confidence,
            'quality_rejections': reasons,
            'scoring_factors': factors,
            'criteria': {key: getattr(assessment, key) for key in weights},
        })

    # Sort candidates by: strong confidence first, then composite score, then completeness, then timeline start
    ranked.sort(key=lambda c: (c['confidence'] == 'lower', -c['score'], -c['criteria']['context_completeness'], c['start']))

    top_picks = []
    more_discoveries = []

    for candidate in ranked:
        # Check duplicate against already accepted top_picks and more_discoveries
        duplicate = False
        all_chosen = top_picks + more_discoveries if deduplicate else []
        for previous in all_chosen:
            overlap = max(0, min(candidate['end'], previous['end']) - max(candidate['start'], previous['start']))
            a, b = terms(candidate['excerpt']), terms(previous['excerpt'])
            if overlap / min(candidate['duration'], previous['duration']) >= .35 or len(a & b) / max(1, len(a | b)) >= .72:
                duplicate = True
                break

        if not duplicate:
            item = {
                **candidate,
                'original_start': candidate['start'],
                'original_end': candidate['end'],
                'adjusted': False,
            }
            if len(top_picks) < limit and candidate['confidence'] == 'strong':
                item['rank'] = len(top_picks) + 1
                top_picks.append(item)
            else:
                item['rank'] = len(top_picks) + len(more_discoveries) + 1
                more_discoveries.append(item)

    # If not enough strong clips to satisfy limit, promote highest-scoring more_discoveries into top_picks if allowed
    if allow_lower and len(top_picks) < limit and more_discoveries:
        needed = limit - len(top_picks)
        promoted = more_discoveries[:needed]
        more_discoveries = more_discoveries[needed:]
        for p in promoted:
            p['rank'] = len(top_picks) + 1
            top_picks.append(p)

    return top_picks, more_discoveries


def rank_candidates(candidates, assessments, limit, deduplicate=True, allow_lower=False, category='educational'):
    """
    Rank candidate moments and return chosen list of Top Picks.
    Preserves exact backward compatibility with existing tests and callers.
    """
    top_picks, _ = partition_discovery_candidates(
        candidates, assessments, limit, deduplicate=deduplicate, allow_lower=allow_lower, category=category
    )
    return top_picks
