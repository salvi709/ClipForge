"""
Content profiling for universal video understanding.
Analyzes transcripts and metadata to detect video category and characteristics.
"""
import logging
import re
from collections import Counter
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Category detection keywords
EDUCATIONAL_KEYWORDS = {
    'learn', 'tutorial', 'explain', 'understand', 'concept', 'example', 'demonstrate',
    'theory', 'practice', 'lesson', 'teach', 'study', 'definition', 'algorithm',
    'function', 'method', 'process', 'principle', 'technique', 'guide', 'course'
}

PODCAST_KEYWORDS = {
    'think', 'believe', 'opinion', 'agree', 'disagree', 'interesting', 'actually',
    'conversation', 'discussion', 'interview', 'talk', 'guest', 'host', 'episode',
    'honestly', 'personally', 'experience', 'story', 'perspective'
}

GAMING_KEYWORDS = {
    'game', 'play', 'player', 'level', 'win', 'lose', 'score', 'enemy', 'boss',
    'attack', 'defend', 'weapon', 'health', 'damage', 'kill', 'death', 'respawn',
    'awesome', 'insane', 'incredible', 'wow', 'oh my god', 'reaction'
}

COMEDY_KEYWORDS = {
    'funny', 'laugh', 'joke', 'hilarious', 'comedy', 'humor', 'sarcasm', 'ironic',
    'ridiculous', 'absurd', 'punchline', 'setup', 'unexpected'
}

DOCUMENTARY_KEYWORDS = {
    'documentary', 'history', 'nature', 'explore', 'discover', 'journey', 'world',
    'ancient', 'modern', 'civilization', 'species', 'evolution', 'environment',
    'witness', 'observe', 'narrate', 'scene', 'footage'
}

VLOG_KEYWORDS = {
    'today', 'life', 'daily', 'vlog', 'day', 'morning', 'routine', 'personal',
    'update', 'lifestyle', 'follow', 'join', 'subscribe', 'channel', 'video'
}

# Question patterns suggest educational or Q&A content
QUESTION_PATTERN = re.compile(r'\b(what|how|why|when|where|who|which|can|could|should|would|is|are|do|does)\b[^.!?]{0,60}\?', re.I)

# Conversational markers suggest podcast/interview
CONVERSATIONAL_PATTERN = re.compile(r'\b(I think|I believe|you know|kind of|sort of|like|um|uh|actually|honestly|so basically)\b', re.I)

# Exclamations suggest gaming or reactions
EXCITEMENT_PATTERN = re.compile(r'(!{2,}|\b(wow|oh|omg|whoa|holy|insane|incredible|amazing|awesome)\b)', re.I)

# Code/technical patterns
CODE_PATTERN = re.compile(r'\b(function|class|variable|object|array|string|integer|boolean|if|else|for|while|return|import|export|async|await)\b', re.I)


class ContentProfile:
    """Structured content profile for a video."""
    
    def __init__(self):
        self.duration: float = 0.0
        self.word_count: int = 0
        self.speech_density: float = 0.0  # words per second
        self.has_meaningful_speech: bool = False
        
        # Category scores (0-1)
        self.educational_score: float = 0.0
        self.podcast_score: float = 0.0
        self.gaming_score: float = 0.0
        self.comedy_score: float = 0.0
        self.documentary_score: float = 0.0
        self.vlog_score: float = 0.0
        
        # Detected category
        self.primary_category: str = 'unknown'
        self.secondary_category: Optional[str] = None
        self.confidence: float = 0.0
        
        # Content characteristics
        self.question_count: int = 0
        self.question_density: float = 0.0
        self.conversational_markers: int = 0
        self.excitement_markers: int = 0
        self.technical_terms: int = 0
        self.vocabulary_diversity: float = 0.0
        
        # Audio/scene characteristics (from metadata)
        self.has_audio: bool = False
        self.scene_count: int = 0
        
        # Uncertainty flags
        self.is_mixed_content: bool = False
        self.detection_notes: List[str] = []
    
    def to_dict(self) -> Dict:
        """Convert profile to dictionary for JSON storage."""
        return {
            'duration': self.duration,
            'word_count': self.word_count,
            'speech_density': round(self.speech_density, 3),
            'has_meaningful_speech': self.has_meaningful_speech,
            'category_scores': {
                'educational': round(self.educational_score, 3),
                'podcast': round(self.podcast_score, 3),
                'gaming': round(self.gaming_score, 3),
                'comedy': round(self.comedy_score, 3),
                'documentary': round(self.documentary_score, 3),
                'vlog': round(self.vlog_score, 3),
            },
            'primary_category': self.primary_category,
            'secondary_category': self.secondary_category,
            'confidence': round(self.confidence, 3),
            'characteristics': {
                'question_count': self.question_count,
                'question_density': round(self.question_density, 3),
                'conversational_markers': self.conversational_markers,
                'excitement_markers': self.excitement_markers,
                'technical_terms': self.technical_terms,
                'vocabulary_diversity': round(self.vocabulary_diversity, 3),
            },
            'is_mixed_content': self.is_mixed_content,
            'detection_notes': self.detection_notes,
        }


class ContentProfiler:
    """Analyzes video content to detect category and characteristics."""
    
    def __init__(self):
        pass
    
    def profile(self, transcript: Dict, metadata: Dict) -> ContentProfile:
        """
        Generate content profile from transcript and video metadata.
        
        Args:
            transcript: Parsed transcript JSON with segments and sentences
            metadata: Video metadata from ffprobe (duration, etc.)
        
        Returns:
            ContentProfile with detected category and characteristics
        """
        profile = ContentProfile()
        
        # Basic metadata
        profile.duration = metadata.get('duration', 0.0)
        profile.has_audio = metadata.get('has_audio', True)
        
        # Extract all text
        sentences = transcript.get('sentences', [])
        full_text = ' '.join(s.get('text', '') for s in sentences)
        words = full_text.split()
        profile.word_count = len(words)
        
        # Check for meaningful speech
        if profile.word_count < 18:
            profile.has_meaningful_speech = False
            profile.primary_category = 'minimal_speech'
            profile.confidence = 0.9
            profile.detection_notes.append('Insufficient speech for content analysis')
            return profile
        
        profile.has_meaningful_speech = True
        
        # Speech density
        if profile.duration > 0:
            profile.speech_density = profile.word_count / profile.duration
        
        # Vocabulary diversity (unique words / total words)
        if profile.word_count > 0:
            unique_words = len(set(word.lower() for word in words if len(word) > 2))
            profile.vocabulary_diversity = unique_words / profile.word_count
        
        # Content pattern analysis
        full_text_lower = full_text.lower()
        
        # Question patterns
        profile.question_count = len(QUESTION_PATTERN.findall(full_text))
        if profile.word_count > 0:
            profile.question_density = profile.question_count / (profile.word_count / 100)
        
        # Conversational markers
        profile.conversational_markers = len(CONVERSATIONAL_PATTERN.findall(full_text))
        
        # Excitement markers
        profile.excitement_markers = len(EXCITEMENT_PATTERN.findall(full_text))
        
        # Technical terms
        profile.technical_terms = len(CODE_PATTERN.findall(full_text))
        
        # Category scoring
        profile.educational_score = self._score_keywords(full_text_lower, EDUCATIONAL_KEYWORDS)
        profile.podcast_score = self._score_keywords(full_text_lower, PODCAST_KEYWORDS)
        profile.gaming_score = self._score_keywords(full_text_lower, GAMING_KEYWORDS)
        profile.comedy_score = self._score_keywords(full_text_lower, COMEDY_KEYWORDS)
        profile.documentary_score = self._score_keywords(full_text_lower, DOCUMENTARY_KEYWORDS)
        profile.vlog_score = self._score_keywords(full_text_lower, VLOG_KEYWORDS)
        
        # Adjust scores based on characteristics
        if profile.question_density > 2.0:  # Many questions
            profile.educational_score += 0.15
        
        if profile.conversational_markers > profile.word_count / 50:  # Conversational
            profile.podcast_score += 0.15
        
        if profile.excitement_markers > profile.word_count / 100:  # High excitement
            profile.gaming_score += 0.1
            profile.comedy_score += 0.05
        
        if profile.technical_terms > profile.word_count / 50:  # Technical content
            profile.educational_score += 0.2
        
        if profile.speech_density < 1.5:  # Slow speech (visual/cinematic)
            profile.documentary_score += 0.1
        
        if profile.vocabulary_diversity < 0.3:  # Repetitive (gaming/reactions)
            profile.gaming_score += 0.05
        
        # Determine primary and secondary categories
        self._determine_categories(profile)
        
        logger.info('Content profile: %s (%.2f confidence) - %d words, %.1f words/sec',
                   profile.primary_category, profile.confidence, profile.word_count, profile.speech_density)
        
        return profile
    
    def _score_keywords(self, text: str, keywords: set) -> float:
        """Score text by keyword presence (0-1 normalized)."""
        matches = sum(1 for keyword in keywords if keyword in text)
        # Normalize by keyword set size, with diminishing returns
        if len(keywords) == 0:
            return 0.0
        raw_score = matches / len(keywords)
        # Apply logarithmic scaling to prevent domination
        return min(1.0, raw_score * 2.5)
    
    def _determine_categories(self, profile: ContentProfile):
        """Determine primary and secondary categories from scores."""
        scores = {
            'educational': profile.educational_score,
            'podcast': profile.podcast_score,
            'gaming': profile.gaming_score,
            'comedy': profile.comedy_score,
            'documentary': profile.documentary_score,
            'vlog': profile.vlog_score,
        }
        
        # Sort by score
        sorted_categories = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        
        top_category, top_score = sorted_categories[0]
        second_category, second_score = sorted_categories[1] if len(sorted_categories) > 1 else (None, 0.0)
        
        # Require minimum confidence threshold
        if top_score < 0.15:
            profile.primary_category = 'generic'
            profile.confidence = 0.3
            profile.detection_notes.append('No strong category signals detected')
            return
        
        profile.primary_category = top_category
        profile.confidence = min(1.0, top_score)
        
        # Check for mixed content
        if second_score > 0.2 and second_score > top_score * 0.6:
            profile.secondary_category = second_category
            profile.is_mixed_content = True
            profile.confidence *= 0.85  # Reduce confidence for mixed content
            profile.detection_notes.append(f'Mixed content detected: {top_category}/{second_category}')
        
        # Confidence adjustments
        if profile.word_count < 100:
            profile.confidence *= 0.7
            profile.detection_notes.append('Limited speech sample affects detection confidence')
        
        if profile.duration < 60:
            profile.confidence *= 0.9
            profile.detection_notes.append('Short video may not represent full content type')
