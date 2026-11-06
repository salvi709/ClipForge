"""
Evaluation metrics and feedback analysis for measuring discovery quality.
"""
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)


class EvaluationMetrics:
    """Calculate evaluation metrics from user feedback."""
    
    @staticmethod
    def calculate_metrics(feedback_list: List[Dict], clips: List[Dict]) -> Dict:
        """
        Calculate evaluation metrics from user feedback.
        
        Args:
            feedback_list: List of feedback records
            clips: List of discovered clips
        
        Returns:
            Dictionary of evaluation metrics
        """
        if not clips:
            return {
                'total_clips': 0,
                'feedback_count': 0,
                'metrics': {}
            }
        
        # Map feedback to clips
        feedback_by_clip = {f['clip_id']: f for f in feedback_list}
        
        # Count ratings
        rating_counts = {'excellent': 0, 'good': 0, 'average': 0, 'bad': 0}
        action_counts = {'accepted': 0, 'rejected': 0, 'adjusted': 0}
        
        rated_clips = []
        for clip in clips:
            clip_id = clip.get('id')
            if clip_id in feedback_by_clip:
                fb = feedback_by_clip[clip_id]
                rated_clips.append({**clip, 'feedback': fb})
                
                if fb.get('rating'):
                    rating_counts[fb['rating']] = rating_counts.get(fb['rating'], 0) + 1
                if fb.get('action'):
                    action_counts[fb['action']] = action_counts.get(fb['action'], 0) + 1
        
        total_feedback = len(rated_clips)
        
        metrics = {
            'total_clips': len(clips),
            'feedback_count': total_feedback,
            'feedback_rate': total_feedback / len(clips) if clips else 0,
            'ratings': rating_counts,
            'actions': action_counts
        }
        
        # Calculate derived metrics
        if total_feedback > 0:
            # Top-N acceptance rate
            top_3 = [c for c in rated_clips if c.get('rank', 999) <= 3]
            top_5 = [c for c in rated_clips if c.get('rank', 999) <= 5]
            
            accepted_top_3 = sum(1 for c in top_3 if c.get('feedback', {}).get('action') == 'accepted')
            accepted_top_5 = sum(1 for c in top_5 if c.get('feedback', {}).get('action') == 'accepted')
            
            metrics['top_3_acceptance'] = accepted_top_3 / len(top_3) if top_3 else 0
            metrics['top_5_acceptance'] = accepted_top_5 / len(top_5) if top_5 else 0
            
            # Precision (excellent + good ratings)
            excellent_good = rating_counts['excellent'] + rating_counts['good']
            metrics['precision'] = excellent_good / total_feedback
            
            # Quality score (weighted rating average)
            rating_values = {'excellent': 4, 'good': 3, 'average': 2, 'bad': 1}
            weighted_sum = sum(rating_counts[r] * rating_values[r] for r in rating_counts)
            metrics['avg_quality_score'] = weighted_sum / total_feedback / 4.0  # Normalize to 0-1
            
            # Boundary adjustment analysis
            adjustments = []
            for clip in rated_clips:
                fb = clip.get('feedback', {})
                if fb.get('adjusted_start') is not None and fb.get('adjusted_end') is not None:
                    original_start = clip.get('original_start', clip.get('start'))
                    original_end = clip.get('original_end', clip.get('end'))
                    
                    start_diff = abs(fb['adjusted_start'] - original_start)
                    end_diff = abs(fb['adjusted_end'] - original_end)
                    adjustments.append({'start_diff': start_diff, 'end_diff': end_diff})
            
            if adjustments:
                metrics['avg_start_adjustment'] = sum(a['start_diff'] for a in adjustments) / len(adjustments)
                metrics['avg_end_adjustment'] = sum(a['end_diff'] for a in adjustments) / len(adjustments)
                metrics['avg_total_adjustment'] = (metrics['avg_start_adjustment'] + metrics['avg_end_adjustment']) / 2
                metrics['boundary_accuracy'] = 1.0 - min(1.0, metrics['avg_total_adjustment'] / 5.0)  # 5s = 0 accuracy
            else:
                metrics['avg_start_adjustment'] = 0
                metrics['avg_end_adjustment'] = 0
                metrics['avg_total_adjustment'] = 0
                metrics['boundary_accuracy'] = 1.0  # No adjustments = perfect boundaries
        
        return metrics
    
    @staticmethod
    def calculate_discovery_quality(result: Dict) -> Dict:
        """
        Calculate discovery quality metrics from discovery results.
        
        Args:
            result: Discovery result dictionary
        
        Returns:
            Quality metrics dictionary
        """
        diagnostics = result.get('diagnostics', {})
        clips = result.get('clips', [])
        
        candidate_count = diagnostics.get('candidate_count', 0)
        quality_eligible = diagnostics.get('quality_eligible', 0)
        quality_rejected = diagnostics.get('quality_rejected', 0)
        selected = diagnostics.get('selected', 0)
        strong_returned = diagnostics.get('strong_returned', 0)
        
        metrics = {
            'candidate_count': candidate_count,
            'quality_pass_rate': quality_eligible / candidate_count if candidate_count > 0 else 0,
            'quality_rejection_rate': quality_rejected / candidate_count if candidate_count > 0 else 0,
            'selection_rate': selected / quality_eligible if quality_eligible > 0 else 0,
            'strong_clip_rate': strong_returned / selected if selected > 0 else 0,
        }
        
        # Temporal coverage and diversity
        if clips:
            starts = [c['start'] for c in clips]
            ends = [c['end'] for c in clips]
            
            duration = result.get('duration', 0)
            if duration > 0:
                # Coverage: what % of video is covered by clips
                total_clip_duration = sum(c['duration'] for c in clips)
                metrics['temporal_coverage'] = total_clip_duration / duration
                
                # Spread: how distributed are clips across the video
                time_span = max(ends) - min(starts) if clips else 0
                metrics['temporal_spread'] = time_span / duration if duration > 0 else 0
            
            # Diversity: avg time between clips
            if len(clips) > 1:
                sorted_clips = sorted(clips, key=lambda c: c['start'])
                gaps = [sorted_clips[i+1]['start'] - sorted_clips[i]['end'] 
                       for i in range(len(sorted_clips)-1)]
                metrics['avg_clip_gap'] = sum(gaps) / len(gaps)
        
        return metrics
    
    @staticmethod
    def compare_with_reference(discovered_clips: List[Dict], reference_clips: List[Dict]) -> Dict:
        """
        Compare discovered clips with manually selected reference clips.
        
        Args:
            discovered_clips: AI-discovered clips
            reference_clips: Manually selected reference clips
        
        Returns:
            Comparison metrics
        """
        if not reference_clips:
            return {'error': 'No reference clips provided'}
        
        # Find matching clips (>50% temporal overlap)
        matches = []
        for ref in reference_clips:
            best_match = None
            best_overlap = 0
            
            for disc in discovered_clips:
                overlap = max(0, min(disc['end'], ref['end']) - max(disc['start'], ref['start']))
                overlap_ratio = overlap / min(disc['duration'], ref['duration'])
                
                if overlap_ratio > best_overlap:
                    best_overlap = overlap_ratio
                    best_match = disc
            
            if best_overlap > 0.5:  # >50% overlap = match
                matches.append({
                    'reference': ref,
                    'discovered': best_match,
                    'overlap': best_overlap
                })
        
        recall = len(matches) / len(reference_clips) if reference_clips else 0
        precision = len(matches) / len(discovered_clips) if discovered_clips else 0
        f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
        
        # Boundary accuracy for matches
        boundary_diffs = []
        for match in matches:
            ref = match['reference']
            disc = match['discovered']
            start_diff = abs(disc['start'] - ref['start'])
            end_diff = abs(disc['end'] - ref['end'])
            boundary_diffs.append((start_diff + end_diff) / 2)
        
        avg_boundary_diff = sum(boundary_diffs) / len(boundary_diffs) if boundary_diffs else 0
        
        return {
            'reference_count': len(reference_clips),
            'discovered_count': len(discovered_clips),
            'matches': len(matches),
            'recall': recall,
            'precision': precision,
            'f1_score': f1,
            'avg_boundary_difference': avg_boundary_diff,
            'match_details': matches
        }
