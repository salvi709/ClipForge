import crypto from 'node:crypto';
import type { AudioAnalysis, SceneAnalysis, TranscriptData, VideoMetadata } from './store.ts';

export class ClipEnhancer {
  generateFingerprint(clip: Record<string, unknown>): string {
    const key = `${clip.id}:${clip.start}:${clip.end}:${clip.excerpt || ''}`;
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  generateTitles(clip: Record<string, unknown>, category: string, excerpt: string) {
    const words = excerpt.trim().split(/\s+/).filter(Boolean);
    const opening = words.slice(0, 7).join(' ').replace(/[,:;]+$/, '');
    const titleBase = String(clip.title || opening || 'Key Moment').slice(0, 60);
    const catLabel = category.charAt(0).toUpperCase() + category.slice(1);

    return [
      {
        text: titleBase,
        hook_type: 'statement',
        reasoning: 'Grounded directly in the clip’s primary spoken topic.',
      },
      {
        text: `Why This ${catLabel} Point Matters`,
        hook_type: 'curiosity',
        reasoning: 'Frames the core takeaway as a clear value proposition.',
      },
      {
        text: opening ? `"${opening}..."` : `Inside This ${catLabel} Moment`,
        hook_type: 'quote',
        reasoning: 'Leads with an authentic quote from the opening seconds.',
      },
      {
        text: `How to Apply This ${catLabel} Insight`,
        hook_type: 'question',
        reasoning: 'Highlights actionable clarity for short-form viewers.',
      },
    ];
  }

  recommendCaptionStyle(category: string, hasUncertain: boolean) {
    const styles: Record<string, Record<string, unknown>> = {
      gaming: {
        style: 'dynamic',
        max_chars_per_line: 35,
        line_count: 2,
        highlight_keywords: true,
        animation: 'pop-in',
        position: 'top',
        font_weight: 'bold',
        color_scheme: 'high-contrast',
        reasoning: `Dynamic captions match the high-energy ${category} content`,
      },
      educational: {
        style: 'clear',
        max_chars_per_line: 40,
        line_count: 2,
        highlight_keywords: true,
        animation: 'fade',
        position: 'bottom',
        font_weight: 'medium',
        color_scheme: 'clean',
        reasoning: 'Clear captions emphasize learning and clarity',
      },
      podcast: {
        style: 'minimal',
        max_chars_per_line: 50,
        line_count: 1,
        highlight_keywords: false,
        animation: 'none',
        position: 'bottom',
        font_weight: 'regular',
        color_scheme: 'subtle',
        reasoning: 'Minimal captions keep focus on the conversation',
      },
      comedy: {
        style: 'emphasized',
        max_chars_per_line: 30,
        line_count: 2,
        highlight_keywords: true,
        animation: 'bounce',
        position: 'center',
        font_weight: 'bold',
        color_scheme: 'playful',
        reasoning: 'Emphasized captions enhance comedic timing',
      },
    };
    const rec = {
      ...(styles[category] || {
        style: 'standard',
        max_chars_per_line: 40,
        line_count: 2,
        highlight_keywords: false,
        animation: 'fade',
        position: 'bottom',
        font_weight: 'medium',
        color_scheme: 'neutral',
        reasoning: `Standard captions suit ${category} content`,
      }),
      show_uncertainty_warning: hasUncertain,
      ...(hasUncertain ? { uncertain_marker: '[uncertain]' } : {}),
    };
    return rec;
  }

  recommendFormat(metadata: VideoMetadata, category: string) {
    const width = metadata.width || 1920;
    const height = metadata.height || 1080;
    const originalAspect = height > 0 ? width / height : 16 / 9;

    let recommendedFormat: '9:16' | '16:9' | '1:1' = '9:16';
    let reasoning = 'Vertical format is standard for short-form social media';

    if (['cinematic', 'travel', 'documentary'].includes(category) && originalAspect > 1.5) {
      recommendedFormat = '16:9';
      reasoning = 'Cinematic composition benefits from wide format';
    } else if (category === 'educational' && width > 1.5 * height) {
      recommendedFormat = '1:1';
      reasoning = 'Square format preserves screen content visibility';
    }

    const platforms: Record<'9:16' | '16:9' | '1:1', string[]> = {
      '9:16': ['Instagram Reels', 'TikTok', 'YouTube Shorts', 'Snapchat'],
      '16:9': ['YouTube', 'Facebook', 'Twitter/X', 'LinkedIn'],
      '1:1': ['Instagram Feed', 'Facebook', 'Twitter/X', 'LinkedIn'],
    };

    const targetAspect =
      recommendedFormat === '9:16' ? 9 / 16 : recommendedFormat === '16:9' ? 16 / 9 : 1;
    const needsCrop = Math.abs(originalAspect - targetAspect) > 0.1;

    return {
      recommended_format: recommendedFormat,
      original_aspect_ratio: `${width}:${height}`,
      crop_suggestion: needsCrop
        ? {
            type: 'center' as const,
            confidence: 0.75,
            position: { x: 0.5, y: 0.45 },
            note: 'Center crop recommended for subject framing.',
          }
        : {
            type: 'none' as const,
            confidence: 1.0,
            position: { x: 0.5, y: 0.5 },
            note: 'Original aspect ratio matches target.',
          },
      reasoning,
      platforms: platforms[recommendedFormat],
    };
  }

  suggestEditingIdeas(
    clip: Record<string, unknown>,
    category: string,
    audioAnalysis?: AudioAnalysis,
    visualAnalysis?: SceneAnalysis
  ) {
    const ideas: Array<Record<string, unknown>> = [
      {
        type: 'clarity',
        suggestion:
          category === 'podcast'
            ? 'Minimal editing — let conversation flow naturally'
            : 'Add concise on-screen keyword callouts at key transitions',
        reasoning: `Matches viewer expectations for ${category} clips`,
        priority: 'high',
      },
      {
        type: 'pacing',
        suggestion: 'Trim trailing pauses longer than 0.8s at clip boundaries',
        reasoning: 'Tight openings and clean endings retain mobile viewers',
        priority: 'medium',
      },
    ];

    if (audioAnalysis && audioAnalysis.volume_peaks.length > 0) {
      const timestamps = audioAnalysis.volume_peaks
        .slice(0, 3)
        .map((p) => p.timestamp)
        .filter((t) => t >= Number(clip.start || 0) && t <= Number(clip.end || 0));
      if (timestamps.length > 0) {
        ideas.push({
          type: 'audio_emphasis',
          suggestion: `Emphasize vocal peaks near ${timestamps.map((t) => `${t.toFixed(1)}s`).join(', ')}`,
          reasoning: 'Audio energy peaks indicate high-engagement moments',
          timestamps,
          priority: 'medium',
        });
      }
    }

    if (visualAnalysis && visualAnalysis.scene_changes.length > 2) {
      ideas.push({
        type: 'transitions',
        suggestion: 'Keep cuts aligned with detected visual scene transitions',
        reasoning: 'Avoids jarring mid-motion cuts',
        priority: 'low',
      });
    }

    return ideas;
  }

  suggestMusicMood(
    clip: Record<string, unknown>,
    category: string,
    audioAnalysis?: AudioAnalysis
  ) {
    const moodMap: Record<string, string> = {
      gaming: 'upbeat, energetic, electronic',
      educational: 'calm, focused, minimal',
      podcast: 'subtle background, minimal or none',
      vlog: 'upbeat, positive, relatable',
      travel: 'inspirational, adventurous, ambient',
      cinematic: 'dramatic, emotional, orchestral',
      comedy: 'playful, light, quirky',
      sports: 'intense, powerful, driving',
      documentary: 'thoughtful, atmospheric, subtle',
    };
    const duration = Math.max(1, Number(clip.duration || 1));
    const speechTotal = audioAnalysis
      ? audioAnalysis.speech_regions.reduce((s, r) => s + r.duration, 0)
      : duration * 0.72;
    const speechDensity = Math.min(1, Number((speechTotal / Math.max(duration, speechTotal)).toFixed(2)));

    return {
      music_mood: moodMap[category] || 'neutral, background',
      volume_level: speechDensity > 0.75 ? 'very-low-background' : 'low-background',
      volume_note:
        speechDensity > 0.75
          ? 'High speech density — keep background music very subtle or off'
          : 'Moderate speech — subtle background music works well',
      speech_density: speechDensity,
      silence_moments: (audioAnalysis?.silence_periods || []).slice(0, 5).map((s) => ({
        start: s.start,
        end: s.end,
      })),
      sound_effect_ideas: [
        {
          type: category === 'gaming' ? 'whoosh' : 'subtle_ding',
          timing: 'key_points',
          reasoning: 'Highlights transitions without overpowering speech',
        },
      ],
      licensing_note: 'Use royalty-free music or original audio.',
      application_note: 'Recommendations only — add music in your video editor.',
    };
  }

  createExportPresets(
    clip: Record<string, unknown>,
    metadata: VideoMetadata,
    recommendedFormat: string
  ) {
    const duration = Number(clip.duration || 0);
    const width = metadata.width || 1920;
    const height = metadata.height || 1080;
    const presets: Array<Record<string, unknown>> = [];

    if (duration <= 90) {
      presets.push({
        platform: 'Instagram Reels',
        aspect_ratio: '9:16',
        resolution: { width: 1080, height: 1920 },
        frame_rate: 30,
        format: 'mp4',
        codec: 'h264',
        audio_codec: 'aac',
        audio_bitrate: '128k',
        max_duration: 90,
        recommended: recommendedFormat === '9:16',
        notes: 'Vertical format required. Up to 90 seconds.',
      });
    }
    if (duration <= 60) {
      presets.push({
        platform: 'YouTube Shorts',
        aspect_ratio: '9:16',
        resolution: { width: 1080, height: 1920 },
        frame_rate: 30,
        format: 'mp4',
        codec: 'h264',
        audio_codec: 'aac',
        max_duration: 60,
        recommended: recommendedFormat === '9:16',
        notes: 'Vertical format required. Up to 60 seconds.',
      });
    }
    presets.push({
      platform: 'TikTok',
      aspect_ratio: '9:16',
      resolution: { width: 1080, height: 1920 },
      frame_rate: 30,
      format: 'mp4',
      codec: 'h264',
      audio_codec: 'aac',
      max_duration: 180,
      recommended: recommendedFormat === '9:16',
      notes: 'Vertical format preferred. Up to 3 minutes.',
    });
    presets.push({
      platform: 'Square (Instagram/Facebook)',
      aspect_ratio: '1:1',
      resolution: { width: 1080, height: 1080 },
      frame_rate: 30,
      format: 'mp4',
      codec: 'h264',
      audio_codec: 'aac',
      recommended: recommendedFormat === '1:1',
      notes: 'Square format for feed posts',
    });
    presets.push({
      platform: 'Original Quality',
      aspect_ratio: `${width}:${height}`,
      resolution: { width, height },
      frame_rate: 30,
      format: 'mp4',
      codec: 'h264',
      audio_codec: 'aac',
      recommended: recommendedFormat === '16:9',
      notes: 'Preserves original aspect ratio and quality',
    });
    return presets;
  }

  exportCaptionsSrt(clip: Record<string, unknown>, transcript: TranscriptData) {
    const clipStart = Number(clip.start || 0);
    const clipEnd = Number(clip.end || 0);
    const clipDur = Number(clip.duration || clipEnd - clipStart);
    const lines: string[] = [];
    let index = 1;

    for (const seg of transcript.segments || []) {
      if (seg.end <= clipStart || seg.start >= clipEnd) continue;
      const start = Math.max(0, seg.start - clipStart);
      const end = Math.min(clipDur, seg.end - clipStart);
      const text = seg.uncertain_reason ? '[uncertain speech]' : seg.text;
      lines.push(String(index++));
      lines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
      lines.push(text);
      lines.push('');
    }
    return {
      format: 'srt',
      content: lines.join('\n'),
      caption_count: index - 1,
    };
  }
}

function formatSrtTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
