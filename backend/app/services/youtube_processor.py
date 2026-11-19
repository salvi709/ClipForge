"""YouTube URL processing and validation."""

import re
import logging
from typing import Optional, Tuple
from urllib.parse import urlparse, parse_qs

logger = logging.getLogger(__name__)


class YouTubeProcessor:
    """
    Process and validate YouTube URLs.
    
    Extracts video IDs safely without SSRF risks.
    """
    
    # YouTube video ID is exactly 11 characters: letters, numbers, dash, underscore
    VIDEO_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{11}$')
    
    @staticmethod
    def extract_video_id(url: str) -> Optional[str]:
        """
        Extract YouTube video ID from various URL formats.
        
        Supported formats:
        - https://www.youtube.com/watch?v=VIDEO_ID
        - https://youtu.be/VIDEO_ID
        - https://www.youtube.com/shorts/VIDEO_ID
        - https://www.youtube.com/live/VIDEO_ID
        - https://m.youtube.com/watch?v=VIDEO_ID
        - With additional parameters (&t=123s, etc.)
        
        Args:
            url: YouTube URL string
            
        Returns:
            Video ID if valid, None otherwise
        """
        if not url:
            return None
        
        # Must use HTTPS
        if not url.startswith('https://'):
            logger.warning(f"URL must use HTTPS: {url[:50]}")
            return None
        
        try:
            parsed = urlparse(url)
            
            # Check domain
            if not any(domain in parsed.netloc for domain in ['youtube.com', 'youtu.be']):
                logger.warning(f"Not a YouTube URL: {parsed.netloc}")
                return None
            
            video_id = None
            
            # Format 1: youtube.com/watch?v=VIDEO_ID
            if 'youtube.com' in parsed.netloc and parsed.path in ['/watch', '/watch/']:
                query_params = parse_qs(parsed.query)
                if 'v' in query_params:
                    video_id = query_params['v'][0]
            
            # Format 2: youtu.be/VIDEO_ID
            elif 'youtu.be' in parsed.netloc:
                # Path is /VIDEO_ID
                video_id = parsed.path.lstrip('/')
            
            # Format 3: youtube.com/shorts/VIDEO_ID
            elif 'youtube.com' in parsed.netloc and parsed.path.startswith('/shorts/'):
                video_id = parsed.path.split('/shorts/')[1].split('/')[0]
            
            # Format 4: youtube.com/live/VIDEO_ID
            elif 'youtube.com' in parsed.netloc and parsed.path.startswith('/live/'):
                video_id = parsed.path.split('/live/')[1].split('/')[0]
            
            # Format 5: youtube.com/embed/VIDEO_ID
            elif 'youtube.com' in parsed.netloc and parsed.path.startswith('/embed/'):
                video_id = parsed.path.split('/embed/')[1].split('/')[0]
            
            if not video_id:
                logger.warning(f"Could not extract video ID from URL: {url[:100]}")
                return None
            
            # Clean video ID (remove query parameters if any)
            video_id = video_id.split('?')[0].split('&')[0]
            
            # Validate video ID format (security check)
            if not YouTubeProcessor.VIDEO_ID_PATTERN.match(video_id):
                logger.warning(f"Invalid video ID format: {video_id}")
                return None
            
            logger.info(f"Extracted video ID: {video_id}")
            return video_id
            
        except Exception as e:
            logger.error(f"Error parsing YouTube URL: {e}")
            return None
    
    @staticmethod
    def validate_url(url: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Validate a YouTube URL and extract video ID.
        
        Args:
            url: YouTube URL to validate
            
        Returns:
            Tuple of (is_valid, video_id, error_message)
        """
        if not url or not isinstance(url, str):
            return False, None, "URL is required"
        
        url = url.strip()
        
        if len(url) > 500:
            return False, None, "URL is too long"
        
        if not url.startswith('https://'):
            return False, None, "URL must use HTTPS (e.g., https://youtube.com/...)"
        
        video_id = YouTubeProcessor.extract_video_id(url)
        
        if not video_id:
            return False, None, (
                "Could not extract video ID. Supported formats:\n"
                "• https://www.youtube.com/watch?v=VIDEO_ID\n"
                "• https://youtu.be/VIDEO_ID\n"
                "• https://www.youtube.com/shorts/VIDEO_ID"
            )
        
        return True, video_id, None
    
    @staticmethod
    def build_playback_url(video_id: str, start_seconds: Optional[float] = None) -> str:
        """
        Build a YouTube playback URL with optional timestamp.
        
        Args:
            video_id: YouTube video ID
            start_seconds: Start time in seconds (optional)
            
        Returns:
            YouTube URL with timestamp parameter
        """
        if not YouTubeProcessor.VIDEO_ID_PATTERN.match(video_id):
            raise ValueError(f"Invalid video ID: {video_id}")
        
        base_url = f"https://www.youtube.com/watch?v={video_id}"
        
        if start_seconds is not None and start_seconds > 0:
            # YouTube accepts integer seconds in 't' parameter
            timestamp = int(start_seconds)
            return f"{base_url}&t={timestamp}s"
        
        return base_url
    
    @staticmethod
    def build_embed_url(video_id: str, start_seconds: Optional[float] = None) -> str:
        """
        Build a YouTube embed URL with optional start time.
        
        Args:
            video_id: YouTube video ID
            start_seconds: Start time in seconds (optional)
            
        Returns:
            YouTube embed URL
        """
        if not YouTubeProcessor.VIDEO_ID_PATTERN.match(video_id):
            raise ValueError(f"Invalid video ID: {video_id}")
        
        base_url = f"https://www.youtube.com/embed/{video_id}"
        
        if start_seconds is not None and start_seconds > 0:
            timestamp = int(start_seconds)
            return f"{base_url}?start={timestamp}"
        
        return base_url
