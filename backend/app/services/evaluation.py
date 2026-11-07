"""
Evaluation metrics and feedback analysis for Discovery Intelligence V2.
Measurably tracks human evaluation, reference clip alignment, and discovery coverage.
Clearly distinguishes internal heuristic estimates from empirical human metrics.
"""
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class EvaluationMetrics:
    """Calculates measurable evaluation metrics from human feedback and reference clips."""

    @staticmethod
    def calculate_metrics(feedback_list: List[Dict], clips: List[Dict],
                          category: str = 'educational', duration: float = 0.0) -> Dict:
        """
        Calculate evaluation metrics from human feedback.
        
        Args:
            feedback_list: Stored feedback records
            clips: Discovered clips (Top Picks + More Discoveries)
            category: Video category
            duration: Video duration in seconds
        
        Returns:
            Structured metrics separating human empirical evaluation from heuristic estimates.
        """
        if not clips:
            return {
                'total_clips': 0,
                'feedback_count': 0,
                'human_evaluation': None,
                'heuristic_estimates': {},
                'note': 'No clips available for evaluation.'
            }

        # Map feedback by clip_id
        feedback_by_clip = {f['clip_id']: f for f in feedback_list}
        rating_counts = {'excellent': 0, 'good': 0, 'average': 0, 'bad': 0}
        action_counts = {'accepted': 0, 'rejected': 0, 'adjusted': 0}

        rated_clips = []
        for clip in clips:
            clip_id = clip.get('id')
            if clip_id in feedback_by_clip:
                fb = feedback_by_clip[clip_id]
                rated_clips.append({**clip, 'feedback': fb})
                
                rating = (fb.get('rating') or '').lower()
                if rating in rating_counts:
                    rating_counts[rating] += 1
                
                action = (fb.get('action') or '').lower()
                if action in {'accepted', 'accept'}:
                    action_counts['accepted'] += 1
                elif action in {'rejected', 'reject'}:
                    action_counts['rejected'] += 1
                elif action == 'adjusted':
                    action_counts['adjusted'] += 1

        total_feedback = len(rated_clips)

        # Base human evaluation metrics
        human_eval = None
        if total_feedback > 0:
            top_3 = [c for c in rated_clips if c.get('rank', 999) <= 3]
            top_5 = [c for c in rated_clips if c.get('rank', 999) <= 5]

            # Top-3 acceptance
            def is_positive(c):
                fb = c.get('feedback', {})
                return fb.get('action') in {'accepted', 'accept'} or fb.get('rating') in {'excellent', 'good'}

            accepted_top_3 = sum(1 for c in top_3 if is_positive(c))
            top_3_acceptance = round(accepted_top_3 / len(top_3), 3) if top_3 else 0.0

            # Precision@3: (excellent + good) / evaluated in top 3
            pos_top_3 = sum(1 for c in top_3 if (c.get('feedback', {}).get('rating') or '').lower() in {'excellent', 'good'})
            precision_at_3 = round(pos_top_3 / len(top_3), 3) if top_3 else 0.0

            # Overall precision
            pos_all = rating_counts['excellent'] + rating_counts['good']
            precision = round(pos_all / total_feedback, 3) if total_feedback else 0.0

            # Human-rated quality score (weighted average on 0-100 scale)
            weights = {'excellent': 100, 'good': 75, 'average': 50, 'bad': 25}
            sum_ratings = sum(rating_counts[r] * weights[r] for r in rating_counts)
            avg_human_quality = round(sum_ratings / total_feedback, 1)

            # Boundary accuracy analysis from user timestamp adjustments
            adjustments = []
            for c in rated_clips:
                fb = c.get('feedback', {})
                if fb.get('adjusted_start') is not None and fb.get('adjusted_end') is not None:
                    orig_s = fb.get('original_start', c.get('original_start', c.get('start', 0)))
                    orig_e = fb.get('original_end', c.get('original_end', c.get('end', 0)))
                    s_diff = abs(fb['adjusted_start'] - orig_s)
                    e_diff = abs(fb['adjusted_end'] - orig_e)
                    adjustments.append({'start_diff': s_diff, 'end_diff': e_diff, 'total_diff': (s_diff + e_diff) / 2.0})

            if adjustments:
                avg_start_adj = round(sum(a['start_diff'] for a in adjustments) / len(adjustments), 2)
                avg_end_adj = round(sum(a['end_diff'] for a in adjustments) / len(adjustments), 2)
                avg_offset = round(sum(a['total_diff'] for a in adjustments) / len(adjustments), 2)
                boundary_acc = round(max(0.0, 1.0 - (avg_offset / 5.0)) * 100, 1)
            else:
                avg_start_adj = 0.0
                avg_end_adj = 0.0
                avg_offset = 0.0
                boundary_acc = 100.0 if any(c.get('feedback', {}).get('action') in {'accepted', 'accept'} for c in rated_clips) else None

            # Context completeness rating
            context_ok = sum(1 for c in rated_clips if (c.get('feedback', {}).get('rating') or '').lower() in {'excellent', 'good', 'average'})
            context_completeness_rate = round(context_ok / total_feedback, 3)

            human_eval = {
                'is_measured_human_metric': True,
                'feedback_count': total_feedback,
                'total_clips_available': len(clips),
                'top_3_acceptance_rate': top_3_acceptance,
                'precision_at_3': precision_at_3,
                'overall_precision': precision,
                'human_rated_quality': avg_human_quality,
                'boundary_accuracy_percent': boundary_acc,
                'avg_boundary_adjustment_seconds': avg_offset,
                'avg_start_adjustment_seconds': avg_start_adj,
                'avg_end_adjustment_seconds': avg_end_adj,
                'context_completeness_rate': context_completeness_rate,
                'ratings_breakdown': rating_counts,
                'actions_breakdown': action_counts,
                'category': category,
            }

        # Timeline coverage and heuristic estimates
        total_clip_duration = sum(c.get('duration', 0) for c in clips)
        coverage_ratio = round(total_clip_duration / duration, 3) if duration > 0 else 0.0
        avg_heuristic_score = round(sum(c.get('score', 0) for c in clips) / len(clips), 1) if clips else 0.0

        heuristic_estimates = {
            'is_measured_human_metric': False,
            'metric_type': 'internal_heuristic_estimate',
            'estimated_average_score': avg_heuristic_score,
            'candidate_timeline_coverage_ratio': min(1.0, coverage_ratio),
            'total_clip_duration_seconds': round(total_clip_duration, 1),
            'video_duration_seconds': round(duration, 1),
            'disclaimer': 'Estimated internal scores are model-generated heuristics, not measured audience retention or accuracy.'
        }

        return {
            'category': category,
            'human_evaluation': human_eval,
            'heuristic_estimates': heuristic_estimates,
            'has_human_feedback': total_feedback > 0,
        }

    @staticmethod
    def calculate_discovery_quality(result: Dict) -> Dict:
        """Calculate discovery quality statistics from run diagnostics."""
        diagnostics = result.get('diagnostics', {})
        clips = result.get('clips', [])
        more = result.get('more_discoveries', [])
        all_clips = clips + more

        candidate_count = result.get('candidate_count', diagnostics.get('candidate_count', 0))
        quality_eligible = diagnostics.get('quality_eligible', 0)
        quality_rejected = diagnostics.get('quality_rejected', 0)
        selected = len(clips)
        strong_returned = diagnostics.get('strong_returned', sum(1 for c in clips if c.get('confidence') == 'strong'))

        total_rejected_for_overlap = max(0, candidate_count - quality_rejected - len(all_clips))
        duplicate_rate = round(total_rejected_for_overlap / max(1, candidate_count), 3)

        return {
            'candidate_count': candidate_count,
            'quality_pass_rate': round(quality_eligible / candidate_count, 3) if candidate_count > 0 else 0.0,
            'quality_rejection_rate': round(quality_rejected / candidate_count, 3) if candidate_count > 0 else 0.0,
            'duplicate_recommendation_rate': duplicate_rate,
            'strong_clip_rate': round(strong_returned / selected, 3) if selected > 0 else 0.0,
            'top_picks_count': len(clips),
            'more_discoveries_count': len(more),
        }

    @staticmethod
    def compare_with_reference(discovered_clips: List[Dict], reference_clips: List[Dict]) -> Dict:
        """
        Compare AI-generated suggestions with manually marked reference clips.
        
        Args:
            discovered_clips: AI-discovered clips (Top Picks + More Discoveries)
            reference_clips: Manually marked reference moments
            
        Returns:
            Comparison evaluation metrics (recall, precision, F1, boundary error).
        """
        if not reference_clips:
            return {'has_reference': False, 'message': 'No manual reference moments marked for this project.'}

        matches = []
        for ref in reference_clips:
            best_match = None
            best_overlap = 0.0
            r_dur = max(0.1, ref['end'] - ref['start'])

            for disc in discovered_clips:
                d_dur = max(0.1, disc['end'] - disc['start'])
                overlap = max(0.0, min(disc['end'], ref['end']) - max(disc['start'], ref['start']))
                overlap_ratio = overlap / min(d_dur, r_dur)

                if overlap_ratio > best_overlap:
                    best_overlap = overlap_ratio
                    best_match = disc

            if best_overlap >= 0.40:  # 40% temporal overlap counts as a matching discovery
                s_diff = abs(best_match['start'] - ref['start'])
                e_diff = abs(best_match['end'] - ref['end'])
                matches.append({
                    'reference_id': ref.get('id'),
                    'reference_title': ref.get('title', 'Manual Clip'),
                    'discovered_id': best_match.get('id'),
                    'discovered_title': best_match.get('title', 'Discovered Clip'),
                    'overlap_ratio': round(best_overlap, 3),
                    'start_difference_seconds': round(s_diff, 2),
                    'end_difference_seconds': round(e_diff, 2),
                    'boundary_error_seconds': round((s_diff + e_diff) / 2.0, 2),
                })

        num_ref = len(reference_clips)
        num_disc = len(discovered_clips)
        recall = round(len(matches) / num_ref, 3) if num_ref > 0 else 0.0
        precision = round(len(matches) / num_disc, 3) if num_disc > 0 else 0.0
        f1 = round(2 * (precision * recall) / (precision + recall), 3) if (precision + recall) > 0 else 0.0

        avg_boundary_err = (
            round(sum(m['boundary_error_seconds'] for m in matches) / len(matches), 2)
            if matches else None
        )

        return {
            'has_reference': True,
            'is_measured_human_metric': True,
            'reference_count': num_ref,
            'discovered_count': num_disc,
            'matches_found': len(matches),
            'recall': recall,
            'precision': precision,
            'f1_score': f1,
            'avg_boundary_error_seconds': avg_boundary_err,
            'boundary_accuracy_percent': round(max(0.0, 1.0 - (avg_boundary_err / 5.0)) * 100, 1) if avg_boundary_err is not None else 0.0,
            'matches': matches,
        }
