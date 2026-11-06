"""
Audio event detection using FFmpeg for enhanced candidate generation.
Detects silence, volume changes, and audio transitions without heavyweight models.
"""
import json
import logging
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)


class AudioEvent:
    """Represents a detected audio event."""
    def __init__(self, event_type: str, start: float, end: float, metadata: Dict = None):
        self.event_type = event_type
        self.start = start
        self.end = end
        self.metadata = metadata or {}
    
    def to_dict(self):
        return {
            'type': self.event_type,
            'start': self.start,
            'end': self.end,
            'metadata': self.metadata
        }


class AudioAnalyzer:
    """Analyzes audio tracks to detect events and boundaries."""
    
    def __init__(self, ffmpeg_command='ffmpeg'):
        self.ffmpeg = ffmpeg_command
    
    def analyze(self, video_path: Path, duration: float) -> Dict:
        """
        Analyze audio track for events and characteristics.
        
        Returns:
            Dictionary with detected events and audio characteristics
        """
        results = {
            'silence_periods': [],
            'speech_regions': [],
            'volume_peaks': [],
            'audio_events': [],
            'characteristics': {}
        }
        
        try:
            # Detect silence periods
            silence_events = self._detect_silence(video_path)
            results['silence_periods'] = silence_events
            
            # Infer speech regions from silence gaps
            speech_regions = self._infer_speech_regions(silence_events, duration)
            results['speech_regions'] = speech_regions
            
            # Calculate basic audio characteristics
            results['characteristics'] = {
                'silence_percentage': sum(s['duration'] for s in silence_events) / duration if duration > 0 else 0,
                'speech_percentage': sum(s['duration'] for s in speech_regions) / duration if duration > 0 else 0,
                'silence_count': len(silence_events),
                'speech_region_count': len(speech_regions),
                'avg_speech_duration': sum(s['duration'] for s in speech_regions) / len(speech_regions) if speech_regions else 0
            }
            
            logger.info('Audio analysis complete: %d silence periods, %d speech regions',
                       len(silence_events), len(speech_regions))
            
        except Exception as e:
            logger.warning('Audio analysis failed: %s', e, exc_info=True)
            # Return empty results on failure - don't block discovery
        
        return results
    
    def _detect_silence(self, video_path: Path, noise_threshold=-50, duration=0.5) -> List[Dict]:
        """
        Detect silence periods using FFmpeg silencedetect filter.
        
        Args:
            video_path: Path to video file
            noise_threshold: Noise level in dB (default -50dB)
            duration: Minimum silence duration in seconds
        
        Returns:
            List of silence events with start, end, duration
        """
        try:
            # FFmpeg silencedetect filter
            cmd = [
                self.ffmpeg, '-nostdin', '-i', str(video_path),
                '-af', f'silencedetect=n={noise_threshold}dB:d={duration}',
                '-f', 'null', '-'
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            # Parse stderr for silence events
            silence_events = []
            silence_start_pattern = re.compile(r'silence_start: ([\d.]+)')
            silence_end_pattern = re.compile(r'silence_end: ([\d.]+) \| silence_duration: ([\d.]+)')
            
            current_start = None
            for line in result.stderr.split('\n'):
                start_match = silence_start_pattern.search(line)
                if start_match:
                    current_start = float(start_match.group(1))
                
                end_match = silence_end_pattern.search(line)
                if end_match and current_start is not None:
                    end = float(end_match.group(1))
                    duration = float(end_match.group(2))
                    silence_events.append({
                        'start': current_start,
                        'end': end,
                        'duration': duration
                    })
                    current_start = None
            
            return silence_events
            
        except subprocess.TimeoutExpired:
            logger.warning('Silence detection timed out')
            return []
        except Exception as e:
            logger.warning('Silence detection failed: %s', e)
            return []
    
    def _infer_speech_regions(self, silence_events: List[Dict], duration: float) -> List[Dict]:
        """
        Infer speech regions as gaps between silence periods.
        
        Args:
            silence_events: List of detected silence periods
            duration: Total video duration
        
        Returns:
            List of speech regions with start, end, duration
        """
        if not silence_events:
            # No silence detected = all speech (or no analysis)
            return [{'start': 0, 'end': duration, 'duration': duration}]
        
        speech_regions = []
        
        # Sort silence events by start time
        sorted_silence = sorted(silence_events, key=lambda x: x['start'])
        
        # Check for speech before first silence
        if sorted_silence[0]['start'] > 0.5:  # At least 0.5s of speech
            speech_regions.append({
                'start': 0,
                'end': sorted_silence[0]['start'],
                'duration': sorted_silence[0]['start']
            })
        
        # Speech regions between silence periods
        for i in range(len(sorted_silence) - 1):
            gap_start = sorted_silence[i]['end']
            gap_end = sorted_silence[i + 1]['start']
            gap_duration = gap_end - gap_start
            
            if gap_duration > 0.5:  # Minimum 0.5s speech region
                speech_regions.append({
                    'start': gap_start,
                    'end': gap_end,
                    'duration': gap_duration
                })
        
        # Check for speech after last silence
        if sorted_silence[-1]['end'] < duration - 0.5:
            speech_regions.append({
                'start': sorted_silence[-1]['end'],
                'end': duration,
                'duration': duration - sorted_silence[-1]['end']
            })
        
        return speech_regions
    
    def generate_candidates_from_audio(self, audio_analysis: Dict, min_duration: float, max_duration: float) -> List[Tuple[float, float]]:
        """
        Generate candidate time ranges based on audio analysis.
        
        Args:
            audio_analysis: Results from analyze()
            min_duration: Minimum candidate duration
            max_duration: Maximum candidate duration
        
        Returns:
            List of (start, end) tuples for candidates
        """
        candidates = []
        speech_regions = audio_analysis.get('speech_regions', [])
        
        for region in speech_regions:
            region_start = region['start']
            region_end = region['end']
            region_duration = region['duration']
            
            # If region fits within bounds, use it directly
            if min_duration <= region_duration <= max_duration:
                candidates.append((region_start, region_end))
            
            # If region is longer, create overlapping windows
            elif region_duration > max_duration:
                current = region_start
                step = max_duration * 0.5  # 50% overlap
                
                while current + min_duration <= region_end:
                    end = min(current + max_duration, region_end)
                    if end - current >= min_duration:
                        candidates.append((current, end))
                    current += step
        
        return candidates
