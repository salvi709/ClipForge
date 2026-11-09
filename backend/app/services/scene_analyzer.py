"""
Scene boundary detection using FFmpeg and OpenCV for visual-based candidate generation.
Detects scene changes, extracts representative frames, and analyzes motion.
"""
import json
import logging
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import numpy as np

logger = logging.getLogger(__name__)

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    logger.warning('OpenCV not available - frame extraction and motion analysis will be disabled')


class SceneAnalyzer:
    """Analyzes video for scene changes and visual events."""
    
    def __init__(self, ffmpeg_command='ffmpeg'):
        self.ffmpeg = ffmpeg_command
    
    def analyze(self, video_path: Path, duration: float, project_folder: Optional[Path] = None) -> Dict:
        """
        Analyze video for scene changes and visual characteristics.
        
        Args:
            video_path: Path to video file
            duration: Video duration in seconds
            project_folder: Optional project folder for storing frames
        
        Returns:
            Dictionary with detected scenes and visual characteristics
        """
        results = {
            'scene_changes': [],
            'scene_count': 0,
            'representative_frames': [],
            'motion_analysis': {},
            'characteristics': {}
        }
        
        try:
            # Detect scene changes
            scene_changes = self._detect_scene_changes(video_path)
            results['scene_changes'] = scene_changes
            results['scene_count'] = len(scene_changes) + 1  # +1 for first scene
            
            # Extract representative frames and analyze motion if OpenCV available
            if CV2_AVAILABLE and project_folder:
                frames_data = self._extract_representative_frames(video_path, scene_changes, duration, project_folder)
                results['representative_frames'] = frames_data['frames']
                results['motion_analysis'] = frames_data['motion']
            
            # Calculate characteristics
            if scene_changes:
                avg_scene_duration = duration / (len(scene_changes) + 1)
                scene_change_rate = len(scene_changes) / duration if duration > 0 else 0
                
                # Classify visual complexity based on scene change rate
                if scene_change_rate > 0.2:
                    complexity = 'high'
                elif scene_change_rate > 0.05:
                    complexity = 'medium'
                else:
                    complexity = 'low'
                
                # Add motion-based complexity adjustment
                if results['motion_analysis']:
                    avg_motion = results['motion_analysis'].get('avg_motion_magnitude', 0)
                    if avg_motion > 15:
                        complexity = 'high' if complexity != 'high' else 'very_high'
                
                results['characteristics'] = {
                    'avg_scene_duration': avg_scene_duration,
                    'scene_change_rate': scene_change_rate,
                    'visual_complexity': complexity,
                    'motion_level': results['motion_analysis'].get('motion_level', 'unknown')
                }
            else:
                results['characteristics'] = {
                    'avg_scene_duration': duration,
                    'scene_change_rate': 0,
                    'visual_complexity': 'static',
                    'motion_level': 'static'
                }
            
            logger.info('Scene analysis complete: %d scene changes, %d frames extracted',
                       len(scene_changes), len(results['representative_frames']))
            
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
    
    def _extract_representative_frames(self, video_path: Path, scene_changes: List[Dict], 
                                      duration: float, project_folder: Path) -> Dict:
        """
        Extract representative frames at scene boundaries and analyze motion.
        
        Args:
            video_path: Path to video file
            scene_changes: List of detected scene changes
            duration: Video duration
            project_folder: Folder to save frames
        
        Returns:
            Dictionary with frame paths and motion analysis
        """
        frames_data = {
            'frames': [],
            'motion': {}
        }
        
        try:
            # Create frames subdirectory
            frames_dir = project_folder / 'frames'
            frames_dir.mkdir(exist_ok=True)
            
            # Open video
            cap = cv2.VideoCapture(str(video_path))
            if not cap.isOpened():
                logger.warning('Could not open video for frame extraction')
                return frames_data
            
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            # Timestamps to extract: scene changes + start + end + midpoints
            extract_timestamps = [0]  # Start
            
            if scene_changes:
                extract_timestamps.extend([sc['timestamp'] for sc in scene_changes])
            
            extract_timestamps.append(duration)  # End
            
            # Add midpoints between major scenes (max 10 total frames)
            if len(extract_timestamps) < 10:
                sorted_ts = sorted(extract_timestamps)
                for i in range(len(sorted_ts) - 1):
                    if len(extract_timestamps) >= 10:
                        break
                    midpoint = (sorted_ts[i] + sorted_ts[i + 1]) / 2
                    if midpoint not in extract_timestamps:
                        extract_timestamps.append(midpoint)
            
            extract_timestamps = sorted(set(extract_timestamps))[:10]  # Limit to 10 frames
            
            # Extract frames and compute motion
            prev_frame = None
            motion_magnitudes = []
            
            for idx, timestamp in enumerate(extract_timestamps):
                frame_number = int(timestamp * fps)
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
                ret, frame = cap.read()
                
                if not ret:
                    continue
                
                # Save frame
                frame_filename = f'frame_{idx:03d}_t{timestamp:.1f}s.jpg'
                frame_path = frames_dir / frame_filename
                cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                
                # Compute motion if we have a previous frame
                if prev_frame is not None:
                    motion_mag = self._compute_motion_magnitude(prev_frame, frame)
                    motion_magnitudes.append(motion_mag)
                
                frames_data['frames'].append({
                    'timestamp': timestamp,
                    'path': str(frame_path.relative_to(project_folder)),
                    'frame_number': frame_number
                })
                
                prev_frame = frame.copy()
            
            cap.release()
            
            # Motion analysis summary
            if motion_magnitudes:
                avg_motion = float(np.mean(motion_magnitudes))
                max_motion = float(np.max(motion_magnitudes))
                
                # Classify motion level
                if avg_motion > 15:
                    motion_level = 'high'
                elif avg_motion > 8:
                    motion_level = 'medium'
                elif avg_motion > 3:
                    motion_level = 'low'
                else:
                    motion_level = 'static'
                
                frames_data['motion'] = {
                    'avg_motion_magnitude': avg_motion,
                    'max_motion_magnitude': max_motion,
                    'motion_level': motion_level,
                    'sample_count': len(motion_magnitudes)
                }
            
            logger.info('Extracted %d frames, avg motion: %.2f', 
                       len(frames_data['frames']),
                       frames_data['motion'].get('avg_motion_magnitude', 0))
            
        except Exception as e:
            logger.warning('Frame extraction failed: %s', e)
        
        return frames_data
    
    def _compute_motion_magnitude(self, frame1: np.ndarray, frame2: np.ndarray) -> float:
        """
        Compute motion magnitude between two frames using optical flow.
        
        Args:
            frame1: First frame (BGR)
            frame2: Second frame (BGR)
        
        Returns:
            Average motion magnitude
        """
        try:
            # Convert to grayscale
            gray1 = cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY)
            gray2 = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)
            
            # Compute dense optical flow
            flow = cv2.calcOpticalFlowFarneback(
                gray1, gray2, None,
                pyr_scale=0.5, levels=3, winsize=15,
                iterations=3, poly_n=5, poly_sigma=1.2, flags=0
            )
            
            # Calculate magnitude of flow
            mag, ang = cv2.cartToPolar(flow[..., 0], flow[..., 1])
            
            # Average magnitude
            return float(np.mean(mag))
            
        except Exception as e:
            logger.warning('Motion computation failed: %s', e)
            return 0.0
    
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
