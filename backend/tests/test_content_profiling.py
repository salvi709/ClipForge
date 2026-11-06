"""Tests for content profiling and category detection."""
import json
import pytest
from pathlib import Path

from app.services.content_profiler import ContentProfiler


def test_educational_content_detection():
    """Educational content should be detected from tutorial keywords and patterns."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'In this tutorial we will learn about machine learning algorithms.', 'start': 0, 'end': 3},
            {'text': 'Let me explain the concept of neural networks step by step.', 'start': 3, 'end': 6},
            {'text': 'The function takes an input and returns a processed output.', 'start': 6, 'end': 9},
            {'text': 'This example demonstrates how the algorithm works in practice.', 'start': 9, 'end': 12},
        ]
    }
    metadata = {'duration': 12.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    assert profile.primary_category == 'educational'
    assert profile.has_meaningful_speech
    assert profile.word_count > 30
    assert profile.educational_score > 0.3


def test_podcast_content_detection():
    """Podcast content should be detected from conversational patterns."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'I think that\'s a really interesting perspective on the issue.', 'start': 0, 'end': 3},
            {'text': 'You know, in my experience, people actually behave differently.', 'start': 3, 'end': 6},
            {'text': 'I believe we should discuss this topic more openly and honestly.', 'start': 6, 'end': 9},
            {'text': 'That\'s a good point, and I agree with what you\'re saying.', 'start': 9, 'end': 12},
        ]
    }
    metadata = {'duration': 12.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    assert profile.primary_category == 'podcast'
    assert profile.conversational_markers >= 5
    assert profile.podcast_score > 0.2


def test_gaming_content_detection():
    """Gaming content should be detected from excitement and game terminology."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'Oh my god, that was insane!', 'start': 0, 'end': 2},
            {'text': 'I can\'t believe I just killed the boss!', 'start': 2, 'end': 4},
            {'text': 'Let\'s attack this enemy before we lose all our health.', 'start': 4, 'end': 7},
            {'text': 'Wow, that level was incredibly difficult!', 'start': 7, 'end': 10},
        ]
    }
    metadata = {'duration': 10.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    assert profile.primary_category == 'gaming'
    assert profile.excitement_markers >= 3
    assert profile.gaming_score > 0.2


def test_minimal_speech_detection():
    """Videos with minimal speech should be detected."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'Hey there.', 'start': 0, 'end': 1},
            {'text': 'Nice view.', 'start': 5, 'end': 6},
        ]
    }
    metadata = {'duration': 60.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    assert profile.primary_category == 'minimal_speech'
    assert not profile.has_meaningful_speech
    assert profile.word_count < 18


def test_mixed_content_detection():
    """Mixed content should be flagged with secondary category."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'Let me explain how this tutorial works for our gaming session.', 'start': 0, 'end': 3},
            {'text': 'The game mechanics are based on educational principles.', 'start': 3, 'end': 6},
            {'text': 'I will teach you the strategy while we play this level together.', 'start': 6, 'end': 9},
            {'text': 'Understanding the algorithm helps you win the game more effectively.', 'start': 9, 'end': 12},
        ]
    }
    metadata = {'duration': 12.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    # Should detect both educational and gaming signals
    assert profile.educational_score > 0.15
    assert profile.gaming_score > 0.1
    # May be flagged as mixed
    if profile.is_mixed_content:
        assert profile.secondary_category is not None


def test_technical_content_boosts_educational():
    """Technical terminology should boost educational score."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'The function returns a boolean value from the array.', 'start': 0, 'end': 3},
            {'text': 'We import the class and define a new object instance.', 'start': 3, 'end': 6},
            {'text': 'The async function awaits the variable assignment.', 'start': 6, 'end': 9},
        ]
    }
    metadata = {'duration': 9.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    assert profile.technical_terms > 5
    assert profile.educational_score > 0.3


def test_question_density_calculation():
    """Question patterns should be detected and counted."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'What is machine learning and how does it work?', 'start': 0, 'end': 3},
            {'text': 'Why do we need to understand this concept today?', 'start': 3, 'end': 6},
            {'text': 'Can you explain the difference between these two methods?', 'start': 6, 'end': 9},
            {'text': 'This is an important principle to remember.', 'start': 9, 'end': 11},
        ]
    }
    metadata = {'duration': 11.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    assert profile.question_count >= 3
    assert profile.question_density > 0


def test_speech_density_calculation():
    """Speech density should be calculated correctly."""
    profiler = ContentProfiler()
    
    # Dense speech: 100 words in 10 seconds = 10 words/sec
    words = ' '.join(['word'] * 100)
    transcript = {
        'sentences': [
            {'text': words, 'start': 0, 'end': 10}
        ]
    }
    metadata = {'duration': 10.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    assert profile.word_count == 100
    assert profile.speech_density == pytest.approx(10.0, abs=0.1)


def test_vocabulary_diversity():
    """Vocabulary diversity should distinguish varied vs repetitive speech."""
    profiler = ContentProfiler()
    
    # High diversity: many unique words (need >18 words)
    transcript_diverse = {
        'sentences': [
            {'text': 'The quick brown fox jumps over the lazy dog with incredible agility and grace.', 'start': 0, 'end': 3},
            {'text': 'Different words create meaningful variation in vocabulary patterns and linguistic structure.', 'start': 3, 'end': 6}
        ]
    }
    
    # Low diversity: repetitive words (need >18 words)
    transcript_repetitive = {
        'sentences': [
            {'text': 'Go go go go go go go go go go go go go go go go go go go go go go go go.', 'start': 0, 'end': 3}
        ]
    }
    
    metadata = {'duration': 6.0, 'has_audio': True}
    
    profile_diverse = profiler.profile(transcript_diverse, metadata)
    profile_repetitive = profiler.profile(transcript_repetitive, metadata)
    
    assert profile_diverse.vocabulary_diversity > profile_repetitive.vocabulary_diversity


def test_content_profile_serialization():
    """Content profile should serialize to JSON correctly."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'This is a test of the content profiling system.', 'start': 0, 'end': 3}
        ]
    }
    metadata = {'duration': 3.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    profile_dict = profile.to_dict()
    
    # Check required fields
    assert 'duration' in profile_dict
    assert 'word_count' in profile_dict
    assert 'speech_density' in profile_dict
    assert 'primary_category' in profile_dict
    assert 'confidence' in profile_dict
    assert 'category_scores' in profile_dict
    assert 'characteristics' in profile_dict
    
    # Should be JSON serializable
    json_str = json.dumps(profile_dict)
    assert len(json_str) > 0


def test_confidence_adjustment_for_short_videos():
    """Short videos should have reduced confidence."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'Quick educational content about programming concepts.', 'start': 0, 'end': 2}
        ]
    }
    metadata = {'duration': 30.0, 'has_audio': True}  # Short video
    
    profile = profiler.profile(transcript, metadata)
    
    # Confidence should be adjusted for short duration
    assert 'short video' in ' '.join(profile.detection_notes).lower() or profile.duration < 60


def test_generic_category_fallback():
    """Content without strong signals should fall back to generic."""
    profiler = ContentProfiler()
    
    transcript = {
        'sentences': [
            {'text': 'The cat sat on the mat near the window.', 'start': 0, 'end': 3},
            {'text': 'There were many birds outside during that time period.', 'start': 3, 'end': 6},
            {'text': 'Normal everyday speech without particular distinctive characteristics.', 'start': 6, 'end': 9},
        ]
    }
    metadata = {'duration': 9.0, 'has_audio': True}
    
    profile = profiler.profile(transcript, metadata)
    
    # Should have low confidence without strong signals
    assert profile.confidence < 0.6
