export class EvaluationMetrics {
  static calculateMetrics(
    feedbackList: Array<Record<string, unknown>>,
    clips: Array<Record<string, unknown>>,
    category = 'educational',
    duration = 0
  ) {
    if (!clips.length) {
      return {
        total_clips: 0,
        feedback_count: 0,
        human_evaluation: null,
        heuristic_estimates: {
          is_measured_human_metric: false,
          estimated_average_score: 0,
          candidate_timeline_coverage_ratio: 0,
          disclaimer:
            'Estimated internal scores are model-generated heuristics, not measured audience retention or accuracy.',
        },
        has_human_feedback: false,
        note: 'No clips available for evaluation.',
      };
    }

    const feedbackByClip = new Map<string, Record<string, unknown>>();
    for (const f of feedbackList) {
      feedbackByClip.set(String(f.clip_id), f);
    }

    const ratingCounts: Record<string, number> = {
      excellent: 0,
      good: 0,
      average: 0,
      bad: 0,
    };
    const actionCounts: Record<string, number> = {
      accepted: 0,
      rejected: 0,
      adjusted: 0,
    };

    const ratedClips: Array<Record<string, unknown> & { feedback: Record<string, unknown> }> = [];
    for (const clip of clips) {
      const clipId = String(clip.id);
      const fb = feedbackByClip.get(clipId);
      if (fb) {
        ratedClips.push({ ...clip, feedback: fb });
        const rating = String(fb.rating || '').toLowerCase();
        if (rating in ratingCounts) ratingCounts[rating] += 1;
        const action = String(fb.action || '').toLowerCase();
        if (action === 'accepted' || action === 'accept') actionCounts.accepted += 1;
        else if (action === 'rejected' || action === 'reject') actionCounts.rejected += 1;
        else if (action === 'adjusted') actionCounts.adjusted += 1;
      }
    }

    const totalFeedback = ratedClips.length;
    let humanEval: Record<string, unknown> | null = null;

    if (totalFeedback > 0) {
      const top3 = ratedClips.filter((c) => Number(c.rank || 999) <= 3);
      const isPositive = (c: { feedback: Record<string, unknown> }) => {
        const action = String(c.feedback.action || '').toLowerCase();
        const rating = String(c.feedback.rating || '').toLowerCase();
        return action === 'accepted' || action === 'accept' || rating === 'excellent' || rating === 'good';
      };

      const acceptedTop3 = top3.filter(isPositive).length;
      const top3Acceptance = top3.length ? Number((acceptedTop3 / top3.length).toFixed(3)) : 0;

      const posTop3 = top3.filter((c) =>
        ['excellent', 'good'].includes(String(c.feedback.rating || '').toLowerCase())
      ).length;
      const precisionAt3 = top3.length ? Number((posTop3 / top3.length).toFixed(3)) : 0;

      const posAll = ratingCounts.excellent + ratingCounts.good;
      const precision = totalFeedback ? Number((posAll / totalFeedback).toFixed(3)) : 0;

      const weights: Record<string, number> = { excellent: 100, good: 75, average: 50, bad: 25 };
      const sumRatings = Object.entries(ratingCounts).reduce(
        (acc, [k, count]) => acc + count * (weights[k] || 0),
        0
      );
      const avgHumanQuality = Number((sumRatings / totalFeedback).toFixed(1));

      const adjustments: Array<{ start_diff: number; end_diff: number; total_diff: number }> = [];
      for (const c of ratedClips) {
        const fb = c.feedback;
        if (fb.adjusted_start !== null && fb.adjusted_start !== undefined && fb.adjusted_end !== null && fb.adjusted_end !== undefined) {
          const origS = Number(fb.original_start ?? c.original_start ?? c.start ?? 0);
          const origE = Number(fb.original_end ?? c.original_end ?? c.end ?? 0);
          const sDiff = Math.abs(Number(fb.adjusted_start) - origS);
          const eDiff = Math.abs(Number(fb.adjusted_end) - origE);
          adjustments.push({
            start_diff: sDiff,
            end_diff: eDiff,
            total_diff: (sDiff + eDiff) / 2,
          });
        }
      }

      let avgStartAdj = 0;
      let avgEndAdj = 0;
      let avgOffset = 0;
      let boundaryAcc: number | null = null;
      if (adjustments.length > 0) {
        avgStartAdj = Number(
          (adjustments.reduce((s, a) => s + a.start_diff, 0) / adjustments.length).toFixed(2)
        );
        avgEndAdj = Number(
          (adjustments.reduce((s, a) => s + a.end_diff, 0) / adjustments.length).toFixed(2)
        );
        avgOffset = Number(
          (adjustments.reduce((s, a) => s + a.total_diff, 0) / adjustments.length).toFixed(2)
        );
        boundaryAcc = Number((Math.max(0, 1 - avgOffset / 5) * 100).toFixed(1));
      } else if (
        ratedClips.some((c) => ['accepted', 'accept'].includes(String(c.feedback.action || '').toLowerCase()))
      ) {
        boundaryAcc = 100.0;
      }

      const contextOk = ratedClips.filter((c) =>
        ['excellent', 'good', 'average'].includes(String(c.feedback.rating || '').toLowerCase())
      ).length;

      humanEval = {
        is_measured_human_metric: true,
        feedback_count: totalFeedback,
        total_clips_available: clips.length,
        top_3_acceptance_rate: top3Acceptance,
        precision_at_3: precisionAt3,
        overall_precision: precision,
        human_rated_quality: avgHumanQuality,
        boundary_accuracy_percent: boundaryAcc,
        avg_boundary_adjustment_seconds: avgOffset,
        avg_start_adjustment_seconds: avgStartAdj,
        avg_end_adjustment_seconds: avgEndAdj,
        context_completeness_rate: Number((contextOk / totalFeedback).toFixed(3)),
        ratings_breakdown: ratingCounts,
        actions_breakdown: actionCounts,
        category,
      };
    }

    const totalClipDuration = clips.reduce((s, c) => s + Number(c.duration || 0), 0);
    const coverageRatio = duration > 0 ? Number((totalClipDuration / duration).toFixed(3)) : 0;
    const avgHeuristicScore = clips.length
      ? Number((clips.reduce((s, c) => s + Number(c.score || 0), 0) / clips.length).toFixed(1))
      : 0;

    return {
      category,
      human_evaluation: humanEval,
      heuristic_estimates: {
        is_measured_human_metric: false,
        metric_type: 'internal_heuristic_estimate',
        estimated_average_score: avgHeuristicScore,
        candidate_timeline_coverage_ratio: Math.min(1.0, coverageRatio),
        total_clip_duration_seconds: Number(totalClipDuration.toFixed(1)),
        video_duration_seconds: Number(duration.toFixed(1)),
        disclaimer:
          'Estimated internal scores are model-generated heuristics, not measured audience retention or accuracy.',
      },
      has_human_feedback: totalFeedback > 0,
    };
  }

  static calculateDiscoveryQuality(result: Record<string, unknown>) {
    const diagnostics = (result.diagnostics as Record<string, unknown>) || {};
    const clips = (result.clips as Array<Record<string, unknown>>) || [];
    const more = (result.more_discoveries as Array<Record<string, unknown>>) || [];
    const allClips = [...clips, ...more];

    const candidateCount = Number(result.candidate_count ?? diagnostics.candidate_count ?? 0);
    const qualityEligible = Number(diagnostics.quality_eligible ?? 0);
    const qualityRejected = Number(diagnostics.quality_rejected ?? 0);
    const selected = clips.length;
    const strongReturned = Number(
      diagnostics.strong_returned ?? clips.filter((c) => c.confidence === 'strong').length
    );

    const totalRejectedForOverlap = Math.max(0, candidateCount - qualityRejected - allClips.length);
    const duplicateRate = Number(
      (totalRejectedForOverlap / Math.max(1, candidateCount)).toFixed(3)
    );

    return {
      candidate_count: candidateCount,
      quality_pass_rate: candidateCount > 0 ? Number((qualityEligible / candidateCount).toFixed(3)) : 0,
      quality_rejection_rate: candidateCount > 0 ? Number((qualityRejected / candidateCount).toFixed(3)) : 0,
      duplicate_recommendation_rate: duplicateRate,
      strong_clip_rate: selected > 0 ? Number((strongReturned / selected).toFixed(3)) : 0,
      top_picks_count: clips.length,
      more_discoveries_count: more.length,
    };
  }

  static compareWithReference(
    discoveredClips: Array<Record<string, unknown>>,
    referenceClips: Array<Record<string, unknown>>
  ) {
    if (!referenceClips.length) {
      return {
        has_reference: false,
        message: 'No manual reference moments marked for this project.',
      };
    }

    const matches: Array<Record<string, unknown>> = [];
    for (const ref of referenceClips) {
      let bestMatch: Record<string, unknown> | null = null;
      let bestOverlap = 0;
      const rStart = Number(ref.start);
      const rEnd = Number(ref.end);
      const rDur = Math.max(0.1, rEnd - rStart);

      for (const disc of discoveredClips) {
        const dStart = Number(disc.start);
        const dEnd = Number(disc.end);
        const dDur = Math.max(0.1, dEnd - dStart);
        const overlap = Math.max(0, Math.min(dEnd, rEnd) - Math.max(dStart, rStart));
        const ratio = overlap / Math.min(dDur, rDur);
        if (ratio > bestOverlap) {
          bestOverlap = ratio;
          bestMatch = disc;
        }
      }

      if (bestOverlap >= 0.4 && bestMatch) {
        const sDiff = Math.abs(Number(bestMatch.start) - rStart);
        const eDiff = Math.abs(Number(bestMatch.end) - rEnd);
        matches.push({
          reference_id: ref.id,
          reference_title: ref.title || 'Manual Clip',
          discovered_id: bestMatch.id,
          discovered_title: bestMatch.title || 'Discovered Clip',
          overlap_ratio: Number(bestOverlap.toFixed(3)),
          start_difference_seconds: Number(sDiff.toFixed(2)),
          end_difference_seconds: Number(eDiff.toFixed(2)),
          boundary_error_seconds: Number(((sDiff + eDiff) / 2).toFixed(2)),
        });
      }
    }

    const numRef = referenceClips.length;
    const numDisc = discoveredClips.length;
    const recall = numRef > 0 ? Number((matches.length / numRef).toFixed(3)) : 0;
    const precision = numDisc > 0 ? Number((matches.length / numDisc).toFixed(3)) : 0;
    const f1 =
      precision + recall > 0
        ? Number(((2 * precision * recall) / (precision + recall)).toFixed(3))
        : 0;
    const avgBoundaryErr = matches.length
      ? Number(
          (
            matches.reduce((s, m) => s + Number(m.boundary_error_seconds), 0) / matches.length
          ).toFixed(2)
        )
      : null;

    return {
      has_reference: true,
      is_measured_human_metric: true,
      reference_count: numRef,
      discovered_count: numDisc,
      matches_found: matches.length,
      recall,
      precision,
      f1_score: f1,
      avg_boundary_error_seconds: avgBoundaryErr,
      boundary_accuracy_percent:
        avgBoundaryErr !== null
          ? Number((Math.max(0, 1 - avgBoundaryErr / 5) * 100).toFixed(1))
          : 0,
      matches,
    };
  }
}
