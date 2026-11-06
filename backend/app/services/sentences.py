"""Conservative sentence boundaries derived only from existing speech timestamps."""
import math
import re

END = re.compile(r'[.!?。！？][\"\'’”)]*$')
ABBREVIATION = re.compile(r'\b(?:Mr|Mrs|Dr|Prof|vs|etc|e\.g|i\.e)\.$', re.I)


def sentence_end(text):
    return bool(END.search(text.strip()) and not ABBREVIATION.search(text.strip()))


def sentence_units(transcript, duration):
    units, pending = [], []

    def flush():
        if not pending:
            return
        text = ' '.join(''.join(item['word'] if item['word'].startswith(' ') or index == 0
                                else ' ' + item['word'] for index, item in enumerate(pending)).split())
        if text:
            units.append({'id': len(units), 'start': pending[0]['start'], 'end': pending[-1]['end'],
                          'text': text, 'complete': sentence_end(text)})
        pending.clear()

    for segment in transcript.get('segments', []):
        if segment.get('uncertain_reason'):
            flush()
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
    text = []
    for segment in transcript.get('segments', []):
        if segment.get('uncertain_reason'):
            continue
        if segment['end'] <= start or segment['start'] >= end:
            continue
        words = segment.get('words')
        if words:
            text.extend(word['word'].strip() for word in words if word['end'] > start and word['start'] < end)
        else:
            text.append(segment['text'])
    return ' '.join(' '.join(text).split())
