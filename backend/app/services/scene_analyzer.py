"""
Scene boundary detection using FFmpeg for visual-based candidate generation.
Detects scene changes and visual transitions without heavyweight models.
"""
import json
import logging
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)


class SceneAnalyzer:
    """Analyzes video for scene changes and visual events."""
    
    def __init__(self, ffmpeg_command='ffmpeg'):
        self.ffmpeg = ffmpeg_command
    
    def analyze(self, video_path: Path, duration: float) -> Dict:
        """
        Analyze video for scene changes and visual characteristics.
        
        Returns:
            Dictionary with detected scenes and visual characteristics
        """
        results = {
            'scene_changes': [],
            'scene_count': 0,
            'characteristics': {}
        }
        
        try:
            # Detect scene changes
            scene_changes = self._detect_scene_changes(video_path)
            results['scene_changes'] = scene_changes
            results['scene_count'] = len(scene_changes) + 1  # +1 for first scene
            
            # Calculate characteristics
            if scene_changes:
                avg_scene_duration = duration / (len(scene_changes) + 1)
                results['characteristics'] = {
                    'avg_scene_duration': avg_scene_duration,
                    'scene_change_rate': len(scene_changes) / duration if duration > 0 else 0,
                    'visual_complexity': 'high' if len(scene_changes) / duration > 0.2 else 'medium' if len(scene_changes) / duration > 0.05 else 'low'
                }
            else:
                results['characteristics'] = {
                    'avg_scene_duration': duration,
                    'scene_change_rate': 0,
                    'visual_complexity': 'static'
                }
            
            logger.info('Scene analysis complete: %d scene changes detected', len(scene_changes))
            
        except Exception as e:
            logger.warning('Scene analysis failed: %s', e, exc_info=True)
            # Return empty results on failure - don't block discovery
        
        return results
    
    def _detect_scene_changes(self, video_path: Path, threshold=0.3) -> List[Dict]:
        """
        Detect scene changes using FFmpeg select filter.
        
        Args:
            video_path: Path to video file
            threshold: Scene change threshold (0-1, lower = more sensitive)
        
        Returns:
            List of scene change timestamps
        """
        try:
            # Use FFmpeg select filter with scene detection
            # Output frame timestamps where scene changes occur
            cmd = [
                self.ffmpeg, '-nostdin', '-i', str(video_path),
                '-vf', f'select=gt(scene\\,{threshold}),showinfo',
                '-f', 'null', '-'
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            # Parse stderr for frame timestamps
            scene_changes = []
            pts_time_pattern = re.compile(r'pts_time:([\d.]+)')
            
            for line in result.stderr.split('\n'):
                if 'showinfo' in line:
                    match = pts_time_pattern.search(line)
                    if match:
                        timestamp = float(match.group(1))
                        scene_changes.append({
                            'timestamp': timestamp,
                            'type': 'scene_change'
                        })
            
            # Remove very close scene changes (< 1 second apart)
            filtered_changes = []
            last_timestamp = -999
            for change in scene_changes:
                if change['timestamp'] - last_timestamp >= 1.0:
                    filtered_changes.append(change)
                    last_timestamp = change['timestamp']
            
            return filtered_changes
            
        except subprocess.TimeoutExpired:
            logger.warning('Scene detection timed out')
            return []
        except Exception as e:
            logger.warning('Scene detection failed: %s', e)
            return []
    
    def generate_candidates_from_scenes(self, scene_analysis: Dict, duration: float, 
                                       min_duration: float, max_duration: float) -> List[Tuple[float, float]]:
        """
        Generate candidate time ranges based on scene boundaries.
        
        Args:
            scene_analysis: Results from analyze()
            duration: Total video duration
            min_duration: Minimum candidate duration
            max_duration: Maximum candidate duration
        
        Returns:
            List of (start, end) tuples for candidates
        """
        candidates = []
        scene_changes = scene_analysis.get('scene_changes', [])
        
        if not scene_changes:
            # No scenes detected - generate overlapping windows across entire video
            return self._generate_fixed_windows(0, duration, min_duration, max_duration)
        
        # Generate candidates around scene boundaries
        boundaries = [0] + [sc['timestamp'] for sc in scene_changes] + [duration]
        
        for i in range(len(boundaries) - 1):
            scene_start = boundaries[i]
            scene_end = boundaries[i + 1]
            scene_duration = scene_end - scene_start
            
            # If scene fits within bounds, use it
            if min_duration <= scene_duration <= max_duration:
                candidates.append((scene_start, scene_end))
            
            # If scene is longer, create windows within it
            elif scene_duration > max_duration:
                candidates.extend(
                    self._generate_fixed_windows(scene_start, scene_end, min_duration, max_duration)
                )
            
            # Also create candidates that span scene boundaries
            if i < len(boundaries) - 2:  # Not the last scene
                boundary_start = max(0, boundaries[i + 1] - max_duration / 2)
                boundary_end = min(duration, boundaries[i + 1] + max_duration / 2)
                if min_duration <= boundary_end - boundary_start <= max_duration:
                    candidates.append((boundary_start, boundary_end))
        
        return candidates
    
    def _generate_fixed_windows(self, start: float, end: float, min_duration: float, max_duration: float) -> List[Tuple[float, float]]:
        """Generate overlapping fixed-size windows within a time range."""
        candidates = []
        duration = end - start
        
        if duration < min_duration:
            return candidates
        
        # Use 50% overlap for thorough coverage
        step = max_duration * 0.5
        current = start
        
        while current + min_duration <= end:
            window_end = min(current + max_duration, end)
            if window_end - current >= min_duration:
                candidates.append((current, window_end))
            current += step
        
        return candidates
