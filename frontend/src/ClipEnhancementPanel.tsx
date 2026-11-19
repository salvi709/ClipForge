import { useState } from 'react';
import { 
  Sparkles, Copy, RefreshCw, ChevronDown, ChevronUp, Check,
  Video, Type, Music, Scissors, Download, AlertCircle
} from 'lucide-react';
import {
  ClipEnhancement,
  generateEnhancement,
  regenerateTitles,
  exportCaptions
} from './api';

type Props = {
  projectId: string;
  clipId: string;
  onClose: () => void;
};

export default function ClipEnhancementPanel({ projectId, clipId, onClose }: Props) {
  const [enhancement, setEnhancement] = useState<ClipEnhancement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['titles']));

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await generateEnhancement(projectId, clipId);
      setEnhancement(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate enhancements');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateTitles = async () => {
    if (!enhancement) return;
    setRegenerating(true);
    setError('');
    try {
      const result = await regenerateTitles(projectId, clipId);
      setEnhancement({
        ...enhancement,
        titles: result.titles,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate titles');
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleExportCaptions = async () => {
    try {
      const result = await exportCaptions(projectId, clipId);
      // Create download
      const blob = new Blob([result.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clip-${clipId}-captions.srt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export captions');
    }
  };

  if (loading) {
    return (
      <div className="enhancement-panel">
        <div className="enhancement-header">
          <h3><Sparkles size={18} /> Smart Enhancement Assistant</h3>
          <button className="text-button" onClick={onClose}>&times;</button>
        </div>
        <div className="enhancement-loading">
          <RefreshCw size={32} className="spin" />
          <p>Analyzing clip and generating recommendations...</p>
          <small>This uses local AI and may take 10-30 seconds</small>
        </div>
      </div>
    );
  }

  if (!enhancement) {
    return (
      <div className="enhancement-panel">
        <div className="enhancement-header">
          <h3><Sparkles size={18} /> Smart Enhancement Assistant</h3>
          <button className="text-button" onClick={onClose}>&times;</button>
        </div>
        <div className="enhancement-intro">
          <p>
            Get AI-powered recommendations to optimize this clip for Instagram Reels, 
            YouTube Shorts, and TikTok.
          </p>
          <ul>
            <li>✨ Title and hook suggestions</li>
            <li>💬 Caption style recommendations</li>
            <li>📱 Video format optimization</li>
            <li>✂️ Editing ideas</li>
            <li>🎵 Music and sound suggestions</li>
            <li>📤 Social media export presets</li>
          </ul>
          <button className="primary" onClick={handleGenerate}>
            <Sparkles size={16} /> Generate Recommendations
          </button>
          {error && <p className="warning-text" role="alert">{error}</p>}
          <small className="enhancement-note">
            All recommendations are generated locally using Ollama. Nothing is automatically applied.
          </small>
        </div>
      </div>
    );
  }

  return (
    <div className="enhancement-panel">
      <div className="enhancement-header">
        <h3><Sparkles size={18} /> Smart Enhancement Assistant</h3>
        <button className="text-button" onClick={onClose}>&times;</button>
      </div>

      {error && (
        <div className="notice error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Title Suggestions */}
      <div className="enhancement-section">
        <button
          className="enhancement-section-header"
          onClick={() => toggleSection('titles')}
        >
          <Type size={16} />
          <span>Suggested Titles ({enhancement.titles.length})</span>
          {expandedSections.has('titles') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedSections.has('titles') && (
          <div className="enhancement-section-content">
            <div className="title-options">
              {enhancement.titles.map((title, idx) => (
                <div key={idx} className="title-option">
                  <div className="title-text">{title.text}</div>
                  <div className="title-meta">
                    <span className="title-type">{title.hook_type}</span>
                    <span className="title-reasoning">{title.reasoning}</span>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => handleCopy(title.text, idx)}
                    style={{ padding: '4px 12px', fontSize: '12px' }}
                  >
                    {copiedIndex === idx ? (
                      <><Check size={12} /> Copied</>
                    ) : (
                      <><Copy size={12} /> Copy</>
                    )}
                  </button>
                </div>
              ))}
            </div>
            <button
              className="secondary"
              onClick={handleRegenerateTitles}
              disabled={regenerating}
              style={{ marginTop: '12px' }}
            >
              <RefreshCw size={14} className={regenerating ? 'spin' : ''} />
              {regenerating ? 'Generating...' : 'Generate New Options'}
            </button>
          </div>
        )}
      </div>

      {/* Caption Style */}
      <div className="enhancement-section">
        <button
          className="enhancement-section-header"
          onClick={() => toggleSection('captions')}
        >
          <Type size={16} />
          <span>Caption Style</span>
          {expandedSections.has('captions') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedSections.has('captions') && (
          <div className="enhancement-section-content">
            <div className="caption-recommendation">
              <h4>{enhancement.caption_style.style.toUpperCase()} Style</h4>
              <p>{enhancement.caption_style.reasoning}</p>
              <div className="caption-params">
                <div><strong>Max chars/line:</strong> {enhancement.caption_style.max_chars_per_line}</div>
                <div><strong>Lines:</strong> {enhancement.caption_style.line_count}</div>
                <div><strong>Position:</strong> {enhancement.caption_style.position}</div>
                <div><strong>Animation:</strong> {enhancement.caption_style.animation}</div>
                <div><strong>Highlight keywords:</strong> {enhancement.caption_style.highlight_keywords ? 'Yes' : 'No'}</div>
              </div>
              {enhancement.caption_style.show_uncertainty_warning && (
                <div className="caption-warning">
                  <AlertCircle size={14} />
                  <span>This clip contains uncertain transcription spans marked as {enhancement.caption_style.uncertain_marker}</span>
                </div>
              )}
              <button className="primary" onClick={handleExportCaptions} style={{ marginTop: '12px' }}>
                <Download size={14} /> Export Captions (SRT)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Video Format */}
      <div className="enhancement-section">
        <button
          className="enhancement-section-header"
          onClick={() => toggleSection('format')}
        >
          <Video size={16} />
          <span>Video Format</span>
          {expandedSections.has('format') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedSections.has('format') && (
          <div className="enhancement-section-content">
            <div className="format-recommendation">
              <div className="format-badge">{enhancement.format_recommendation.recommended_format}</div>
              <p>{enhancement.format_recommendation.reasoning}</p>
              <div className="format-details">
                <div><strong>Original:</strong> {enhancement.format_recommendation.original_aspect_ratio}</div>
                <div><strong>Recommended:</strong> {enhancement.format_recommendation.recommended_format}</div>
              </div>
              <div className="crop-suggestion">
                <h4>Crop Suggestion</h4>
                <p><strong>Type:</strong> {enhancement.format_recommendation.crop_suggestion.type}</p>
                <p><strong>Confidence:</strong> {Math.round(enhancement.format_recommendation.crop_suggestion.confidence * 100)}%</p>
                <p className="crop-note">{enhancement.format_recommendation.crop_suggestion.note}</p>
              </div>
              <div className="platform-compatibility">
                <strong>Compatible with:</strong> {enhancement.format_recommendation.platforms.join(', ')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Editing Ideas */}
      <div className="enhancement-section">
        <button
          className="enhancement-section-header"
          onClick={() => toggleSection('editing')}
        >
          <Scissors size={16} />
          <span>Editing Ideas ({enhancement.editing_ideas.length})</span>
          {expandedSections.has('editing') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedSections.has('editing') && (
          <div className="enhancement-section-content">
            <div className="editing-ideas">
              {enhancement.editing_ideas.map((idea, idx) => (
                <div key={idx} className={`editing-idea priority-${idea.priority}`}>
                  <div className="idea-header">
                    <span className="idea-type">{idea.type}</span>
                    <span className={`idea-priority ${idea.priority}`}>{idea.priority}</span>
                  </div>
                  <p className="idea-suggestion">{idea.suggestion}</p>
                  <p className="idea-reasoning">{idea.reasoning}</p>
                  {idea.timestamps && idea.timestamps.length > 0 && (
                    <p className="idea-timestamps">
                      <strong>Timestamps:</strong> {idea.timestamps.map(t => `${t.toFixed(1)}s`).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Music & Sound */}
      <div className="enhancement-section">
        <button
          className="enhancement-section-header"
          onClick={() => toggleSection('music')}
        >
          <Music size={16} />
          <span>Music & Sound</span>
          {expandedSections.has('music') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedSections.has('music') && (
          <div className="enhancement-section-content">
            <div className="music-recommendation">
              <div><strong>Mood:</strong> {enhancement.music_recommendation.music_mood}</div>
              <div><strong>Volume:</strong> {enhancement.music_recommendation.volume_level}</div>
              <p>{enhancement.music_recommendation.volume_note}</p>
              <div><strong>Speech density:</strong> {Math.round(enhancement.music_recommendation.speech_density * 100)}%</div>
              
              {enhancement.music_recommendation.silence_moments.length > 0 && (
                <div className="silence-moments">
                  <h4>Silence Moments (good for music emphasis):</h4>
                  <ul>
                    {enhancement.music_recommendation.silence_moments.slice(0, 3).map((moment, idx) => (
                      <li key={idx}>{moment.start.toFixed(1)}s - {moment.end.toFixed(1)}s</li>
                    ))}
                  </ul>
                </div>
              )}

              {enhancement.music_recommendation.sound_effect_ideas.length > 0 && (
                <div className="sound-effects">
                  <h4>Sound Effect Ideas:</h4>
                  {enhancement.music_recommendation.sound_effect_ideas.map((effect, idx) => (
                    <div key={idx} className="sound-effect">
                      <strong>{effect.type}</strong> at {effect.timing} - {effect.reasoning}
                    </div>
                  ))}
                </div>
              )}

              <div className="music-notes">
                <p><small>{enhancement.music_recommendation.licensing_note}</small></p>
                <p><small>{enhancement.music_recommendation.application_note}</small></p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Export Presets */}
      <div className="enhancement-section">
        <button
          className="enhancement-section-header"
          onClick={() => toggleSection('export')}
        >
          <Download size={16} />
          <span>Export Presets ({enhancement.export_presets.length})</span>
          {expandedSections.has('export') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedSections.has('export') && (
          <div className="enhancement-section-content">
            <div className="export-presets">
              {enhancement.export_presets.map((preset, idx) => (
                <div key={idx} className={`export-preset ${preset.recommended ? 'recommended' : ''}`}>
                  <div className="preset-header">
                    <strong>{preset.platform}</strong>
                    {preset.recommended && <span className="preset-badge">Recommended</span>}
                  </div>
                  <div className="preset-details">
                    <div>{preset.aspect_ratio} • {preset.resolution.width}x{preset.resolution.height}</div>
                    <div>{preset.frame_rate}fps • {preset.format.toUpperCase()}</div>
                    {preset.max_duration && <div>Max: {preset.max_duration}s</div>}
                  </div>
                  <p className="preset-notes">{preset.notes}</p>
                </div>
              ))}
            </div>
            <div className="export-note">
              <AlertCircle size={14} />
              <span>Export presets are recommendations. Use the existing "Download MP4" button for actual exports.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
