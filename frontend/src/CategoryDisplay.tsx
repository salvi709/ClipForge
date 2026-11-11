import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { ContentCategory, ContentProfile, updateCategory } from './api';

const CATEGORY_ICONS: Record<string, string> = {
  gaming: '🎮',
  educational: '📚',
  podcast: '🎙️',
  vlog: '📹',
  comedy: '😂',
  documentary: '🎬',
  music: '🎵',
  sports: '⚽',
  cinematic: '🎥',
  travel: '✈️',
  mixed: '🎭',
  generic: '📄',
  minimal_speech: '🔇',
};

const CATEGORY_LABELS: Record<string, string> = {
  gaming: 'Gaming',
  educational: 'Educational',
  podcast: 'Podcast / Interview',
  vlog: 'Vlog / Lifestyle',
  comedy: 'Comedy',
  documentary: 'Documentary',
  music: 'Music / Performance',
  sports: 'Sports / Action',
  cinematic: 'Cinematic / Travel',
  travel: 'Travel',
  mixed: 'Mixed Content',
  generic: 'General Content',
  minimal_speech: 'Visual Content',
};

type Props = {
  projectId: string;
  detectedCategory?: ContentCategory;
  userCategory?: ContentCategory;
  confidence?: number;
  contentProfile?: ContentProfile;
  onCategoryChange?: () => void;
};

export function CategoryDisplay({
  projectId,
  detectedCategory,
  userCategory,
  confidence,
  contentProfile,
  onCategoryChange,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ContentCategory | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!detectedCategory && !userCategory) {
    return null;
  }

  const activeCategory = userCategory || detectedCategory || 'generic';
  const confidenceValue = contentProfile?.confidence ?? (confidence ? parseFloat(String(confidence)) : 0);
  const isUserOverride = !!userCategory && userCategory !== detectedCategory;

  const confidenceLevel =
    confidenceValue >= 0.7 ? 'high' : confidenceValue >= 0.4 ? 'medium' : 'low';

  const handleSaveCategory = async () => {
    if (!selectedCategory) return;
    setSaving(true);
    setError('');
    try {
      await updateCategory(projectId, selectedCategory);
      setIsEditing(false);
      setSelectedCategory('');
      onCategoryChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update category');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="category-section">
      <div className="category-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className={`category-badge ${confidenceLevel}-confidence`}>
            <span className="icon">{CATEGORY_ICONS[activeCategory]}</span>
            <span>{CATEGORY_LABELS[activeCategory] || activeCategory}</span>
            {contentProfile?.secondary_category && (
              <span className="category-mixed-tag">
                + {CATEGORY_LABELS[contentProfile.secondary_category]}
              </span>
            )}
          </div>
          <div className="confidence-indicator">
            <span>{Math.round(confidenceValue * 100)}%</span>
            <div className="confidence-bar">
              <div
                className={`confidence-fill ${confidenceLevel}`}
                style={{ width: `${confidenceValue * 100}%` }}
              />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {!isEditing && (
            <button
              type="button"
              className="secondary"
              style={{ padding: '6px 12px', fontSize: '12px' }}
              onClick={() => setIsEditing(true)}
            >
              {isUserOverride ? 'Change' : 'Override'}
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => setShowDetails(!showDetails)}
            aria-expanded={showDetails}
          >
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {isUserOverride && (
        <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
          Originally detected as: {CATEGORY_LABELS[detectedCategory || 'generic']} (
          {Math.round(confidenceValue * 100)}%)
        </div>
      )}

      {isEditing && (
        <div className="category-selector">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as ContentCategory)}
          >
            <option value="">Select category...</option>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {CATEGORY_ICONS[key]} {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary"
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={handleSaveCategory}
            disabled={!selectedCategory || saving}
          >
            {saving ? 'Saving...' : 'Apply'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setIsEditing(false);
              setSelectedCategory('');
              setError('');
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="warning-text" style={{ marginTop: '8px', fontSize: '12px' }}>
          {error}
        </p>
      )}

      {showDetails && contentProfile && (
        <div className="category-details">
          {contentProfile.detection_explanation && (
            <div className="category-explanation">
              <strong>Detection:</strong> {contentProfile.detection_explanation}
            </div>
          )}
          {contentProfile.supporting_evidence && contentProfile.supporting_evidence.length > 0 && (
            <div className="category-evidence">
              <strong style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                Supporting Evidence:
              </strong>
              {contentProfile.supporting_evidence.map((evidence, idx) => (
                <div key={idx} className="evidence-item">
                  {evidence}
                </div>
              ))}
            </div>
          )}
          {contentProfile.is_mixed_content && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#a78bfa' }}>
              <Sparkles size={12} style={{ display: 'inline', marginRight: '4px' }} />
              This video contains elements from multiple content types.
            </div>
          )}
        </div>
      )}

      <div className="category-strategy-note">
        <Sparkles size={14} />
        <span>
          ClipForge will use {CATEGORY_LABELS[activeCategory]}-optimized discovery strategy
        </span>
      </div>
    </div>
  );
}
