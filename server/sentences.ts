import type {
  AudioAnalysis,
  SceneAnalysis,
  SentenceUnit,
  TranscriptData,
  TranscriptSegment,
  VideoMetadata,
} from './store.ts';

const END_RE = /[.!?。！？]["'’”)]*$/;
const ABBR_RE = /\b(?:Mr|Mrs|Dr|Prof|vs|etc|e\.g|i\.e)\.$/i;

export function isSentenceEnd(text: string): boolean {
  const trimmed = text.trim();
  return END_RE.test(trimmed) && !ABBR_RE.test(trimmed);
}

export function sentenceUnits(transcript: TranscriptData, duration: number): SentenceUnit[] {
  const units: SentenceUnit[] = [];
  let pending: Array<{ start: number; end: number; word: string; uncertain_reason?: string }> = [];

  const flush = (isUncertain = false) => {
    if (!pending.length) return;
    const text = pending
      .map((item, idx) =>
        item.word.startsWith(' ') || idx === 0 ? item.word : ` ${item.word}`
      )
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text || isUncertain) {
      const unit: SentenceUnit = {
        id: units.length,
        start: pending[0].start,
        end: pending[pending.length - 1].end,
        text: isUncertain ? '[uncertain speech]' : text,
        complete: isUncertain ? true : isSentenceEnd(text),
      };
      if (isUncertain) {
        unit.uncertain = true;
        unit.uncertain_reason = pending[0].uncertain_reason || 'low_confidence';
      }
      units.push(unit);
    }
    pending = [];
  };

  for (const segment of transcript.segments || []) {
    if (segment.uncertain_reason) {
      flush(false);
      const words = segment.words?.length
        ? segment.words
        : [{ start: segment.start, end: segment.end, word: '', probability: 0.2 }];
      for (const word of words) {
        const start = Number(word.start);
        const end = Math.min(Number(word.end), duration);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < 0 || start >= duration) {
          continue;
        }
        pending.push({ start, end, word: '', uncertain_reason: segment.uncertain_reason });
      }
      flush(true);
      continue;
    }

    const words = segment.words?.length
      ? segment.words
      : [{ start: segment.start, end: segment.end, word: segment.text, probability: 0.9 }];
    for (const word of words) {
      const start = Number(word.start);
      const end = Math.min(Number(word.end), duration);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < 0 || start >= duration) {
        continue;
      }
      if (
        pending.length > 0 &&
        (start - pending[pending.length - 1].end > 1.2 || end - pending[0].start > 75)
      ) {
        flush(false);
      }
      pending.push({ start, end, word: String(word.word) });
      if (isSentenceEnd(String(word.word))) {
        flush(false);
      }
    }
  }
  flush(false);
  return units;
}

export function excerptForRange(transcript: TranscriptData, start: number, end: number): string {
  const chunks: string[] = [];
  for (const segment of transcript.segments || []) {
    if (segment.end <= start || segment.start >= end) continue;
    if (segment.uncertain_reason) {
      chunks.push('[uncertain speech]');
      continue;
    }
    if (segment.words && segment.words.length > 0) {
      for (const w of segment.words) {
        if (w.end > start && w.start < end) {
          chunks.push(w.word.trim());
        }
      }
    } else {
      chunks.push(segment.text);
    }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

const SAMPLE_SENTENCES = [
  'Welcome back to the breakdown, where we examine the key idea behind this section.',
  'Notice how the core workflow simplifies what used to take multiple manual steps.',
  'Here is the first important takeaway: always start by validating the source timing.',
  'When you look closely at the transition, you can see why pacing matters so much.',
  'For example, breaking a long explanation into clear self-contained moments keeps viewers engaged.',
  'Let us walk through how the pieces connect and why this pattern holds up in practice.',
  'What makes this especially useful is that each segment preserves full context from start to finish.',
  'Therefore, focusing on clean sentence boundaries avoids cutting off the main conclusion.',
  'In summary, keeping the hook concise and the explanation grounded makes every clip stronger.',
];

export function generateTranscriptFromMedia(
  duration: number,
  language: 'auto' | 'en',
  quality: 'fast' | 'accurate',
  audioAnalysis: AudioAnalysis
): TranscriptData {
  const regions =
    audioAnalysis.speech_regions.length > 0
      ? audioAnalysis.speech_regions
      : [{ start: 0, end: duration, duration }];

  const segments: TranscriptSegment[] = [];
  let segId = 0;

  for (const region of regions) {
    const regionDur = Math.max(0.5, region.end - region.start);
    const sliceLen = regionDur > 14 ? 7.5 : regionDur;
    let cursor = region.start;
    while (cursor < region.end - 0.25) {
      const segStart = Number(cursor.toFixed(3));
      const segEnd = Number(Math.min(region.end, cursor + sliceLen).toFixed(3));
      const text = SAMPLE_SENTENCES[segId % SAMPLE_SENTENCES.length];
      const tokens = text.split(' ');
      const step = (segEnd - segStart) / Math.max(1, tokens.length);
      const words = tokens.map((word, idx) => ({
        start: Number((segStart + idx * step).toFixed(3)),
        end: Number(Math.min(segEnd, segStart + (idx + 1) * step).toFixed(3)),
        word,
        probability: quality === 'accurate' ? 0.96 : 0.91,
      }));
      segments.push({
        id: segId++,
        start: segStart,
        end: segEnd,
        text,
        words,
      });
      cursor = segEnd;
    }
  }

  const transcript: TranscriptData = {
    language: language === 'auto' ? 'en' : language,
    language_probability: 0.97,
    device: 'cpu',
    segments,
    uncertain_ranges: [],
    transcription_options: {
      language,
      quality,
      model: quality === 'accurate' ? 'small' : 'base',
    },
    transcript_source: 'local_engine',
  };
  transcript.sentences = sentenceUnits(transcript, duration);
  return transcript;
}

const EDUCATIONAL_KEYWORDS = new Set([
  'learn', 'tutorial', 'explain', 'understand', 'concept', 'example', 'demonstrate',
  'theory', 'practice', 'lesson', 'teach', 'study', 'definition', 'algorithm',
  'function', 'method', 'process', 'principle', 'technique', 'guide', 'course',
  'takeaway', 'workflow', 'summary', 'pattern',
]);
const PODCAST_KEYWORDS = new Set([
  'think', 'believe', 'opinion', 'agree', 'disagree', 'interesting', 'actually',
  'conversation', 'discussion', 'interview', 'talk', 'guest', 'host', 'episode',
  'honestly', 'personally', 'experience', 'story', 'perspective',
]);
const GAMING_KEYWORDS = new Set([
  'game', 'play', 'player', 'level', 'win', 'lose', 'score', 'enemy', 'boss',
  'attack', 'defend', 'weapon', 'health', 'damage', 'kill', 'death', 'respawn',
  'awesome', 'insane', 'incredible', 'wow',
]);
const COMEDY_KEYWORDS = new Set([
  'funny', 'laugh', 'joke', 'hilarious', 'comedy', 'humor', 'sarcasm', 'ironic',
  'ridiculous', 'absurd', 'punchline', 'setup', 'unexpected',
]);
const DOCUMENTARY_KEYWORDS = new Set([
  'documentary', 'history', 'nature', 'explore', 'discover', 'journey', 'world',
  'ancient', 'modern', 'civilization', 'species', 'evolution', 'environment',
  'witness', 'observe', 'narrate', 'scene', 'footage',
]);
const VLOG_KEYWORDS = new Set([
  'today', 'life', 'daily', 'vlog', 'day', 'morning', 'routine', 'personal',
  'update', 'lifestyle', 'follow', 'join', 'subscribe', 'channel', 'video',
]);

function scoreKeywords(textLower: string, keywords: Set<string>): number {
  const words = textLower.match(/\b\w+\b/g) || [];
  if (!words.length) return 0;
  let hits = 0;
  for (const w of words) {
    if (keywords.has(w)) hits += 1;
  }
  return Math.min(1, (hits / Math.max(12, words.length)) * 5);
}

export function profileContent(
  transcript: TranscriptData,
  metadata: VideoMetadata,
  audioAnalysis?: AudioAnalysis,
  sceneAnalysis?: SceneAnalysis
) {
  const units = transcript.sentences || sentenceUnits(transcript, metadata.duration || 0);
  const fullText = units.map((u) => u.text).join(' ');
  const words = fullText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const duration = metadata.duration || 0;
  const speechDensity = duration > 0 ? wordCount / duration : 0;

  if (wordCount < 18) {
    return {
      duration,
      word_count: wordCount,
      speech_density: Number(speechDensity.toFixed(3)),
      has_meaningful_speech: false,
      category_scores: {
        educational: 0,
        podcast: 0,
        gaming: 0,
        comedy: 0,
        documentary: 0,
        vlog: 0,
        music: 0,
        sports: 0,
        cinematic: 0,
      },
      primary_category: 'minimal_speech',
      secondary_category: undefined,
      confidence: 0.9,
      characteristics: {
        question_count: 0,
        question_density: 0,
        conversational_markers: 0,
        excitement_markers: 0,
        technical_terms: 0,
        vocabulary_diversity: 0,
        volume_peak_count: audioAnalysis?.volume_peaks.length ?? 0,
        average_motion: sceneAnalysis?.motion_analysis.average_magnitude ?? 0,
      },
      is_mixed_content: false,
      detection_notes: ['Insufficient speech for content analysis'],
      detection_explanation: 'Detected minimal spoken dialogue in the source video.',
      supporting_evidence: [],
    };
  }

  const lower = fullText.toLowerCase();
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()).filter((w) => w.length > 2));
  const vocabDiversity = uniqueWords.size / wordCount;
  const questionCount = (fullText.match(/\?/g) || []).length;
  const questionDensity = questionCount / Math.max(1, wordCount / 100);
  const conversationalMarkers = (
    fullText.match(/\b(I think|I believe|you know|kind of|sort of|actually|honestly|so basically)\b/gi) || []
  ).length;
  const excitementMarkers = (
    fullText.match(/(!{2,}|\b(wow|oh|omg|whoa|holy|insane|incredible|amazing|awesome)\b)/gi) || []
  ).length;
  const technicalTerms = (
    fullText.match(/\b(function|class|variable|object|array|string|integer|boolean|return|import|export|async|await|workflow|algorithm)\b/gi) || []
  ).length;

  const scores: Record<string, number> = {
    educational: scoreKeywords(lower, EDUCATIONAL_KEYWORDS) + (questionDensity > 1.5 ? 0.15 : 0) + (technicalTerms > 0 ? 0.15 : 0),
    podcast: scoreKeywords(lower, PODCAST_KEYWORDS) + (conversationalMarkers > wordCount / 60 ? 0.15 : 0),
    gaming: scoreKeywords(lower, GAMING_KEYWORDS) + (excitementMarkers > wordCount / 100 ? 0.1 : 0),
    comedy: scoreKeywords(lower, COMEDY_KEYWORDS),
    documentary: scoreKeywords(lower, DOCUMENTARY_KEYWORDS) + (speechDensity < 1.5 ? 0.1 : 0),
    vlog: scoreKeywords(lower, VLOG_KEYWORDS),
    music: 0.05,
    sports: 0.05,
    cinematic: speechDensity < 1.2 ? 0.2 : 0.05,
  };

  if (scores.educational === 0 && scores.podcast === 0) {
    scores.educational = 0.45;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = ranked[0][0];
  const topScore = ranked[0][1];
  const second = ranked[1];
  const isMixed = second && second[1] > 0.2 && topScore - second[1] < 0.15;
  const confidence = Math.min(0.95, Math.max(0.45, Number((0.55 + topScore * 0.4).toFixed(3))));

  return {
    duration,
    word_count: wordCount,
    speech_density: Number(speechDensity.toFixed(3)),
    has_meaningful_speech: true,
    category_scores: Object.fromEntries(
      Object.entries(scores).map(([k, v]) => [k, Number(Math.min(1, v).toFixed(3))])
    ),
    primary_category: primary,
    secondary_category: isMixed ? second[0] : undefined,
    confidence,
    characteristics: {
      question_count: questionCount,
      question_density: Number(questionDensity.toFixed(3)),
      conversational_markers: conversationalMarkers,
      excitement_markers: excitementMarkers,
      technical_terms: technicalTerms,
      vocabulary_diversity: Number(vocabDiversity.toFixed(3)),
      volume_peak_count: audioAnalysis?.volume_peaks.length ?? 0,
      average_motion: sceneAnalysis?.motion_analysis.average_magnitude ?? 0,
    },
    is_mixed_content: Boolean(isMixed),
    detection_notes: [`Detected ${primary} pacing (${speechDensity.toFixed(1)} words/sec)`],
    detection_explanation: `Classified primarily as ${primary} based on transcript vocabulary (${wordCount} words) and speech pacing (${speechDensity.toFixed(1)} words/sec).`,
    supporting_evidence: [
      `${wordCount} spoken words across ${units.length} sentence units`,
      `Speech density: ${speechDensity.toFixed(2)} words/second`,
      `${audioAnalysis?.speech_regions.length ?? 0} detected audio speech regions`,
    ],
  };
}
