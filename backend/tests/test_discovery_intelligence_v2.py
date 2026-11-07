import json
import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models.discovery import Assessment
from app.services.candidates import (
    partition_discovery_candidates, compute_scoring_factors, rejection_reasons, quality_score, rank_candidates
)
from app.services.discovery_strategies import (
    CATEGORY_WEIGHTS, get_category_weights, normalize_category, get_system_prompt
)
from app.services.enhanced_candidates import build_enhanced_candidates
from app.services.evaluation import EvaluationMetrics
from tests.test_discovery import FakeOllama, NoTranscription, save_project, wait_discovery, speech, assessment


def test_category_weights_and_normalization():
    """Verify all 12 required categories have specific weights and proper alias mapping."""
    categories = [
        'educational', 'tutorials', 'podcasts', 'interviews', 'gaming', 'vlogs',
        'travel', 'cinematic', 'sports', 'comedy', 'documentaries', 'mixed'
    ]
    for cat in categories:
        norm = normalize_category(cat)
        assert norm in CATEGORY_WEIGHTS, f"Category '{cat}' normalized to '{norm}' not in CATEGORY_WEIGHTS"
        weights = get_category_weights(cat)
        assert len(weights) == 4
        assert sum(weights.values()) == pytest.approx(1.0, 0.01)
        prompt = get_system_prompt(cat)
        assert len(prompt) > 100

    # Verify that gaming weights hook much higher than educational
    assert get_category_weights('gaming')['hook_strength'] > get_category_weights('educational')['hook_strength']
    # Verify tutorials weights information higher than sports
    assert get_category_weights('tutorials')['informational_value'] > get_category_weights('sports')['informational_value']


def test_scoring_factors_computation():
    """Verify all 10 individual scoring factors are calculated accurately."""
    cand = {
        'id': 'cand1',
        'start': 0.0,
        'end': 30.0,
        'duration': 30.0,
        'excerpt': 'A machine learning model learns patterns from examples. The model classifies data based on patterns.',
        'audio_score': 88.0,
        'visual_score': 82.0,
    }
    assm = Assessment(
        candidate_id='cand1',
        title='Machine Learning Overview',
        evidence='learns patterns from examples',
        hook_strength=3,
        informational_value=4,
        context_completeness=4,
        clarity=4,
        reason='Clear definition and explanation of how learning models work.',
        suitable=True
    )

    factors = compute_scoring_factors(assm, cand, category='educational')
    assert 'hook_strength' in factors
    assert 'informational_value' in factors
    assert 'context_completeness' in factors
    assert 'clarity' in factors
    assert 'standalone_usefulness' in factors
    assert 'boundary_quality' in factors
    assert 'evidence_strength' in factors
    assert 'audio_relevance' in factors
    assert 'visual_relevance' in factors
    assert 'uniqueness' in factors
    assert 'category_relevance' in factors

    # Educational composite score with (0*3 + 0.4*4 + 0.35*4 + 0.25*4) * 20 = 80
    assert factors['composite_score'] == 80


def test_partition_top_picks_and_more_discoveries():
    """Verify candidates are properly partitioned into Top Picks and More Discoveries."""
    topics = [
        ('machine learning models and training data', 'Machine learning models learn patterns from examples.'),
        ('neural networks and deep architecture layers', 'Neural networks contain multiple interconnected layers.'),
        ('supervised versus unsupervised clustering', 'Supervised learning relies on explicit human labels.'),
        ('gradient descent optimization algorithms', 'Gradient descent minimizes the objective loss function.'),
        ('cross validation and generalization testing', 'Cross validation prevents overfitting to training sets.'),
        ('transformer attention mechanisms and tokens', 'Attention mechanisms assign dynamic weights to tokens.')
    ]
    cands = [
        {'id': f'c{i}', 'start': i * 32.0, 'end': i * 32.0 + 30.0, 'duration': 30.0,
         'excerpt': f'{topics[i][1]} Understanding this principle helps practitioners build robust solutions.',
         'sentence_ids': [i]}
        for i in range(6)
    ]
    assessments = [
        Assessment(
            candidate_id=f'c{i}',
            title=f'Topic {i}: {topics[i][0]}',
            evidence=topics[i][1][:30],
            hook_strength=3,
            informational_value=4,
            context_completeness=4,
            clarity=4,
            reason=f'Detailed explanation of {topics[i][0]} that stands alone.',
            suitable=True
        )
        for i in range(6)
    ]

    top_picks, more = partition_discovery_candidates(cands, assessments, limit=3, category='educational')
    assert len(top_picks) == 3
    assert len(more) == 3
    assert [c['rank'] for c in top_picks] == [1, 2, 3]
    assert [c['rank'] for c in more] == [4, 5, 6]
    assert all('scoring_factors' in c for c in top_picks)
    assert all('scoring_factors' in c for c in more)


def test_human_feedback_lifecycle_and_sqlite_persistence(tmp_path):
    """Verify human feedback is recorded with all dimensions and survives database reload."""
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        pid, _ = save_project(client, settings)
        client.post(f'/api/projects/{pid}/discovery')
        result = wait_discovery(client, pid)
        assert result['status'] == 'completed'
        clip = result['clips'][0]

        # Submit feedback with rating and accept action
        feedback_data = {
            'rating': 'excellent',
            'action': 'accept',
            'adjusted_start': clip['start'] + 1.0,
            'adjusted_end': clip['end'] - 1.0,
            'user_notes': 'Super clear explanation, great moment!'
        }
        res = client.post(f'/api/projects/{pid}/clips/{clip["id"]}/feedback', json=feedback_data)
        assert res.status_code == 200

    # Restart app with fresh TestClient and verify SQLite feedback persistence
    with TestClient(create_app(settings, NoTranscription(), FakeOllama(ready=False))) as client:
        stats_res = client.get(f'/api/projects/{pid}/feedback/stats')
        assert stats_res.status_code == 200
        stats = stats_res.json()
        assert stats['category'] in {'educational', 'generic'}
        human_eval = stats['user_feedback_metrics']['human_evaluation']
        assert human_eval is not None
        assert human_eval['is_measured_human_metric'] is True
        assert human_eval['ratings_breakdown']['excellent'] == 1
        assert human_eval['actions_breakdown']['accepted'] == 1
        assert human_eval['top_3_acceptance_rate'] == 1.0
        assert human_eval['precision_at_3'] == 1.0
        assert human_eval['avg_boundary_adjustment_seconds'] == 1.0


def test_manual_clip_marking_and_reference_comparison(tmp_path):
    """Verify users can mark moments manually and compare AI suggestions against manual references."""
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings, NoTranscription(), FakeOllama())) as client:
        pid, _ = save_project(client, settings)
        client.post(f'/api/projects/{pid}/discovery')
        wait_discovery(client, pid)

        # Mark a moment manually
        manual_data = {
            'start': 32.0,
            'end': 62.0,
            'title': 'User Reference: Language Models',
            'notes': 'Gold standard explanation marked by user'
        }
        create_res = client.post(f'/api/projects/{pid}/manual-clips', json=manual_data)
        assert create_res.status_code == 201
        created = create_res.json()
        assert created['title'] == 'User Reference: Language Models'
        assert created['duration'] == 30.0

        # Retrieve manual clips
        list_res = client.get(f'/api/projects/{pid}/manual-clips')
        assert list_res.status_code == 200
        manual_list = list_res.json()
        assert len(manual_list) == 1

        # Check feedback stats comparison with reference
        stats_res = client.get(f'/api/projects/{pid}/feedback/stats')
        assert stats_res.status_code == 200
        stats = stats_res.json()
        ref_comp = stats['reference_comparison']
        assert ref_comp['has_reference'] is True
        assert ref_comp['reference_count'] == 1
        assert ref_comp['matches_found'] == 1
        assert ref_comp['recall'] == 1.0
        assert ref_comp['f1_score'] > 0
        assert ref_comp['avg_boundary_error_seconds'] is not None

        # Delete manual clip
        del_res = client.delete(f'/api/projects/{pid}/manual-clips/{created["id"]}')
        assert del_res.status_code == 200
        assert client.get(f'/api/projects/{pid}/manual-clips').json() == []


def test_evaluation_metrics_distinguishes_heuristic_from_human():
    """Verify measurable evaluation separates human empirical metrics from model heuristic estimates."""
    feedback_list = [
        {'clip_id': 'c1', 'rating': 'good', 'action': 'accepted', 'original_start': 0, 'original_end': 30},
        {'clip_id': 'c2', 'rating': 'excellent', 'action': 'accepted', 'original_start': 32, 'original_end': 62,
         'adjusted_start': 33, 'adjusted_end': 61},
        {'clip_id': 'c3', 'rating': 'bad', 'action': 'rejected', 'original_start': 64, 'original_end': 94},
    ]
    clips = [
        {'id': 'c1', 'rank': 1, 'start': 0, 'end': 30, 'duration': 30, 'score': 85},
        {'id': 'c2', 'rank': 2, 'start': 32, 'end': 62, 'duration': 30, 'score': 90},
        {'id': 'c3', 'rank': 3, 'start': 64, 'end': 94, 'duration': 30, 'score': 70},
    ]

    metrics = EvaluationMetrics.calculate_metrics(feedback_list, clips, category='educational', duration=120.0)

    # Human evaluation
    h = metrics['human_evaluation']
    assert h['is_measured_human_metric'] is True
    assert h['top_3_acceptance_rate'] == pytest.approx(2 / 3, 0.01)
    assert h['precision_at_3'] == pytest.approx(2 / 3, 0.01)
    assert h['ratings_breakdown']['excellent'] == 1
    assert h['ratings_breakdown']['good'] == 1
    assert h['ratings_breakdown']['bad'] == 1

    # Heuristic estimates
    heur = metrics['heuristic_estimates']
    assert heur['is_measured_human_metric'] is False
    assert heur['metric_type'] == 'internal_heuristic_estimate'
    assert heur['candidate_timeline_coverage_ratio'] == 90.0 / 120.0
    assert 'disclaimer' in heur
