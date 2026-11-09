"""
Audio event detection using FFmpeg and librosa for enhanced candidate generation.
Detects silence, volume changes, energy patterns, and audio transitions.
"""
import json
import logging
import re
import subprocess
import warnings
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import numpy as np

logger = logging.getLogger(__name__)

# Suppress librosa warnings about audio conversion
warnings.filterwarnings('ignore', category=UserWarning, module='librosa')

try:
    import librosa
    import soundfile as sf
    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False
    logger.warning('librosa not available - audio energy analysis will be disabled')


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
    
    def analyze(self, video_path: Path, duration: float, audio_path: Optional[Path] = None) -> Dict:
        """
        Analyze audio track for events and characteristics.
        
        Args:
            video_path: Path to video file
            duration: Video duration in seconds
            audio_path: Optional pre-extracted audio WAV file (16kHz mono)
        
        Returns:
            Dictionary with detected events and audio characteristics
        """
        results = {
            'silence_periods': [],
            'speech_regions': [],
            'volume_peaks': [],
            'energy_timeline': [],
            'audio_events': [],
            'characteristics': {}
        }
        
        try:
            # Detect silence periods using FFmpeg
            silence_events = self._detect_silence(video_path)
            results['silence_periods'] = silence_events
            
            # Infer speech regions from silence gaps
            speech_regions = self._infer_speech_regions(silence_events, duration)
            results['speech_regions'] = speech_regions
            
            # Enhanced audio analysis with librosa (if available and audio provided)
            if LIBROSA_AVAILABLE and audio_path and audio_path.exists():
                try:
                    energy_data = self._analyze_audio_energy(audio_path, duration)
                    results['energy_timeline'] = energy_data['timeline']
                    results['volume_peaks'] = energy_data['peaks']
                    results['characteristics'].update(energy_data['characteristics'])
                except Exception as e:
                    logger.warning('Audio energy analysis failed: %s', e)
            
            # Calculate basic audio characteristics
            base_characteristics = {
                'silence_percentage': sum(s['duration'] for s in silence_events) / duration if duration > 0 else 0,
                'speech_percentage': sum(s['duration'] for s in speech_regions) / duration if duration > 0 else 0,
                'silence_count': len(silence_events),
                'speech_region_count': len(speech_regions),
                'avg_speech_duration': sum(s['duration'] for s in speech_regions) / len(speech_regions) if speech_regions else 0
            }
            
            # Merge with energy characteristics if available
            if 'characteristics' in results and results['characteristics']:
                results['characteristics'] = {**base_characteristics, **results['characteristics']}
            else:
                results['characteristics'] = base_characteristics
            
            logger.info('Audio analysis complete: %d silence periods, %d speech regions, %d volume peaks',
                       len(silence_events), len(speech_regions), len(results['volume_peaks']))
            
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
    
    def _analyze_audio_energy(self, audio_path: Path, duration: float) -> Dict:
        """
        Analyze audio energy, dynamics, and volume peaks using librosa.
        
        Args:
            audio_path: Path to mono 16kHz WAV file
            duration: Total duration in seconds
        
        Returns:
            Dictionary with energy timeline, volume peaks, and characteristics
        """
        try:
            # Load audio file
            y, sr = librosa.load(str(audio_path), sr=16000, mono=True)
            
            # Compute RMS energy in frames (hop_length=512 gives ~31ms frames at 16kHz)
            hop_length = 512
            frame_length = 2048
            rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
            
            # Convert frame indices to timestamps
            times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
            
            # Build energy timeline (sample every ~1 second for efficiency)
            sample_interval = max(1, int(sr / hop_length))  # ~1 second
            energy_timeline = [
                {
                    'timestamp': float(times[i]),
                    'energy': float(rms[i]),
                    'energy_db': float(librosa.amplitude_to_db(np.array([rms[i]]))[0])
                }
                for i in range(0, len(rms), sample_interval)
            ]
            
            # Detect volume peaks
            volume_peaks = self._detect_volume_peaks(rms, times, sr, hop_length)
            
            # Calculate audio characteristics
            rms_mean = float(np.mean(rms))
            rms_std = float(np.std(rms))
            rms_max = float(np.max(rms))
            rms_min = float(np.min(rms[rms > 0])) if np.any(rms > 0) else 0
            
            # Dynamic range in dB
            if rms_max > 0 and rms_min > 0:
                dynamic_range_db = float(librosa.amplitude_to_db(np.array([rms_max]))[0] - 
                                        librosa.amplitude_to_db(np.array([rms_min]))[0])
            else:
                dynamic_range_db = 0.0
            
            # Classify audio intensity
            energy_db_mean = float(librosa.amplitude_to_db(np.array([rms_mean]))[0])
            if energy_db_mean > -20:
                intensity = 'high'
            elif energy_db_mean > -40:
                intensity = 'medium'
            else:
                intensity = 'low'
            
            characteristics = {
                'avg_energy': rms_mean,
                'avg_energy_db': energy_db_mean,
                'peak_energy': rms_max,
                'dynamic_range_db': dynamic_range_db,
                'peak_count': len(volume_peaks),
                'audio_intensity': intensity
            }
            
            return {
                'timeline': energy_timeline,
                'peaks': volume_peaks,
                'characteristics': characteristics
            }
            
        except Exception as e:
            logger.warning('Audio energy analysis failed: %s', e)
            return {
                'timeline': [],
                'peaks': [],
                'characteristics': {}
            }
    
    def _detect_volume_peaks(self, rms: np.ndarray, times: np.ndarray, sr: int, hop_length: int) -> List[Dict]:
        """
        Detect significant volume peaks in the audio signal.
        
        Args:
            rms: RMS energy array
            times: Corresponding timestamps
            sr: Sample rate
            hop_length: Hop length used for RMS computation
        
        Returns:
            List of volume peak events with timestamps and magnitudes
        """
        peaks = []
        
        # Calculate moving average for baseline
        window_size = int(2.0 * sr / hop_length)  # 2-second window
        if len(rms) < window_size:
            return peaks
        
        # Compute moving average
        rms_smooth = np.convolve(rms, np.ones(window_size)/window_size, mode='same')
        
        # Find peaks significantly above the moving average
        threshold_multiplier = 1.5  # Peak must be 1.5x the local average
        min_peak_separation = 2.0  # Minimum 2 seconds between peaks
        
        last_peak_time = -999
        for i in range(window_size, len(rms) - window_size):
            if rms[i] > rms_smooth[i] * threshold_multiplier and rms[i] > 0.01:
                # Check if this is a local maximum
                window_start = max(0, i - window_size // 4)
                window_end = min(len(rms), i + window_size // 4)
                if rms[i] == np.max(rms[window_start:window_end]):
                    current_time = times[i]
                    # Enforce minimum separation
                    if current_time - last_peak_time >= min_peak_separation:
                        magnitude = float(rms[i])
                        magnitude_db = float(librosa.amplitude_to_db(np.array([magnitude]))[0])
                        peaks.append({
                            'timestamp': float(current_time),
                            'magnitude': magnitude,
                            'magnitude_db': magnitude_db,
                            'type': 'volume_peak'
                        })
                        last_peak_time = current_time
        
        return peaks
    
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
