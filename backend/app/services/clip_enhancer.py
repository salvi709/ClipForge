"""
Smart Clip Enhancement Assistant - AI-powered recommendations for short-form content.
Generates titles, captions, format suggestions, editing ideas, and export presets.
"""
import json
import logging
from typing import Dict, List, Optional
import hashlib

logger = logging.getLogger(__name__)


class ClipEnhancer:
    """Generates AI-powered enhancement recommendations for discovered clips."""
    
    def __init__(self, ollama):
        """Initialize with Ollama client for local AI generation."""
        self.ollama = ollama
    
    def generate_titles(self, clip: Dict, category: str, transcript_excerpt: str, cancel=None) -> List[Dict]:
        """
        Generate 3-5 title/hook options for a clip.
        
        Args:
            clip: Clip data with excerpt, reason, duration
            category: Detected content category
            transcript_excerpt: Full transcript excerpt
            cancel: Cancellation callback
        
        Returns:
            List of title options with reasoning
        """
        # Build category-specific prompt
        hook_strategies = {
            'gaming': 'excitement, reactions, unexpected moments, achievements',
            'educational': 'problem-solution, learning value, mistake prevention, key insights',
            'podcast': 'perspectives, insights, questions, revelations',
            'vlog': 'personal connection, curiosity, daily life, experiences',
            'comedy': 'humor anticipation, setup hints, relatable situations',
            'documentary': 'discoveries, facts, stories, explanations',
            'sports': 'action, plays, records, moments',
            'music': 'performance, emotion, artistry',
            'travel': 'destinations, experiences, discoveries',
            'cinematic': 'visual storytelling, mood, atmosphere'
        }
        
        strategy = hook_strategies.get(category, 'interest, value, clarity')
        
        prompt = f"""You are a short-form video title generator for {category} content.

Generate 3-5 title options for this clip that will work on Instagram Reels, YouTube Shorts, and TikTok.

Clip Information:
- Duration: {clip.get('duration', 0):.1f} seconds
- Category: {category}
- Transcript: "{transcript_excerpt[:300]}"
- Main Point: {clip.get('reason', 'interesting moment')}

Requirements:
1. Titles must be grounded in the actual clip content - do NOT invent events or dialogue
2. No misleading clickbait that overpromises
3. Match {category} style and audience expectations
4. Emphasize: {strategy}
5. Keep titles 40-60 characters ideal, max 80 characters
6. Each title should use a different hook approach

Output Format (JSON):
{{
  "titles": [
    {{
      "text": "Your Title Here",
      "hook_type": "curiosity|question|statement|story|reveal",
      "reasoning": "Brief explanation of why this works"
    }}
  ]
}}

Generate diverse options that match the actual content."""

        try:
            # Use Ollama with JSON schema for structured output
            schema = {
                "type": "object",
                "properties": {
                    "titles": {
                        "type": "array",
                        "minItems": 3,
                        "maxItems": 5,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "minLength": 10, "maxLength": 80},
                                "hook_type": {"type": "string", "enum": ["curiosity", "question", "statement", "story", "reveal", "educational", "entertainment"]},
                                "reasoning": {"type": "string", "minLength": 10, "maxLength": 150}
                            },
                            "required": ["text", "hook_type", "reasoning"]
                        }
                    }
                },
                "required": ["titles"]
            }
            
            payload = {
                'model': self.ollama.settings.ollama_model,
                'stream': False,
                'format': schema,
                'keep_alive': '5m',
                'options': {'temperature': 0.7, 'num_ctx': 4096, 'num_predict': 800},
                'messages': [
                    {'role': 'system', 'content': 'You are a creative title generator for short-form video content. Generate engaging, accurate titles based on actual clip content.'},
                    {'role': 'user', 'content': prompt}
                ]
            }
            
            with self.ollama._client(60) as client:
                response = client.post('/api/chat', json=payload)
                response.raise_for_status()
                result = response.json()
                
                if 'message' in result and 'content' in result['message']:
                    content = result['message']['content']
                    parsed = json.loads(content)
                    titles = parsed.get('titles', [])
                    
                    # Validate and return
                    if titles and isinstance(titles, list):
                        logger.info('Generated %d title options for %s clip', len(titles), category)
                        return titles
                    
            logger.warning('Title generation returned invalid format')
            return self._fallback_titles(clip, category)
            
        except Exception as error:
            logger.warning('Title generation failed: %s', error, exc_info=True)
            return self._fallback_titles(clip, category)
    
    def _fallback_titles(self, clip: Dict, category: str) -> List[Dict]:
        """Generate basic fallback titles when AI generation fails."""
        excerpt = clip.get('excerpt', '')
        first_words = ' '.join(excerpt.split()[:8])
        
        return [
            {
                'text': f"{first_words}...",
                'hook_type': 'statement',
                'reasoning': 'Direct quote from the clip opening'
            },
            {
                'text': f"Watch This {category.title()} Moment",
                'hook_type': 'curiosity',
                'reasoning': 'Simple category-based hook'
            },
            {
                'text': clip.get('title', 'Interesting Clip'),
                'hook_type': 'statement',
                'reasoning': 'Original discovery title'
            }
        ]
    
    def recommend_caption_style(self, clip: Dict, category: str, has_uncertain: bool) -> Dict:
        """
        Recommend caption style based on category and content.
        
        Args:
            clip: Clip data
            category: Content category
            has_uncertain: Whether clip contains uncertain transcription spans
        
        Returns:
            Caption style recommendation with parameters
        """
        # Category-specific caption styles
        style_recommendations = {
            'gaming': {
                'style': 'dynamic',
                'max_chars_per_line': 35,
                'line_count': 2,
                'highlight_keywords': True,
                'animation': 'pop-in',
                'position': 'top',
                'font_weight': 'bold',
                'color_scheme': 'high-contrast'
            },
            'educational': {
                'style': 'clear',
                'max_chars_per_line': 40,
                'line_count': 2,
                'highlight_keywords': True,
                'animation': 'fade',
                'position': 'bottom',
                'font_weight': 'medium',
                'color_scheme': 'clean'
            },
            'podcast': {
                'style': 'minimal',
                'max_chars_per_line': 50,
                'line_count': 1,
                'highlight_keywords': False,
                'animation': 'none',
                'position': 'bottom',
                'font_weight': 'regular',
                'color_scheme': 'subtle'
            },
            'comedy': {
                'style': 'emphasized',
                'max_chars_per_line': 30,
                'line_count': 2,
                'highlight_keywords': True,
                'animation': 'bounce',
                'position': 'center',
                'font_weight': 'bold',
                'color_scheme': 'playful'
            },
            'vlog': {
                'style': 'personal',
                'max_chars_per_line': 40,
                'line_count': 2,
                'highlight_keywords': False,
                'animation': 'slide',
                'position': 'bottom',
                'font_weight': 'medium',
                'color_scheme': 'warm'
            }
        }
        
        # Default style for other categories
        default_style = {
            'style': 'standard',
            'max_chars_per_line': 40,
            'line_count': 2,
            'highlight_keywords': False,
            'animation': 'fade',
            'position': 'bottom',
            'font_weight': 'medium',
            'color_scheme': 'neutral'
        }
        
        recommendation = style_recommendations.get(category, default_style).copy()
        
        # Add uncertainty handling
        if has_uncertain:
            recommendation['uncertain_marker'] = '[uncertain]'
            recommendation['show_uncertainty_warning'] = True
        
        recommendation['reasoning'] = self._get_style_reasoning(category, recommendation['style'])
        
        return recommendation
    
    def _get_style_reasoning(self, category: str, style: str) -> str:
        """Generate reasoning for caption style recommendation."""
        reasons = {
            'gaming': f'Dynamic {style} captions match the high-energy {category} content',
            'educational': f'{style.title()} captions emphasize learning and clarity',
            'podcast': f'{style.title()} captions keep focus on the conversation',
            'comedy': f'{style.title()} captions enhance comedic timing',
            'vlog': f'{style.title()} captions create personal connection'
        }
        return reasons.get(category, f'{style.title()} captions suit general {category} content')
    
    def recommend_format(self, clip: Dict, video_metadata: Dict, category: str) -> Dict:
        """
        Recommend video format (aspect ratio, crop) for social media.
        
        Args:
            clip: Clip data
            video_metadata: Original video dimensions and properties
            category: Content category
        
        Returns:
            Format recommendation with crop suggestions
        """
        width = video_metadata.get('width', 1920)
        height = video_metadata.get('height', 1080)
        original_aspect = width / height if height > 0 else 16/9
        
        # Determine best format for category and content
        if category in ['gaming', 'vlog', 'comedy']:
            # Vertical preferred for casual, phone-first content
            recommended_format = '9:16'
            reasoning = f'{category.title()} content performs best in vertical format on mobile platforms'
        elif category in ['cinematic', 'travel', 'documentary']:
            # Preserve original for cinematic content
            if original_aspect > 1.5:
                recommended_format = '16:9'
                reasoning = 'Cinematic composition benefits from wide format'
            else:
                recommended_format = '9:16'
                reasoning = 'Vertical format suits mobile viewing'
        elif category == 'educational':
            # Square or vertical for screen recordings
            if width > 1.5 * height:
                recommended_format = '1:1'
                reasoning = 'Square format preserves screen content visibility'
            else:
                recommended_format = '9:16'
                reasoning = 'Vertical format maximizes mobile screen usage'
        else:
            # Default: vertical for short-form
            recommended_format = '9:16'
            reasoning = 'Vertical format is standard for short-form social media'
        
        # Determine crop strategy
        crop_suggestion = self._suggest_crop(original_aspect, recommended_format, category)
        
        return {
            'recommended_format': recommended_format,
            'original_aspect_ratio': f'{width}:{height}',
            'crop_suggestion': crop_suggestion,
            'reasoning': reasoning,
            'platforms': self._get_platform_compatibility(recommended_format)
        }
    
    def _suggest_crop(self, original_aspect: float, target_format: str, category: str) -> Dict:
        """Generate crop positioning suggestion."""
        target_aspects = {
            '9:16': 9/16,
            '16:9': 16/9,
            '1:1': 1.0
        }
        
        target_aspect = target_aspects[target_format]
        needs_crop = abs(original_aspect - target_aspect) > 0.1
        
        if not needs_crop:
            return {
                'type': 'none',
                'confidence': 1.0,
                'position': {'x': 0.5, 'y': 0.5},
                'note': 'Original aspect ratio matches target'
            }
        
        # Determine crop positioning based on category
        if category in ['podcast', 'vlog', 'gaming']:
            # Center crop for speaker/subject focused content
            return {
                'type': 'center',
                'confidence': 0.7,
                'position': {'x': 0.5, 'y': 0.4},  # Slightly above center for faces
                'note': 'Center crop recommended for subject-focused content. Manual adjustment may improve framing.'
            }
        elif category in ['travel', 'cinematic']:
            # Center crop for scenic content
            return {
                'type': 'center',
                'confidence': 0.6,
                'position': {'x': 0.5, 'y': 0.5},
                'note': 'Center crop preserves main composition. Review for important details at edges.'
            }
        else:
            # Safe center crop
            return {
                'type': 'center',
                'confidence': 0.5,
                'position': {'x': 0.5, 'y': 0.5},
                'note': 'Basic center crop. Manual review recommended for optimal framing.'
            }
    
    def _get_platform_compatibility(self, format_type: str) -> List[str]:
        """List platforms that support this format."""
        compatibility = {
            '9:16': ['Instagram Reels', 'TikTok', 'YouTube Shorts', 'Snapchat'],
            '16:9': ['YouTube', 'Facebook', 'Twitter/X', 'LinkedIn'],
            '1:1': ['Instagram Feed', 'Facebook', 'Twitter/X', 'LinkedIn']
        }
        return compatibility.get(format_type, [])
    
    def suggest_editing_ideas(self, clip: Dict, category: str, audio_analysis: Optional[Dict], 
                            visual_analysis: Optional[Dict]) -> List[Dict]:
        """
        Generate category-aware editing suggestions.
        
        Args:
            clip: Clip data
            category: Content category
            audio_analysis: Audio energy, peaks, speech data
            visual_analysis: Scene changes, motion data
        
        Returns:
            List of editing ideas with timestamps and reasoning
        """
        ideas = []
        duration = clip.get('duration', 0)
        
        # Category-specific baseline suggestions
        if category == 'gaming':
            ideas.extend([
                {
                    'type': 'pacing',
                    'suggestion': 'Speed up non-action moments by 1.2-1.5x',
                    'reasoning': 'Maintains viewer engagement during slower gameplay',
                    'priority': 'medium'
                },
                {
                    'type': 'emphasis',
                    'suggestion': 'Zoom in on key moments or reactions',
                    'reasoning': 'Emphasizes exciting gameplay events',
                    'priority': 'high'
                }
            ])
        
        elif category == 'educational':
            ideas.extend([
                {
                    'type': 'clarity',
                    'suggestion': 'Add text overlays for key terms or steps',
                    'reasoning': 'Reinforces learning points visually',
                    'priority': 'high'
                },
                {
                    'type': 'pacing',
                    'suggestion': 'Keep steady pacing - avoid speed changes',
                    'reasoning': 'Educational content benefits from consistent delivery',
                    'priority': 'medium'
                }
            ])
        
        elif category == 'podcast':
            ideas.extend([
                {
                    'type': 'simplicity',
                    'suggestion': 'Minimal editing - let conversation flow naturally',
                    'reasoning': 'Podcast content works best with clean, uninterrupted delivery',
                    'priority': 'high'
                },
                {
                    'type': 'emphasis',
                    'suggestion': 'Subtle zoom on speaker during key points',
                    'reasoning': 'Draws attention to important moments without distraction',
                    'priority': 'low'
                }
            ])
        
        elif category in ['vlog', 'travel']:
            ideas.extend([
                {
                    'type': 'transitions',
                    'suggestion': 'Use smooth crossfades or matched cuts between scenes',
                    'reasoning': 'Creates cohesive storytelling flow',
                    'priority': 'medium'
                },
                {
                    'type': 'b-roll',
                    'suggestion': 'Layer cutaway shots over narration',
                    'reasoning': 'Adds visual interest to narrative moments',
                    'priority': 'medium'
                }
            ])
        
        elif category == 'comedy':
            ideas.extend([
                {
                    'type': 'timing',
                    'suggestion': 'Respect comedic timing - avoid cutting punchlines',
                    'reasoning': 'Comedy relies on precise timing for maximum impact',
                    'priority': 'critical'
                },
                {
                    'type': 'emphasis',
                    'suggestion': 'Zoom or freeze frame on reactions',
                    'reasoning': 'Emphasizes comedic payoffs',
                    'priority': 'medium'
                }
            ])
        
        elif category == 'sports':
            ideas.extend([
                {
                    'type': 'action',
                    'suggestion': 'Add slow-motion on key plays',
                    'reasoning': 'Highlights critical moments and skill',
                    'priority': 'high'
                },
                {
                    'type': 'pacing',
                    'suggestion': 'Fast cuts between action sequences',
                    'reasoning': 'Maintains high energy and excitement',
                    'priority': 'medium'
                }
            ])
        
        # Audio-based suggestions
        if audio_analysis:
            volume_peaks = audio_analysis.get('volume_peaks', [])
            if len(volume_peaks) > 2:
                peak_times = [p.get('timestamp', 0) for p in volume_peaks[:3]]
                ideas.append({
                    'type': 'audio_emphasis',
                    'suggestion': f'Emphasize moments at {", ".join(f"{t:.1f}s" for t in peak_times)}',
                    'reasoning': 'Volume peaks indicate exciting or important moments',
                    'timestamps': peak_times,
                    'priority': 'medium'
                })
        
        # Visual-based suggestions
        if visual_analysis:
            scene_changes = visual_analysis.get('scene_changes', [])
            if len(scene_changes) > 3:
                ideas.append({
                    'type': 'transitions',
                    'suggestion': f'Smooth transitions at scene changes ({len(scene_changes)} detected)',
                    'reasoning': 'Multiple scene changes suggest dynamic content that benefits from transitions',
                    'priority': 'low'
                })
            
            avg_motion = visual_analysis.get('motion_analysis', {}).get('average_magnitude', 0)
            if avg_motion > 0.3:
                ideas.append({
                    'type': 'stabilization',
                    'suggestion': 'Consider stabilization if footage appears shaky',
                    'reasoning': 'High motion detected - stabilization may improve viewing experience',
                    'priority': 'low'
                })
        
        # Hook improvement suggestions
        if duration > 45:
            ideas.append({
                'type': 'hook',
                'suggestion': 'Consider trimming opening to get to main content faster',
                'reasoning': 'Shorter hooks perform better on social media',
                'priority': 'medium'
            })
        
        return ideas
    
    def suggest_music_mood(self, clip: Dict, category: str, audio_analysis: Optional[Dict]) -> Dict:
        """
        Suggest music mood and sound effects.
        
        Args:
            clip: Clip data
            category: Content category
            audio_analysis: Audio energy and speech data
        
        Returns:
            Music and sound recommendations
        """
        # Category-specific music moods
        mood_map = {
            'gaming': 'upbeat, energetic, electronic',
            'educational': 'calm, focused, minimal',
            'podcast': 'subtle background, minimal or none',
            'vlog': 'upbeat, positive, relatable',
            'travel': 'inspirational, adventurous, ambient',
            'cinematic': 'dramatic, emotional, orchestral',
            'comedy': 'playful, light, quirky',
            'sports': 'intense, powerful, driving',
            'documentary': 'thoughtful, atmospheric, subtle'
        }
        
        music_mood = mood_map.get(category, 'neutral, background')
        
        # Analyze audio to refine suggestion
        speech_density = 0.7  # Default
        if audio_analysis:
            speech_regions = audio_analysis.get('speech_regions', [])
            duration = clip.get('duration', 1)
            if duration > 0:
                total_speech = sum(r.get('duration', 0) for r in speech_regions)
                speech_density = total_speech / duration
        
        # Adjust recommendation based on speech density
        if speech_density > 0.85:
            volume_level = 'very-low-background'
            volume_note = 'High speech density - music should be very subtle or none'
        elif speech_density > 0.6:
            volume_level = 'low-background'
            volume_note = 'Moderate speech - keep music as subtle background'
        else:
            volume_level = 'background'
            volume_note = 'Lower speech density allows for more prominent background music'
        
        # Silence moments (good for music emphasis)
        silence_moments = []
        if audio_analysis:
            silence_periods = audio_analysis.get('silence_periods', [])
            silence_moments = [
                {'start': s.get('start', 0), 'end': s.get('end', 0)}
                for s in silence_periods[:5]
            ]
        
        # Sound effect suggestions based on category
        sound_effects = self._suggest_sound_effects(clip, category, audio_analysis)
        
        return {
            'music_mood': music_mood,
            'volume_level': volume_level,
            'volume_note': volume_note,
            'speech_density': round(speech_density, 2),
            'silence_moments': silence_moments,
            'sound_effect_ideas': sound_effects,
            'licensing_note': 'Use royalty-free music or original audio. Do not use copyrighted tracks.',
            'application_note': 'Recommendations only - music must be added manually in video editor'
        }
    
    def _suggest_sound_effects(self, clip: Dict, category: str, audio_analysis: Optional[Dict]) -> List[Dict]:
        """Generate sound effect suggestions with timestamps."""
        effects = []
        
        # Category-specific sound effect ideas
        if category == 'gaming':
            effects.append({
                'type': 'whoosh',
                'timing': 'scene_transitions',
                'reasoning': 'Enhances fast-paced gameplay transitions'
            })
        elif category == 'educational':
            effects.append({
                'type': 'subtle_ding',
                'timing': 'key_points',
                'reasoning': 'Draws attention to important learning moments'
            })
        elif category == 'comedy':
            effects.append({
                'type': 'record_scratch',
                'timing': 'plot_twists',
                'reasoning': 'Emphasizes unexpected moments'
            })
        
        return effects
    
    def create_export_presets(self, clip: Dict, video_metadata: Dict, recommended_format: str) -> List[Dict]:
        """
        Generate social media export presets.
        
        Args:
            clip: Clip data with duration
            video_metadata: Original video properties
            recommended_format: Recommended aspect ratio
        
        Returns:
            List of platform-specific export configurations
        """
        duration = clip.get('duration', 0)
        
        presets = []
        
        # Instagram Reels
        if duration <= 90:
            presets.append({
                'platform': 'Instagram Reels',
                'aspect_ratio': '9:16',
                'resolution': {'width': 1080, 'height': 1920},
                'frame_rate': 30,
                'format': 'mp4',
                'codec': 'h264',
                'audio_codec': 'aac',
                'audio_bitrate': '128k',
                'max_duration': 90,
                'recommended': recommended_format == '9:16',
                'notes': 'Vertical format required. Up to 90 seconds.'
            })
        
        # YouTube Shorts
        if duration <= 60:
            presets.append({
                'platform': 'YouTube Shorts',
                'aspect_ratio': '9:16',
                'resolution': {'width': 1080, 'height': 1920},
                'frame_rate': 30,
                'format': 'mp4',
                'codec': 'h264',
                'audio_codec': 'aac',
                'max_duration': 60,
                'recommended': recommended_format == '9:16',
                'notes': 'Vertical format required. Up to 60 seconds.'
            })
        
        # TikTok
        if duration <= 180:
            presets.append({
                'platform': 'TikTok',
                'aspect_ratio': '9:16',
                'resolution': {'width': 1080, 'height': 1920},
                'frame_rate': 30,
                'format': 'mp4',
                'codec': 'h264',
                'audio_codec': 'aac',
                'max_duration': 180,
                'recommended': recommended_format == '9:16',
                'notes': 'Vertical format preferred. Up to 3 minutes.'
            })
        
        # Generic vertical (for all platforms)
        presets.append({
            'platform': 'Generic Vertical',
            'aspect_ratio': '9:16',
            'resolution': {'width': 1080, 'height': 1920},
            'frame_rate': 30,
            'format': 'mp4',
            'codec': 'h264',
            'audio_codec': 'aac',
            'recommended': recommended_format == '9:16',
            'notes': 'Universal vertical format for mobile platforms'
        })
        
        # Square format (Instagram Feed, Facebook)
        presets.append({
            'platform': 'Square (Instagram/Facebook)',
            'aspect_ratio': '1:1',
            'resolution': {'width': 1080, 'height': 1080},
            'frame_rate': 30,
            'format': 'mp4',
            'codec': 'h264',
            'audio_codec': 'aac',
            'recommended': recommended_format == '1:1',
            'notes': 'Square format for feed posts'
        })
        
        # Original aspect ratio (YouTube, general use)
        original_width = video_metadata.get('width', 1920)
        original_height = video_metadata.get('height', 1080)
        presets.append({
            'platform': 'Original Quality',
            'aspect_ratio': f'{original_width}:{original_height}',
            'resolution': {'width': original_width, 'height': original_height},
            'frame_rate': 30,
            'format': 'mp4',
            'codec': 'h264',
            'audio_codec': 'aac',
            'recommended': False,
            'notes': 'Preserves original aspect ratio and quality'
        })
        
        return presets
    
    def generate_enhancement_fingerprint(self, clip: Dict) -> str:
        """Generate fingerprint for caching enhancements."""
        key_data = f"{clip['id']}:{clip['start']}:{clip['end']}:{clip.get('excerpt', '')}"
        return hashlib.sha256(key_data.encode()).hexdigest()[:16]
