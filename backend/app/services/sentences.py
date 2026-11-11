"""Conservative sentence boundaries derived only from existing speech timestamps."""
import math
import re

END = re.compile(r'[.!?。！？][\"\'’”)]*$')
ABBREVIATION = re.compile(r'\b(?:Mr|Mrs|Dr|Prof|vs|etc|e\.g|i\.e)\.$', re.I)


def sentence_end(text):
    return bool(END.search(text.strip()) and not ABBREVIATION.search(text.strip()))


def sentence_units(transcript, duration):
    """
    Build sentence units from transcript segments.
    
    Preserves uncertain segments with timestamps but marks them clearly.
    This allows audio/visual analysis to evaluate these moments without
    treating the uncertain transcription text as reliable evidence.
    """
    units, pending = [], []

    def flush(is_uncertain=False):
        if not pending:
            return
        text = ' '.join(''.join(item['word'] if item['word'].startswith(' ') or index == 0
                                else ' ' + item['word'] for index, item in enumerate(pending)).split())
        if text or is_uncertain:
            unit = {
                'id': len(units), 
                'start': pending[0]['start'], 
                'end': pending[-1]['end'],
                'text': text if not is_uncertain else '[uncertain speech]',
                'complete': sentence_end(text) if not is_uncertain else True,
            }
            if is_uncertain:
                unit['uncertain'] = True
                unit['uncertain_reason'] = pending[0].get('uncertain_reason', 'low_confidence')
            units.append(unit)
        pending.clear()

    for segment in transcript.get('segments', []):
        uncertain_reason = segment.get('uncertain_reason')
        if uncertain_reason:
            # Flush any pending certain speech first
            flush()
            # Include uncertain segment with timestamps but marked as uncertain
            words = segment.get('words') or [{'start': segment['start'], 'end': segment['end'], 'word': ''}]
            for word in words:
                start, end = float(word['start']), float(word['end'])
                if not math.isfinite(start) or not math.isfinite(end) or end < start or start < 0 or start >= duration:
                    continue
                end = min(end, duration)
                pending.append({'start': start, 'end': end, 'word': '', 'uncertain_reason': uncertain_reason})
            flush(is_uncertain=True)
            continue
        
        words = segment.get('words') or [{'start': segment['start'], 'end': segment['end'], 'word': segment['text']}]
        for word in words:
            start, end = float(word['start']), float(word['end'])
            if not math.isfinite(start) or not math.isfinite(end) or end < start or start < 0 or start >= duration:
                continue
            end = min(end, duration)
            if pending and (start - pending[-1]['end'] > 1.2 or end - pending[0]['start'] > 75):
                flush()
            pending.append({'start': start, 'end': end, 'word': str(word['word'])})
            if sentence_end(word['word']):
                flush()
    flush()
    return units


def excerpt_for_range(transcript, start, end):
    """
    Extract text excerpt for a timestamp range.
    
    Uncertain segments are represented as [uncertain speech] placeholder
    to indicate their presence without fabricating words.
    """
    text = []
    for segment in transcript.get('segments', []):
        if segment['end'] <= start or segment['start'] >= end:
            continue
        
        # Mark uncertain speech without fabricating content
        if segment.get('uncertain_reason'):
            text.append('[uncertain speech]')
            continue
            
        words = segment.get('words')
        if words:
            text.extend(word['word'].strip() for word in words if word['end'] > start and word['start'] < end)
        else:
            text.append(segment['text'])
    return ' '.join(' '.join(text).split())
