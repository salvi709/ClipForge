"""YouTube transcript retrieval and normalization."""

import logging
import re
from typing import Optional, List, Dict, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)


class YouTubeTranscriptService:
    """
    Retrieve YouTube captions/subtitles and normalize to ClipForge format.
    
    Uses youtube-transcript-api to access publicly available captions.
    Supports manual transcript import as fallback.
    """
    
    def __init__(self):
        """Initialize YouTube transcript service."""
        self._available = None
        self._error_message = None
    
    def is_available(self) -> Tuple[bool, Optional[str]]:
        """
        Check if youtube-transcript-api is available.
        
        Returns:
            (is_available, error_message)
        """
        if self._available is not None:
            return self._available, self._error_message
        
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            self._available = True
            self._error_message = None
            logger.info("youtube-transcript-api is available")
        except ImportError:
            self._available = False
            self._error_message = (
                "youtube-transcript-api is not installed. "
                "Install: pip install youtube-transcript-api"
            )
            logger.warning(self._error_message)
        
        return self._available, self._error_message
    
    def get_transcript(
        self,
        video_id: str,
        languages: Optional[List[str]] = None
    ) -> Optional[Dict]:
        """
        Retrieve transcript from YouTube captions.
        
        Args:
            video_id: YouTube video ID
            languages: Preferred languages (default: ['en'])
            
        Returns:
            Dictionary with:
            {
                'segments': [
                    {'text': str, 'start': float, 'duration': float},
                    ...
                ],
                'language': str,
                'is_generated': bool,
                'source': 'youtube_captions'
            }
            
            Returns None if transcript unavailable.
        """
        available, error = self.is_available()
        if not available:
            logger.error(error)
            return None
        
        if languages is None:
            languages = ['en']
        
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            from youtube_transcript_api._errors import (
                TranscriptsDisabled,
                NoTranscriptFound,
                VideoUnavailable
            )
            
            # Fetch transcript
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Try to find manually created captions first
            transcript = None
            is_generated = False
            language_code = None
            
            try:
                for lang in languages:
                    try:
                        transcript = transcript_list.find_manually_created_transcript([lang])
                        is_generated = False
                        language_code = lang
                        logger.info(f"Found manual captions in {lang} for video {video_id}")
                        break
                    except NoTranscriptFound:
                        continue
            except Exception:
                pass
            
            # Fall back to auto-generated captions
            if transcript is None:
                try:
                    for lang in languages:
                        try:
                            transcript = transcript_list.find_generated_transcript([lang])
                            is_generated = True
                            language_code = lang
                            logger.info(f"Found auto-generated captions in {lang} for video {video_id}")
                            break
                        except NoTranscriptFound:
                            continue
                except Exception:
                    pass
            
            if transcript is None:
                logger.warning(f"No transcript found in languages {languages} for video {video_id}")
                return None
            
            # Fetch the actual transcript data
            segments = transcript.fetch()
            
            if not segments:
                logger.warning(f"Empty transcript for video {video_id}")
                return None
            
            logger.info(f"Retrieved {len(segments)} transcript segments for video {video_id}")
            
            return {
                'segments': segments,
                'language': language_code or 'unknown',
                'is_generated': is_generated,
                'source': 'youtube_captions'
            }
            
        except TranscriptsDisabled:
            logger.warning(f"Transcripts are disabled for video {video_id}")
            return None
        except NoTranscriptFound:
            logger.warning(f"No transcript found for video {video_id}")
            return None
        except VideoUnavailable:
            logger.error(f"Video unavailable: {video_id}")
            return None
        except Exception as e:
            logger.error(f"Error retrieving transcript: {e}", exc_info=True)
            return None
    
    @staticmethod
    def normalize_to_clipforge_format(youtube_transcript: Dict, video_id: str) -> Dict:
        """
        Convert YouTube transcript format to ClipForge transcript format.
        
        Args:
            youtube_transcript: Output from get_transcript()
            video_id: YouTube video ID
            
        Returns:
            ClipForge transcript format:
            {
                'language': str,
                'language_probability': float,
                'device': 'youtube',
                'segments': [
                    {
                        'id': int,
                        'start': float,
                        'end': float,
                        'text': str,
                        'words': []  # Empty for YouTube captions
                    },
                    ...
                ]
            }
        """
        segments = youtube_transcript['segments']
        language = youtube_transcript['language']
        
        clipforge_segments = []
        
        for idx, seg in enumerate(segments):
            start = seg['start']
            duration = seg['duration']
            end = start + duration
            text = seg['text'].strip()
            
            clipforge_segments.append({
                'id': idx,
                'start': round(start, 3),
                'end': round(end, 3),
                'text': text,
                'words': []  # YouTube captions don't provide word-level timestamps
            })
        
        return {
            'language': language,
            'language_probability': 0.99 if not youtube_transcript.get('is_generated') else 0.90,
            'device': 'youtube',
            'segments': clipforge_segments,
            'transcript_source': youtube_transcript['source'],
            'is_generated': youtube_transcript.get('is_generated', False)
        }
    
    @staticmethod
    def parse_srt(srt_content: str) -> List[Dict]:
        """
        Parse SRT subtitle format.
        
        Args:
            srt_content: SRT file content
            
        Returns:
            List of segments: [{'text': str, 'start': float, 'duration': float}, ...]
        """
        segments = []
        
        # Split by double newlines (subtitle blocks)
        blocks = re.split(r'\n\s*\n', srt_content.strip())
        
        for block in blocks:
            lines = block.strip().split('\n')
            if len(lines) < 3:
                continue
            
            # Line 0: sequence number
            # Line 1: timestamps (00:00:00,000 --> 00:00:03,500)
            # Line 2+: text
            
            timestamp_line = lines[1]
            text = ' '.join(lines[2:])
            
            # Parse timestamps
            match = re.match(r'(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})', timestamp_line)
            
            if not match:
                continue
            
            start_h, start_m, start_s, start_ms = map(int, match.groups()[:4])
            end_h, end_m, end_s, end_ms = map(int, match.groups()[4:])
            
            start = start_h * 3600 + start_m * 60 + start_s + start_ms / 1000
            end = end_h * 3600 + end_m * 60 + end_s + end_ms / 1000
            duration = end - start
            
            segments.append({
                'text': text,
                'start': round(start, 3),
                'duration': round(duration, 3)
            })
        
        logger.info(f"Parsed {len(segments)} segments from SRT")
        return segments
    
    @staticmethod
    def parse_vtt(vtt_content: str) -> List[Dict]:
        """
        Parse WebVTT subtitle format.
        
        Args:
            vtt_content: VTT file content
            
        Returns:
            List of segments: [{'text': str, 'start': float, 'duration': float}, ...]
        """
        segments = []
        
        # Remove WEBVTT header
        lines = vtt_content.split('\n')
        if lines and lines[0].startswith('WEBVTT'):
            lines = lines[1:]
        
        content = '\n'.join(lines)
        
        # Split by double newlines (subtitle blocks)
        blocks = re.split(r'\n\s*\n', content.strip())
        
        for block in blocks:
            lines = block.strip().split('\n')
            if len(lines) < 2:
                continue
            
            # Line 0: optional cue identifier
            # Line 0 or 1: timestamps (00:00:00.000 --> 00:00:03.500)
            # Remaining: text
            
            timestamp_line = None
            text_start_idx = 0
            
            for idx, line in enumerate(lines):
                if '-->' in line:
                    timestamp_line = line
                    text_start_idx = idx + 1
                    break
            
            if not timestamp_line:
                continue
            
            text = ' '.join(lines[text_start_idx:])
            
            # Parse timestamps (support both comma and period for milliseconds)
            match = re.match(r'(\d{2}):(\d{2}):(\d{2})[\.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[\.,](\d{3})', timestamp_line)
            
            if not match:
                continue
            
            start_h, start_m, start_s, start_ms = map(int, match.groups()[:4])
            end_h, end_m, end_s, end_ms = map(int, match.groups()[4:])
            
            start = start_h * 3600 + start_m * 60 + start_s + start_ms / 1000
            end = end_h * 3600 + end_m * 60 + end_s + end_ms / 1000
            duration = end - start
            
            segments.append({
                'text': text,
                'start': round(start, 3),
                'duration': round(duration, 3)
            })
        
        logger.info(f"Parsed {len(segments)} segments from VTT")
        return segments
    
    @classmethod
    def import_manual_transcript(
        cls,
        content: str,
        format: str,
        video_id: str
    ) -> Optional[Dict]:
        """
        Import user-provided transcript in various formats.
        
        Args:
            content: Transcript file content
            format: 'srt', 'vtt', or 'plain'
            video_id: YouTube video ID
            
        Returns:
            Transcript dict in youtube format, or None if parsing failed
        """
        if format == 'srt':
            segments = cls.parse_srt(content)
        elif format == 'vtt':
            segments = cls.parse_vtt(content)
        elif format == 'plain':
            # Plain text without timestamps - create dummy segments
            # Warning: This won't have accurate timestamps for clip discovery
            lines = [line.strip() for line in content.split('\n') if line.strip()]
            segments = []
            cumulative_time = 0.0
            
            for idx, line in enumerate(lines):
                # Estimate duration based on text length (rough approximation)
                duration = max(3.0, len(line.split()) * 0.4)
                
                segments.append({
                    'text': line,
                    'start': round(cumulative_time, 3),
                    'duration': round(duration, 3)
                })
                
                cumulative_time += duration
            
            logger.warning(f"Imported plain text transcript with estimated timestamps")
        else:
            logger.error(f"Unsupported transcript format: {format}")
            return None
        
        if not segments:
            logger.error("No segments found in imported transcript")
            return None
        
        return {
            'segments': segments,
            'language': 'unknown',
            'is_generated': False,
            'source': 'user_provided'
        }
