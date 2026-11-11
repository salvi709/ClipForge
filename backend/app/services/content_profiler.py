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
        self.music_score: float = 0.0
        self.sports_score: float = 0.0
        self.cinematic_score: float = 0.0
        
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
        self.volume_peak_count: int = 0
        self.average_motion: float = 0.0
        
        # Uncertainty flags
        self.is_mixed_content: bool = False
        self.detection_notes: List[str] = []
        self.detection_explanation: str = ''
        self.supporting_evidence: List[str] = []
    
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
                'music': round(self.music_score, 3),
                'sports': round(self.sports_score, 3),
                'cinematic': round(self.cinematic_score, 3),
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
                'volume_peak_count': self.volume_peak_count,
                'average_motion': round(self.average_motion, 3),
            },
            'is_mixed_content': self.is_mixed_content,
            'detection_notes': self.detection_notes,
            'detection_explanation': self.detection_explanation,
            'supporting_evidence': self.supporting_evidence,
        }


class ContentProfiler:
    """Analyzes video content to detect category and characteristics."""
    
    def __init__(self):
        pass
    
    def profile(self, transcript: Dict, metadata: Dict, 
                audio_analysis: Dict = None, scene_analysis: Dict = None) -> ContentProfile:
        """
        Generate content profile from transcript, video metadata, and multimodal analysis.
        
        Args:
            transcript: Parsed transcript JSON with segments and sentences
            metadata: Video metadata from ffprobe (duration, etc.)
            audio_analysis: Audio energy/speech analysis results (optional)
            scene_analysis: Visual scene/motion analysis results (optional)
        
        Returns:
            ContentProfile with detected category and characteristics
        """
        profile = ContentProfile()
        audio_analysis = audio_analysis or {}
        scene_analysis = scene_analysis or {}
        
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
        # Base keyword scoring from transcript
        profile.educational_score = self._score_keywords(full_text_lower, EDUCATIONAL_KEYWORDS)
        profile.podcast_score = self._score_keywords(full_text_lower, PODCAST_KEYWORDS)
        profile.gaming_score = self._score_keywords(full_text_lower, GAMING_KEYWORDS)
        profile.comedy_score = self._score_keywords(full_text_lower, COMEDY_KEYWORDS)
        profile.documentary_score = self._score_keywords(full_text_lower, DOCUMENTARY_KEYWORDS)
        profile.vlog_score = self._score_keywords(full_text_lower, VLOG_KEYWORDS)
        
        # Enhance scores with audio and visual signals
        self._apply_audio_signals(profile, audio_analysis)
        self._apply_visual_signals(profile, scene_analysis)
        
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
    
    
    def _apply_audio_signals(self, profile: ContentProfile, audio_analysis: Dict):
        """Enhance category scores using audio analysis signals."""
        if not audio_analysis:
            return
        
        # Extract audio features
        volume_peaks = audio_analysis.get('volume_peaks', [])
        silence_periods = audio_analysis.get('silence_periods', [])
        speech_regions = audio_analysis.get('speech_regions', [])
        energy_timeline = audio_analysis.get('energy_timeline', [])
        
        profile.volume_peak_count = len(volume_peaks)
        
        # High volume peak density suggests Gaming/Comedy/Sports
        if profile.duration > 0:
            peak_density = len(volume_peaks) / (profile.duration / 60)  # peaks per minute
            
            if peak_density > 3:  # 3+ peaks per minute
                profile.gaming_score += 0.15
                profile.comedy_score += 0.10
                profile.sports_score = max(profile.sports_score, 0.25)
                profile.supporting_evidence.append(f'{len(volume_peaks)} volume peaks suggest high-energy content')
            
            # Many silence periods suggest Cinematic/Documentary
            silence_density = len(silence_periods) / (profile.duration / 60)
            if silence_density > 2 and profile.speech_density < 2.0:
                profile.cinematic_score += 0.15
                profile.documentary_score += 0.10
                profile.supporting_evidence.append('Frequent silence periods suggest cinematic pacing')
        
        # Speech continuity analysis
        if speech_regions and profile.duration > 0:
            total_speech_duration = sum(r.get('duration', 0) for r in speech_regions)
            speech_coverage = total_speech_duration / profile.duration
            
            if speech_coverage > 0.85:  # 85%+ speech coverage
                profile.podcast_score += 0.15
                profile.educational_score += 0.10
                profile.supporting_evidence.append(f'{int(speech_coverage*100)}% speech coverage suggests conversational content')
            
            elif speech_coverage < 0.30:  # Less than 30% speech
                profile.music_score = max(profile.music_score, 0.35)
                profile.cinematic_score += 0.15
                if profile.word_count < 50:
                    profile.supporting_evidence.append('Minimal speech suggests music or visual-focused content')
        
        # Audio energy variability suggests action/gaming
        if energy_timeline and len(energy_timeline) > 10:
            energies = [e.get('energy', 0) for e in energy_timeline]
            if energies:
                import statistics
                try:
                    energy_std = statistics.stdev(energies)
                    energy_mean = statistics.mean(energies)
                    if energy_mean > 0:
                        variability = energy_std / energy_mean
                        if variability > 0.5:  # High variability
                            profile.gaming_score += 0.10
                            profile.sports_score += 0.10
                except statistics.StatisticsError:
                    pass
    
    def _apply_visual_signals(self, profile: ContentProfile, scene_analysis: Dict):
        """Enhance category scores using visual analysis signals."""
        if not scene_analysis:
            return
        
        # Extract visual features
        scene_changes = scene_analysis.get('scene_changes', [])
        motion_analysis = scene_analysis.get('motion_analysis', {})
        frames = scene_analysis.get('representative_frames', [])
        
        profile.scene_count = len(scene_changes)
        
        # Calculate average motion from frame analysis
        if frames:
            motion_values = [f.get('motion_magnitude', 0) for f in frames]
            if motion_values:
                profile.average_motion = sum(motion_values) / len(motion_values)
        
        # High scene change rate suggests Vlog/Travel/Gaming
        if profile.duration > 0:
            scene_rate = len(scene_changes) / (profile.duration / 60)  # scenes per minute
            
            if scene_rate > 10:  # 10+ scene changes per minute
                profile.vlog_score += 0.15
                profile.gaming_score += 0.10
                profile.supporting_evidence.append(f'{len(scene_changes)} scene changes suggest dynamic visual content')
            
            elif scene_rate < 2 and profile.duration > 60:  # Very few scene changes
                profile.cinematic_score += 0.15
                profile.documentary_score += 0.10
                profile.supporting_evidence.append('Minimal scene changes suggest cinematic composition')
        
        # High motion magnitude suggests Gaming/Sports/Action
        if profile.average_motion > 0.3:  # Threshold for "high motion"
            profile.gaming_score += 0.15
            profile.sports_score += 0.20
            profile.supporting_evidence.append(f'High motion (avg {profile.average_motion:.2f}) suggests action content')
        
        elif profile.average_motion < 0.1:  # Very low motion
            profile.documentary_score += 0.10
            profile.cinematic_score += 0.10
        
        # Combined visual + audio signals for specific categories
        if profile.average_motion > 0.25 and profile.volume_peak_count > 5:
            # High motion + volume peaks = Gaming or Sports
            profile.gaming_score += 0.10
            profile.sports_score += 0.10
            profile.supporting_evidence.append('High motion + volume peaks suggest intense action')
        
        if profile.scene_count > 20 and profile.speech_density > 3.0:
            # Many scenes + fast speech = Vlog
            profile.vlog_score += 0.15
            profile.supporting_evidence.append('Rapid scene changes + fast speech suggest vlog style')
    
    def _determine_categories(self, profile: ContentProfile):
        """Determine primary and secondary categories from scores with explanation."""
        scores = {
            'educational': profile.educational_score,
            'podcast': profile.podcast_score,
            'gaming': profile.gaming_score,
            'comedy': profile.comedy_score,
            'documentary': profile.documentary_score,
            'vlog': profile.vlog_score,
            'music': profile.music_score,
            'sports': profile.sports_score,
            'cinematic': profile.cinematic_score,
        }
        
        # Sort by score
        sorted_categories = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        
        top_category, top_score = sorted_categories[0]
        second_category, second_score = sorted_categories[1] if len(sorted_categories) > 1 else (None, 0.0)
        third_category, third_score = sorted_categories[2] if len(sorted_categories) > 2 else (None, 0.0)
        
        # Require minimum confidence threshold
        if top_score < 0.15:
            profile.primary_category = 'generic'
            profile.confidence = 0.3
            profile.detection_notes.append('No strong category signals detected')
            profile.detection_explanation = 'Content does not match any specific category patterns strongly enough for automatic detection.'
            return
        
        profile.primary_category = top_category
        profile.confidence = min(1.0, top_score)
        
        # Build detection explanation
        explanation_parts = [f'Detected as {top_category.title()}']
        
        # Add top evidence
        if profile.supporting_evidence:
            explanation_parts.append(f' based on: {"; ".join(profile.supporting_evidence[:3])}')
        
        profile.detection_explanation = ''.join(explanation_parts) + '.'
        
        # Check for mixed content
        if second_score > 0.2 and second_score > top_score * 0.6:
            profile.secondary_category = second_category
            profile.is_mixed_content = True
            profile.confidence *= 0.85  # Reduce confidence for mixed content
            profile.detection_notes.append(f'Mixed content detected: {top_category}/{second_category}')
            profile.detection_explanation += f' Secondary signals suggest {second_category} elements.'
        
        # Confidence adjustments
        if profile.word_count < 100:
            profile.confidence *= 0.7
            profile.detection_notes.append('Limited speech sample affects detection confidence')
        
        if profile.duration < 60:
            profile.confidence *= 0.9
            profile.detection_notes.append('Short video may not represent full content type')
        
        # Boost confidence if multiple strong signals align
        if top_score > 0.4 and len(profile.supporting_evidence) >= 3:
            profile.confidence = min(1.0, profile.confidence * 1.1)
            profile.detection_notes.append('Multiple converging signals increase confidence')
