"""YouTube metadata retrieval using YouTube Data API v3."""

import os
import logging
from typing import Optional, Dict
from datetime import datetime

logger = logging.getLogger(__name__)


class YouTubeMetadataService:
    """
    Retrieve YouTube video metadata using YouTube Data API v3.
    
    Requires optional YOUTUBE_API_KEY environment variable.
    Gracefully degrades when API key is unavailable.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize YouTube metadata service.
        
        Args:
            api_key: YouTube Data API v3 key (optional, reads from env if not provided)
        """
        self.api_key = api_key or os.getenv('YOUTUBE_API_KEY')
        self._client = None
        
    def is_available(self) -> bool:
        """Check if YouTube Data API is available."""
        return self.api_key is not None and len(self.api_key) > 0
    
    def _get_client(self):
        """Lazy-load YouTube API client."""
        if self._client is not None:
            return self._client
        
        if not self.is_available():
            return None
        
        try:
            from googleapiclient.discovery import build
            from googleapiclient.errors import HttpError
            
            self._client = build('youtube', 'v3', developerKey=self.api_key)
            logger.info("YouTube Data API client initialized")
            return self._client
            
        except ImportError:
            logger.warning(
                "google-api-python-client not installed. "
                "Install: pip install google-api-python-client"
            )
            return None
        except Exception as e:
            logger.error(f"Failed to initialize YouTube API client: {e}")
            return None
    
    def get_video_metadata(self, video_id: str) -> Optional[Dict]:
        """
        Fetch video metadata from YouTube Data API.
        
        Args:
            video_id: YouTube video ID (11 characters)
            
        Returns:
            Dictionary with video metadata, or None if unavailable
            {
                'video_id': str,
                'title': str,
                'channel_name': str,
                'duration': int (seconds),
                'thumbnail_url': str,
                'published_at': str (ISO format),
                'view_count': int,
                'description': str
            }
        """
        client = self._get_client()
        
        if not client:
            logger.info("YouTube API unavailable, skipping metadata fetch")
            return None
        
        try:
            from googleapiclient.errors import HttpError
            
            # Request video details
            request = client.videos().list(
                part='snippet,contentDetails,statistics',
                id=video_id
            )
            
            response = request.execute()
            
            if not response.get('items'):
                logger.warning(f"No video found for ID: {video_id}")
                return None
            
            video = response['items'][0]
            snippet = video.get('snippet', {})
            content_details = video.get('contentDetails', {})
            statistics = video.get('statistics', {})
            
            # Parse ISO 8601 duration (e.g., "PT4M13S" → 253 seconds)
            duration_iso = content_details.get('duration', 'PT0S')
            duration_seconds = self._parse_duration(duration_iso)
            
            # Get best thumbnail
            thumbnails = snippet.get('thumbnails', {})
            thumbnail_url = (
                thumbnails.get('maxres', {}).get('url') or
                thumbnails.get('high', {}).get('url') or
                thumbnails.get('medium', {}).get('url') or
                thumbnails.get('default', {}).get('url')
            )
            
            metadata = {
                'video_id': video_id,
                'title': snippet.get('title'),
                'channel_name': snippet.get('channelTitle'),
                'duration': duration_seconds,
                'thumbnail_url': thumbnail_url,
                'published_at': snippet.get('publishedAt'),
                'view_count': int(statistics.get('viewCount', 0)),
                'description': snippet.get('description', '')[:500]  # Truncate long descriptions
            }
            
            logger.info(f"Fetched metadata for video: {metadata['title']}")
            return metadata
            
        except HttpError as e:
            if e.resp.status == 403:
                logger.error("YouTube API quota exceeded or invalid API key")
            elif e.resp.status == 404:
                logger.warning(f"Video not found: {video_id}")
            else:
                logger.error(f"YouTube API error: {e}")
            return None
            
        except Exception as e:
            logger.error(f"Error fetching YouTube metadata: {e}", exc_info=True)
            return None
    
    @staticmethod
    def _parse_duration(duration_iso: str) -> int:
        """
        Parse ISO 8601 duration to seconds.
        
        Examples:
        - PT4M13S → 253 seconds
        - PT1H2M10S → 3730 seconds
        - PT15S → 15 seconds
        
        Args:
            duration_iso: ISO 8601 duration string
            
        Returns:
            Duration in seconds
        """
        import re
        
        # Pattern: PT(hours)H(minutes)M(seconds)S
        pattern = r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?'
        match = re.match(pattern, duration_iso)
        
        if not match:
            return 0
        
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        seconds = int(match.group(3) or 0)
        
        return hours * 3600 + minutes * 60 + seconds
