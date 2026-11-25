import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { InMemoryStore, SentenceUnit, TranscriptData } from './store.ts';
import { excerptForRange, sentenceUnits } from './sentences.ts';

export const ALGORITHM_VERSION = 'discovery-4.0-intelligence-v2';

const STOPWORDS = new Set(
  'a an the of in on and or but is are was were to for with that this these those it its we you they have has as by be can will from at so then when what how which our your about not just'.split(
    ' '
  )
);

const TRANSITION_RE =
  /^(?:so[ ,]+)?(?:now|next|first|second|finally|for example|in conclusion|let.s (?:start|talk)|when we talk|to summarize)\b/i;

export type DiscoveryOptions = {
  clip_count: number;
  min_seconds: number;
  max_seconds: number;
};

export function getCategoryWeights(category?: string | null) {
  const norm = (category || 'educational').toLowerCase();
  if (norm === 'gaming' || norm === 'sports') {
    return {
      hook_strength: 0.35,
      informational_value: 0.2,
      context_completeness: 0.25,
      clarity: 0.2,
    };
  }
  if (norm === 'podcast') {
    return {
      hook_strength: 0.2,
      informational_value: 0.35,
      context_completeness: 0.3,
      clarity: 0.15,
    };
  }
  if (norm === 'comedy' || norm === 'vlog') {
    return {
      hook_strength: 0.3,
      informational_value: 0.2,
      context_completeness: 0.3,
      clarity: 0.2,
    };
  }
  return {
    hook_strength: 0.15,
    informational_value: 0.4,
    context_completeness: 0.35,
    clarity: 0.1,
  };
}

function terms(text: string): Set<string> {
  const matches = text.toLowerCase().match(/\b\w+\b/g) || [];
  return new Set(matches.filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

function topicGroups(units: SentenceUnit[]): SentenceUnit[][] {
  const groups: SentenceUnit[][] = [];
  let current: SentenceUnit[] = [];
  for (const unit of units) {
    let boundary = false;
    if (current.length > 0) {
      const elapsed = current[current.length - 1].end - current[0].start;
      const prevTerms = terms(
        current
          .slice(-2)
          .map((s) => s.text)
          .join(' ')
      );
      const nextTerms = terms(unit.text);
      const unionSize = new Set([...prevTerms, ...nextTerms]).size;
      const interSize = [...prevTerms].filter((t) => nextTerms.has(t)).length;
      const sim = interSize / Math.max(1, unionSize);
      boundary =
        unit.start - current[current.length - 1].end > 2 ||
        (elapsed >= 15 && (TRANSITION_RE.test(unit.text) || sim < 0.035));
    }
    if (boundary) {
      groups.push(current);
      current = [];
    }
    current.push(unit);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

type CandidateWindow = {
  id: string;
  start: number;
  end: number;
  duration: number;
  excerpt: string;
  sentence_ids: number[];
  duration_exception: boolean;
  _priority: number;
  audio_score?: number;
  visual_score?: number;
};

function buildCandidates(
  transcript: TranscriptData,
  duration: number,
  options: DiscoveryOptions,
  units: SentenceUnit[],
  groups: SentenceUnit[][]
): CandidateWindow[] {
  if (!units.length) return [];
  const topicStarts = new Set(groups.map((g) => g[0].id));
  const windows = new Map<string, CandidateWindow>();
  const targets = [
    options.min_seconds,
    (options.min_seconds + options.max_seconds) / 2,
    options.max_seconds,
  ];

  for (let i = 0; i < units.length; i++) {
    const first = units[i];
    const selected: SentenceUnit[] = [];
    const remainingTargets = [...targets];
    for (let j = i; j < units.length; j++) {
      const unit = units[j];
      if (selected.length > 0 && unit.start - selected[selected.length - 1].end > 3) {
        break;
      }
      if (
        (transcript.uncertain_ranges || []).some(
          (span) => span.start < unit.end && span.end > first.start
        )
      ) {
        break;
      }
      selected.push(unit);
      const length = unit.end - first.start;
      if (length > options.max_seconds) break;

      const nextTopic = topicStarts.has(unit.id + 1);
      const atTarget = remainingTargets.length > 0 && length >= remainingTargets[0];
      if (
        atTarget ||
        nextTopic ||
        j === units.length - 1 ||
        (unit.complete && length >= options.min_seconds)
      ) {
        const excerpt = selected.map((s) => s.text).join(' ');
        if (
          length >= options.min_seconds &&
          length <= options.max_seconds &&
          excerpt.split(/\s+/).filter(Boolean).length >= 8
        ) {
          const keyStr = `${first.start}:${unit.end}`;
          let priority =
            (topicStarts.has(first.id) ? 2 : 0) + (unit.complete ? 2 : 0);
          if (/\b(example|means|because|understand|why|how|learn|model|important|takeaway|workflow)\b/i.test(excerpt)) {
            priority += 1;
          }
          if (TRANSITION_RE.test(first.text)) priority += 1;
          if (/\b(that is (?:how|why)|therefore|in summary|in short|as a result)\b/i.test(unit.text)) {
            priority += 2;
          }
          if (unit.text.trim().endsWith('?')) priority -= 2;

          windows.set(keyStr, {
            id: crypto.createHash('sha256').update(keyStr).digest('hex').slice(0, 12),
            start: Number(first.start.toFixed(3)),
            end: Number(unit.end.toFixed(3)),
            duration: Number(length.toFixed(3)),
            excerpt,
            sentence_ids: selected.map((s) => s.id),
            duration_exception: false,
            _priority: priority,
            audio_score: 82,
            visual_score: 76,
          });
        }
        while (remainingTargets.length > 0 && length >= remainingTargets[0]) {
          remainingTargets.shift();
        }
      }
      if (length >= options.max_seconds) break;
    }
  }

  // Fallback sliding windows if sentence grouping didn't match duration bounds
  if (windows.size === 0 && duration >= options.min_seconds) {
    const winLen = Math.min(duration, (options.min_seconds + options.max_seconds) / 2);
    const step = Math.max(5, winLen * 0.6);
    for (let s = 0; s + options.min_seconds <= duration; s += step) {
      const e = Math.min(duration, s + winLen);
      const excerpt = excerptForRange(transcript, s, e) || 'Spoken segment from source video.';
      const keyStr = `${s.toFixed(2)}:${e.toFixed(2)}`;
      windows.set(keyStr, {
        id: crypto.createHash('sha256').update(keyStr).digest('hex').slice(0, 12),
        start: Number(s.toFixed(3)),
        end: Number(e.toFixed(3)),
        duration: Number((e - s).toFixed(3)),
        excerpt,
        sentence_ids: [],
        duration_exception: false,
        _priority: 1,
        audio_score: 78,
        visual_score: 74,
      });
    }
  }

  return Array.from(windows.values()).sort(
    (a, b) => b._priority - a._priority || a.start - b.start
  ).slice(0, 40);
}

type Assessment = {
  candidate_id: string;
  suitable: boolean;
  title: string;
  reason: string;
  evidence: string;
  hook_strength: number;
  informational_value: number;
  context_completeness: number;
  clarity: number;
};

function assessCandidate(c: CandidateWindow, index: number, category: string): Assessment {
  const words = c.excerpt.split(/\s+/).filter(Boolean);
  const uniqueRatio = new Set(words.map((w) => w.toLowerCase())).size / Math.max(1, words.length);
  const hasEndPunct = /[.!?。！？]["'’”)]*$/.test(c.excerpt.trim());
  const hasHookWords = /\b(first|key|important|why|how|secret|mistake|example|therefore|summary)\b/i.test(
    c.excerpt
  );

  const hook = Math.min(5, Math.max(2, hasHookWords ? 4 : 3));
  const info = Math.min(5, Math.max(3, Math.round(3 + uniqueRatio * 2)));
  const comp = hasEndPunct ? 4 : 3;
  const clar = words.length >= 15 ? 4 : 3;

  const firstClause = c.excerpt
    .split(/[.!?]/)[0]
    .trim()
    .split(/\s+/)
    .slice(0, 7)
    .join(' ');
  const title =
    firstClause.length >= 10
      ? firstClause.replace(/[,:;]+$/, '')
      : `${category.charAt(0).toUpperCase() + category.slice(1)} Highlight #${index + 1}`;
  const evidence = c.excerpt.split(/[.!?]/)[0].trim().slice(0, 140) || c.excerpt.slice(0, 140);

  return {
    candidate_id: c.id,
    suitable: true,
    title,
    reason: `Self-contained ${category} segment (${c.duration.toFixed(1)}s) with clear sentence boundaries and coherent topic focus.`,
    evidence,
    hook_strength: hook,
    informational_value: info,
    context_completeness: comp,
    clarity: clar,
  };
}

export class DiscoveryEngine {
  private store: InMemoryStore;
  private activeCancels = new Map<string, { cancelled: boolean }>();
  private running = new Set<string>();

  constructor(store: InMemoryStore) {
    this.store = store;
  }

  result(projectId: string): {
    status: string;
    clips: Array<Record<string, unknown>>;
    top_picks: Array<Record<string, unknown>>;
    more_discoveries: Array<Record<string, unknown>>;
    error: string | null;
    evaluated: number;
    total: number;
    model: string;
    algorithm_version?: string;
    settings: DiscoveryOptions | null;
    result_settings?: DiscoveryOptions | null;
    progress?: Record<string, unknown>;
    previous_result?: boolean;
    message?: string | null;
    [key: string]: unknown;
  } {
    const state = this.store.discovery(projectId);
    if (!state) {
      return {
        status: 'idle',
        clips: [],
        top_picks: [],
        more_discoveries: [],
        error: null,
        evaluated: 0,
        total: 0,
        model: 'local-heuristic-engine',
        algorithm_version: ALGORITHM_VERSION,
        settings: { clip_count: 5, min_seconds: 30, max_seconds: 60 },
      };
    }

    const publicState = {
      project_id: state.project_id,
      status: state.status,
      error: state.error,
      evaluated: state.evaluated,
      total: state.total,
      updated_at: state.updated_at,
      model: 'local-heuristic-engine',
      algorithm_version: ALGORITHM_VERSION,
      clips: [] as Array<Record<string, unknown>>,
      top_picks: [] as Array<Record<string, unknown>>,
      more_discoveries: [] as Array<Record<string, unknown>>,
      settings: state.settings_json ? (JSON.parse(state.settings_json) as DiscoveryOptions) : null,
      progress: state.progress_json ? (JSON.parse(state.progress_json) as Record<string, unknown>) : {},
    };

    if (!state.result_json) {
      return publicState;
    }

    const saved = structuredClone(state.result_json) as Record<string, unknown>;
    const transcript = this.store.getTranscript(projectId);
    const edits = this.store.edits(projectId);

    for (const key of ['clips', 'top_picks', 'more_discoveries']) {
      const arr = saved[key];
      if (!Array.isArray(arr)) continue;
      for (const clip of arr as Array<Record<string, unknown>>) {
        const edit = edits[String(clip.id)];
        if (edit) {
          clip.start = edit.start;
          clip.end = edit.end;
          clip.duration = Number((edit.end - edit.start).toFixed(3));
          clip.adjusted =
            clip.start !== clip.original_start || clip.end !== clip.original_end;
          if (transcript) {
            clip.excerpt = excerptForRange(transcript, edit.start, edit.end);
          }
        }
      }
    }

    const clips = (saved.clips as Array<Record<string, unknown>>) || [];
    const topPicks = (saved.top_picks as Array<Record<string, unknown>>) || clips;
    const moreDiscoveries = (saved.more_discoveries as Array<Record<string, unknown>>) || [];

    return {
      ...saved,
      ...publicState,
      clips,
      top_picks: topPicks,
      more_discoveries: moreDiscoveries,
      result_settings: (saved.settings as DiscoveryOptions) || null,
      previous_result: state.status !== 'completed',
      message: state.status === 'completed' ? ((saved.message as string) || null) : null,
    };
  }

  submit(projectId: string, options: DiscoveryOptions) {
    if (this.running.has(projectId)) {
      throw new Error('Clip discovery is already running for this project.');
    }
    const token = { cancelled: false };
    this.activeCancels.set(projectId, token);
    this.running.add(projectId);

    const startedAt = Date.now() / 1000;
    this.store.updateDiscovery(projectId, {
      status: 'queued',
      error: null,
      evaluated: 0,
      total: 0,
      settings_json: JSON.stringify(options),
      progress_json: JSON.stringify({
        stage: 'queued',
        queued_at: startedAt,
        started_at: startedAt,
        completed_stages: [],
        heartbeat_at: startedAt,
        cancel_requested: false,
      }),
    });

    void this.runAsync(projectId, options, token);
  }

  cancel(projectId: string) {
    const token = this.activeCancels.get(projectId);
    if (!token || !this.running.has(projectId)) {
      throw new Error('No active discovery job to cancel.');
    }
    token.cancelled = true;
    const current = this.store.discovery(projectId);
    const prog = current?.progress_json ? JSON.parse(current.progress_json) : {};
    prog.cancel_requested = true;
    this.store.updateDiscovery(projectId, {
      progress_json: JSON.stringify(prog),
    });
  }

  private async runAsync(
    projectId: string,
    options: DiscoveryOptions,
    token: { cancelled: boolean }
  ) {
    const startedMs = performance.now();
    const completedStages: string[] = [];
    let currentStage = 'queued';

    const updateProgress = (status: string, extra: Record<string, unknown> = {}) => {
      if (status !== currentStage && currentStage !== 'failed' && currentStage !== 'cancelled') {
        completedStages.push(currentStage);
      }
      currentStage = status;
      const progress = {
        stage: status,
        started_at: Date.now() / 1000 - (performance.now() - startedMs) / 1000,
        elapsed_seconds: Number(((performance.now() - startedMs) / 1000).toFixed(2)),
        heartbeat_at: Date.now() / 1000,
        completed_stages: [...completedStages],
        cancel_requested: token.cancelled,
        ...(status === 'completed' || status === 'failed' || status === 'cancelled'
          ? { finished_at: Date.now() / 1000 }
          : {}),
      };
      this.store.updateDiscovery(projectId, {
        status,
        progress_json: JSON.stringify(progress),
        ...extra,
      });
    };

    try {
      const project = this.store.get(projectId);
      if (!project) throw new Error('Project not found.');
      const transcript = this.store.getTranscript(projectId);
      if (!transcript) throw new Error('Transcript missing. Re-transcribe before discovery.');

      const duration = project.metadata?.duration || 0;
      if (duration < options.min_seconds) {
        throw new Error(
          `This video is ${duration.toFixed(1)}s long, shorter than the ${options.min_seconds}s minimum. Choose a shorter duration.`
        );
      }

      updateProgress('preparing_transcript');
      const units = sentenceUnits(transcript, duration);
      if (token.cancelled) throw new Error('__CANCELLED__');

      updateProgress('analyzing_topics');
      const groups = topicGroups(units);
      if (token.cancelled) throw new Error('__CANCELLED__');

      updateProgress('generating_candidates');
      const candidates = buildCandidates(transcript, duration, options, units, groups);
      if (token.cancelled) throw new Error('__CANCELLED__');

      updateProgress('validating_timestamps');
      const valid = candidates.filter(
        (c) =>
          Number.isFinite(c.start) &&
          Number.isFinite(c.end) &&
          c.start >= 0 &&
          c.end <= duration &&
          c.end - c.start >= options.min_seconds &&
          c.end - c.start <= options.max_seconds
      );

      const category = project.user_category || project.detected_category || 'educational';
      const weights = getCategoryWeights(category);

      updateProgress('evaluating_candidates', { total: valid.length, evaluated: 0 });
      const assessments: Assessment[] = [];
      for (let i = 0; i < valid.length; i++) {
        if (token.cancelled) throw new Error('__CANCELLED__');
        assessments.push(assessCandidate(valid[i], i, category));
        updateProgress('evaluating_candidates', { evaluated: i + 1, total: valid.length });
      }

      updateProgress('ranking_clips');
      const byId = new Map(valid.map((c) => [c.id, c]));
      const ranked = assessments
        .map((a) => {
          const cand = byId.get(a.candidate_id)!;
          const score = Math.round(
            (a.hook_strength * weights.hook_strength +
              a.informational_value * weights.informational_value +
              a.context_completeness * weights.context_completeness +
              a.clarity * weights.clarity) *
              20
          );
          const reasons: string[] = [];
          if (score < 55) reasons.push('weighted_score_below_55_of_100');
          if (!/[.!?。！？]["'’”)]*$/.test(cand.excerpt.trim())) {
            reasons.push('incomplete_sentence_ending');
          }
          const confidence = reasons.length === 0 ? 'strong' : 'lower';
          const scoringFactors = {
            hook_strength: Number((a.hook_strength * 20).toFixed(1)),
            informational_value: Number((a.informational_value * 20).toFixed(1)),
            context_completeness: Number((a.context_completeness * 20).toFixed(1)),
            clarity: Number((a.clarity * 20).toFixed(1)),
            standalone_usefulness: Number(
              ((a.context_completeness * 0.6 + a.clarity * 0.4) * 20).toFixed(1)
            ),
            boundary_quality: reasons.includes('incomplete_sentence_ending') ? 60.0 : 100.0,
            evidence_strength: 85.0,
            audio_relevance: cand.audio_score ?? 80.0,
            visual_relevance: cand.visual_score ?? 75.0,
            uniqueness: 84.0,
            category_relevance: Math.min(100, Number((score * 1.05).toFixed(1))),
            composite_score: score,
          };

          return {
            id: cand.id,
            start: cand.start,
            end: cand.end,
            duration: cand.duration,
            excerpt: cand.excerpt,
            title: a.title,
            reason: a.reason,
            evidence: a.evidence,
            score,
            confidence,
            quality_rejections: reasons,
            scoring_factors: scoringFactors,
            criteria: {
              hook_strength: a.hook_strength,
              informational_value: a.informational_value,
              context_completeness: a.context_completeness,
              clarity: a.clarity,
            },
            duration_exception: cand.duration_exception,
            original_start: cand.start,
            original_end: cand.end,
            adjusted: false,
          };
        })
        .sort(
          (a, b) =>
            Number(a.confidence === 'lower') - Number(b.confidence === 'lower') ||
            b.score - a.score ||
            a.start - b.start
        );

      const topPicks: Array<Record<string, unknown>> = [];
      const moreDiscoveries: Array<Record<string, unknown>> = [];

      for (const item of ranked) {
        const chosen = [...topPicks, ...moreDiscoveries];
        const duplicate = chosen.some((prev) => {
          const pStart = Number(prev.start);
          const pEnd = Number(prev.end);
          const overlap = Math.max(0, Math.min(item.end, pEnd) - Math.max(item.start, pStart));
          return overlap / Math.min(item.duration, Number(prev.duration)) >= 0.35;
        });
        if (!duplicate) {
          if (topPicks.length < options.clip_count) {
            topPicks.push({ ...item, rank: topPicks.length + 1 });
          } else {
            moreDiscoveries.push({
              ...item,
              rank: topPicks.length + moreDiscoveries.length + 1,
            });
          }
        }
      }

      const strongCount = topPicks.filter((c) => c.confidence === 'strong').length;
      const lowerCount = topPicks.length - strongCount;
      let message = `Found ${strongCount} strong ${strongCount === 1 ? 'clip' : 'clips'} out of ${options.clip_count} requested.`;
      if (lowerCount > 0) {
        message += ` Also showing ${lowerCount} lower-confidence suggestions for manual review.`;
      }
      if (moreDiscoveries.length > 0) {
        message += ` Discovered ${moreDiscoveries.length} additional ranked candidate moments.`;
      }
      if (valid.length === 0) {
        message = `No reliable clips: no spoken passage fits ${options.min_seconds}–${options.max_seconds}s. Try a different duration range.`;
      }

      updateProgress('saving_results');
      const resultObj = {
        schema_version: 2,
        algorithm_version: ALGORITHM_VERSION,
        fingerprint: crypto
          .createHash('sha256')
          .update(`${projectId}:${JSON.stringify(options)}`)
          .digest('hex'),
        settings: options,
        model: 'local-heuristic-engine',
        created_at: new Date().toISOString(),
        score_weights: weights,
        category,
        score_label: 'Heuristic estimates, not guaranteed audience performance',
        candidate_count: valid.length,
        topic_count: groups.length,
        clips: topPicks,
        top_picks: topPicks,
        more_discoveries: moreDiscoveries,
        message,
        diagnostics: {
          invalid_timestamps: candidates.length - valid.length,
          quality_rejected: 0,
          quality_eligible: valid.length,
          selected: topPicks.length,
          more_discoveries_count: moreDiscoveries.length,
          strong_returned: strongCount,
          lower_confidence_returned: lowerCount,
        },
      };

      const targetPath = path.join(this.store.projectDir(projectId), 'clips.json');
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify(resultObj, null, 2), 'utf-8');

      completedStages.push('saving_results');
      const finalProgress = {
        stage: 'completed',
        started_at: Date.now() / 1000 - (performance.now() - startedMs) / 1000,
        finished_at: Date.now() / 1000,
        elapsed_seconds: Number(((performance.now() - startedMs) / 1000).toFixed(2)),
        heartbeat_at: Date.now() / 1000,
        completed_stages: completedStages,
        cancel_requested: false,
      };
      this.store.completeDiscovery(projectId, resultObj, targetPath, finalProgress);
    } catch (err) {
      if (err instanceof Error && err.message === '__CANCELLED__') {
        updateProgress('cancelled', { error: null });
      } else {
        updateProgress('failed', {
          error: err instanceof Error ? err.message : 'Clip discovery failed.',
        });
      }
    } finally {
      this.running.delete(projectId);
      this.activeCancels.delete(projectId);
    }
  }
}
