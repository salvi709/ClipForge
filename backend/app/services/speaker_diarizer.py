"""Speaker diarization service using pyannote.audio."""

import hashlib
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class SpeakerDiarizer:
    """
    Speaker diarization using pyannote.audio.
    
    Identifies different speakers and their speaking intervals.
    Works locally without cloud APIs.
    """
    
    def __init__(self, device='auto'):
        """
        Initialize diarizer.
        
        Args:
            device: 'auto', 'cpu', or 'cuda'
        """
        self.device = device
        self.pipeline = None
        self._device_resolved = None
        self._available = None
        self._error_message = None
        
    def is_available(self) -> tuple[bool, Optional[str]]:
        """
        Check if speaker diarization is available.
        
        Returns:
            (is_available, error_message)
        """
        if self._available is not None:
            return self._available, self._error_message
            
        try:
            import torch
            from pyannote.audio import Pipeline
            self._available = True
            self._error_message = None
            logger.info("Speaker diarization is available")
        except ImportError as e:
            self._available = False
            if 'torch' in str(e):
                self._error_message = (
                    "PyTorch is not installed. Speaker diarization requires PyTorch. "
                    "Install: pip install torch torchaudio"
                )
            elif 'pyannote' in str(e):
                self._error_message = (
                    "pyannote.audio is not installed. Speaker diarization requires pyannote.audio. "
                    "Install: pip install pyannote.audio"
                )
            else:
                self._error_message = f"Speaker diarization unavailable: {e}"
            logger.warning(self._error_message)
        except Exception as e:
            self._available = False
            self._error_message = f"Speaker diarization check failed: {e}"
            logger.error(self._error_message, exc_info=True)
            
        return self._available, self._error_message
    
    def _load_pipeline(self):
        """Load the diarization pipeline."""
        if self.pipeline is not None:
            return
            
        available, error = self.is_available()
        if not available:
            raise RuntimeError(error)
        
        import torch
        from pyannote.audio import Pipeline
        
        # Determine device
        if self.device == 'auto':
            if torch.cuda.is_available():
                self._device_resolved = 'cuda'
                logger.info("Using CUDA for speaker diarization")
            else:
                self._device_resolved = 'cpu'
                logger.info("CUDA unavailable, using CPU for speaker diarization")
        else:
            self._device_resolved = self.device
            logger.info(f"Using {self._device_resolved} for speaker diarization")
        
        try:
            # Load pre-trained pipeline
            # Note: First run requires internet to download model (~300MB)
            # Subsequent runs use cached model
            self.pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=None  # Public model, no token needed
            )
            
            if self._device_resolved == 'cuda':
                self.pipeline.to(torch.device('cuda'))
            
            logger.info(f"Loaded pyannote speaker diarization pipeline on {self._device_resolved}")
            
        except Exception as e:
            logger.error(f"Failed to load diarization pipeline: {e}", exc_info=True)
            if self._device_resolved == 'cuda':
                logger.info("Retrying on CPU...")
                self._device_resolved = 'cpu'
                self.pipeline = Pipeline.from_pretrained(
                    "pyannote/speaker-diarization-3.1",
                    use_auth_token=None
                )
                logger.info("Loaded pipeline on CPU (GPU failed)")
            else:
                raise
    
    def compute_fingerprint(self, audio_path: Path, version: str = "v1") -> str:
        """
        Compute fingerprint for caching.
        
        Args:
            audio_path: Path to audio file
            version: Algorithm version
            
        Returns:
            SHA256 fingerprint
        """
        hasher = hashlib.sha256()
        hasher.update(f"speaker-diarization-{version}".encode())
        hasher.update(str(audio_path.stat().st_size).encode())
        hasher.update(str(audio_path.stat().st_mtime).encode())
        return hasher.hexdigest()
    
    def analyze(
        self,
        audio_path: Path,
        duration: float,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ) -> Dict:
        """
        Perform speaker diarization on audio file.
        
        Args:
            audio_path: Path to audio file
            duration: Video duration in seconds
            min_speakers: Minimum number of speakers (None = auto)
            max_speakers: Maximum number of speakers (None = auto)
            
        Returns:
            Dictionary with speaker analysis:
            {
                'speakers': ['SPEAKER_00', 'SPEAKER_01', ...],
                'segments': [
                    {
                        'speaker': 'SPEAKER_00',
                        'start': 0.0,
                        'end': 8.5,
                        'confidence': 0.95
                    },
                    ...
                ],
                'speaker_count': 2,
                'overlapping_speech': [
                    {'start': 10.5, 'end': 11.2, 'speakers': ['SPEAKER_00', 'SPEAKER_01']}
                ],
                'device': 'cuda' or 'cpu',
                'processing_time': 5.2,
                'model_version': 'pyannote/speaker-diarization-3.1',
                'fingerprint': '...'
            }
        """
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        
        logger.info(f"Starting speaker diarization for {audio_path.name}")
        start_time = time.time()
        
        self._load_pipeline()
        
        try:
            # Run diarization
            diarization = self.pipeline(
                str(audio_path),
                min_speakers=min_speakers,
                max_speakers=max_speakers
            )
            
            # Extract segments
            segments = []
            speakers_set = set()
            
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                segments.append({
                    'speaker': speaker,
                    'start': round(turn.start, 3),
                    'end': round(turn.end, 3),
                    'confidence': 0.9  # pyannote doesn't provide per-segment confidence
                })
                speakers_set.add(speaker)
            
            # Sort by start time
            segments.sort(key=lambda x: x['start'])
            
            # Detect overlapping speech
            overlapping = []
            for i, seg1 in enumerate(segments):
                for seg2 in segments[i+1:]:
                    # Check for overlap
                    if seg2['start'] < seg1['end'] and seg2['speaker'] != seg1['speaker']:
                        overlap_start = max(seg1['start'], seg2['start'])
                        overlap_end = min(seg1['end'], seg2['end'])
                        if overlap_end > overlap_start:
                            overlapping.append({
                                'start': round(overlap_start, 3),
                                'end': round(overlap_end, 3),
                                'speakers': sorted([seg1['speaker'], seg2['speaker']])
                            })
            
            processing_time = time.time() - start_time
            fingerprint = self.compute_fingerprint(audio_path)
            
            result = {
                'speakers': sorted(list(speakers_set)),
                'segments': segments,
                'speaker_count': len(speakers_set),
                'overlapping_speech': overlapping,
                'device': self._device_resolved,
                'processing_time': round(processing_time, 2),
                'model_version': 'pyannote/speaker-diarization-3.1',
                'fingerprint': fingerprint
            }
            
            logger.info(
                f"Diarization complete: {len(speakers_set)} speakers, "
                f"{len(segments)} segments, {processing_time:.1f}s on {self._device_resolved}"
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Speaker diarization failed: {e}", exc_info=True)
            # Return graceful failure
            return {
                'speakers': [],
                'segments': [],
                'speaker_count': 0,
                'overlapping_speech': [],
                'device': self._device_resolved or 'unknown',
                'processing_time': time.time() - start_time,
                'model_version': 'pyannote/speaker-diarization-3.1',
                'fingerprint': self.compute_fingerprint(audio_path),
                'error': str(e)
            }
    
    def associate_with_transcript(
        self,
        speaker_segments: List[Dict],
        transcript_segments: List[Dict]
    ) -> List[Dict]:
        """
        Associate transcript segments with speakers by timestamp overlap.
        
        Args:
            speaker_segments: List of speaker segments from analyze()
            transcript_segments: List of transcript segments with 'start', 'end', 'text'
            
        Returns:
            Transcript segments with added 'speaker' field
        """
        if not speaker_segments:
            logger.warning("No speaker segments to associate")
            return transcript_segments
        
        enriched = []
        
        for trans_seg in transcript_segments:
            trans_start = trans_seg['start']
            trans_end = trans_seg['end']
            trans_mid = (trans_start + trans_end) / 2
            
            # Find overlapping speaker segments
            overlaps = []
            for spk_seg in speaker_segments:
                if spk_seg['start'] <= trans_end and spk_seg['end'] >= trans_start:
                    # Calculate overlap duration
                    overlap_start = max(trans_start, spk_seg['start'])
                    overlap_end = min(trans_end, spk_seg['end'])
                    overlap_duration = overlap_end - overlap_start
                    overlaps.append((spk_seg['speaker'], overlap_duration))
            
            # Assign speaker with most overlap
            speaker = None
            if overlaps:
                speaker = max(overlaps, key=lambda x: x[1])[0]
            
            enriched_seg = {**trans_seg, 'speaker': speaker}
            enriched.append(enriched_seg)
        
        # Log statistics
        with_speaker = sum(1 for seg in enriched if seg['speaker'] is not None)
        logger.info(
            f"Associated {with_speaker}/{len(enriched)} transcript segments with speakers"
        )
        
        return enriched
    
    def get_speaker_timeline_text(self, segments: List[Dict]) -> str:
        """
        Generate human-readable speaker timeline.
        
        Args:
            segments: Speaker segments
            
        Returns:
            Formatted timeline text
        """
        if not segments:
            return "No speakers detected"
        
        lines = []
        for seg in segments:
            start_time = f"{int(seg['start']//60):02d}:{int(seg['start']%60):02d}"
            end_time = f"{int(seg['end']//60):02d}:{int(seg['end']%60):02d}"
            lines.append(f"{start_time}–{end_time} — {seg['speaker']}")
        
        return "\n".join(lines)
