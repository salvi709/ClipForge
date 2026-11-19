import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


class Store:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / 'clipforge.sqlite3'
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, filename TEXT NOT NULL, source_path TEXT NOT NULL,
                size INTEGER NOT NULL, metadata TEXT, status TEXT NOT NULL,
                created_at TEXT NOT NULL, transcript_path TEXT, error TEXT, warning TEXT)''')
            # Additive V0.2 migration keeps existing project IDs and transcript files.
            columns = {row['name'] for row in db.execute('PRAGMA table_info(projects)')}
            for name, default in [('language', 'auto'), ('quality', 'fast')]:
                if name not in columns:
                    db.execute(f"ALTER TABLE projects ADD COLUMN {name} TEXT NOT NULL DEFAULT '{default}'")
            # V0.3 content profiling columns
            for name in ('content_profile', 'detected_category', 'user_category', 'category_confidence'):
                if name not in columns:
                    default_sql = "'generic'" if name == 'detected_category' else 'NULL'
                    db.execute(f"ALTER TABLE projects ADD COLUMN {name} TEXT DEFAULT {default_sql}")
            if 'processing' not in columns:
                db.execute('ALTER TABLE projects ADD COLUMN processing TEXT')
            
            # V0.5 YouTube Link Intelligence columns
            youtube_columns = {
                'source_type': 'local',  # 'local' | 'youtube'
                'youtube_video_id': None,
                'youtube_url': None,
                'youtube_metadata': None,
                'transcript_source': None,  # 'whisper' | 'youtube_captions' | 'user_provided'
                'analysis_mode': 'multimodal'  # 'multimodal' | 'transcript_only'
            }
            for col_name, default_value in youtube_columns.items():
                if col_name not in columns:
                    if default_value is None:
                        db.execute(f'ALTER TABLE projects ADD COLUMN {col_name} TEXT')
                    else:
                        db.execute(f"ALTER TABLE projects ADD COLUMN {col_name} TEXT DEFAULT '{default_value}'")
            db.execute('''CREATE TABLE IF NOT EXISTS discoveries (
                project_id TEXT PRIMARY KEY, status TEXT NOT NULL, error TEXT,
                result_path TEXT, fingerprint TEXT, updated_at TEXT NOT NULL,
                evaluated INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0)''')
            db.execute('''CREATE TABLE IF NOT EXISTS clip_edits (
                project_id TEXT NOT NULL, clip_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL,
                PRIMARY KEY (project_id, clip_id))''')
            # V0.4 feedback and export tracking
            db.execute('''CREATE TABLE IF NOT EXISTS clip_feedback (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL,
                rating TEXT, action TEXT, adjusted_start REAL, adjusted_end REAL,
                user_notes TEXT, model_version TEXT, algorithm_version TEXT,
                created_at TEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id))''')
            feedback_cols = {row['name'] for row in db.execute('PRAGMA table_info(clip_feedback)')}
            for name, col_type in [('original_start', 'REAL'), ('original_end', 'REAL'), ('scoring_factors', 'TEXT')]:
                if name not in feedback_cols:
                    db.execute(f'ALTER TABLE clip_feedback ADD COLUMN {name} {col_type}')

            db.execute('''CREATE TABLE IF NOT EXISTS manual_clips (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                start REAL NOT NULL, end REAL NOT NULL, duration REAL NOT NULL,
                notes TEXT, created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id))''')

            db.execute('''CREATE TABLE IF NOT EXISTS clip_exports (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL,
                export_path TEXT NOT NULL, strategy TEXT, duration REAL,
                file_size INTEGER, created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id))''')
            
            # Clip enhancements table for Smart Enhancement Assistant
            db.execute('''CREATE TABLE IF NOT EXISTS clip_enhancements (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL, enhancement_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id))''')
            
            # Speaker Intelligence tables
            db.execute('''CREATE TABLE IF NOT EXISTS speaker_analysis (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL, analysis_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id))''')
            
            db.execute('''CREATE TABLE IF NOT EXISTS speaker_labels (
                project_id TEXT NOT NULL, speaker_id TEXT NOT NULL,
                user_label TEXT NOT NULL,
                PRIMARY KEY (project_id, speaker_id),
                FOREIGN KEY (project_id) REFERENCES projects(id))''')
            
            db.execute('''CREATE TABLE IF NOT EXISTS reframing_recommendations (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL,
                recommendation_json TEXT NOT NULL, created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id))''')
            
            if 'result_json' not in {row['name'] for row in db.execute('PRAGMA table_info(discoveries)')}:
                db.execute('ALTER TABLE discoveries ADD COLUMN result_json TEXT')
            columns = {row['name'] for row in db.execute('PRAGMA table_info(discoveries)')}
            for name in ('settings_json', 'progress_json'):
                if name not in columns:
                    db.execute(f'ALTER TABLE discoveries ADD COLUMN {name} TEXT')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(self, project_id, filename, source, size, language='auto', quality='fast', source_type='local'):
        with self.connect() as db:
            db.execute('INSERT INTO projects (id,filename,source_path,size,status,created_at,language,quality,source_type,analysis_mode) VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (project_id, filename, str(source), size, 'waiting', datetime.now(timezone.utc).isoformat(), language, quality, source_type, 'multimodal' if source_type == 'local' else 'transcript_only'))

    def get(self, project_id):
        with self.connect() as db:
            row = db.execute('SELECT * FROM projects WHERE id=?', (project_id,)).fetchone()
        return dict(row) if row else None

    def list(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute('SELECT * FROM projects ORDER BY created_at DESC')]

    def update(self, project_id, **values):
        allowed = {'status', 'metadata', 'transcript_path', 'error', 'warning', 'language', 'quality', 'processing', 
                   'content_profile', 'detected_category', 'user_category', 'category_confidence',
                   'source_type', 'youtube_video_id', 'youtube_url', 'youtube_metadata', 'transcript_source', 'analysis_mode'}
        if not values or not values.keys() <= allowed:
            raise ValueError('Invalid project update')
        if isinstance(values.get('metadata'), dict):
            values['metadata'] = json.dumps(values['metadata'])
        if isinstance(values.get('processing'), dict):
            values['processing'] = json.dumps(values['processing'])
        if isinstance(values.get('content_profile'), dict):
            values['content_profile'] = json.dumps(values['content_profile'])
        if isinstance(values.get('youtube_metadata'), dict):
            values['youtube_metadata'] = json.dumps(values['youtube_metadata'])
        with self.connect() as db:
            db.execute(f"UPDATE projects SET {','.join(f'{key}=?' for key in values)} WHERE id=?",
                       (*values.values(), project_id))

    def recover(self):
        with self.connect() as db:
            db.execute("UPDATE projects SET status='deletion_failed', error='Deletion was interrupted. Retry Delete Project to remove remaining data.' WHERE status='deleting'")
            db.execute("UPDATE projects SET status='failed', error='Processing was interrupted. Retry this project.' WHERE status IN ('waiting','preparing','queued','extracting','loading_model','transcribing','saving')")
            db.execute("UPDATE discoveries SET status='failed', error='Clip discovery was interrupted. Find Best Clips again to retry.' WHERE status NOT IN ('completed','failed','cancelled')")

    def discovery(self, project_id):
        with self.connect() as db:
            row = db.execute('SELECT * FROM discoveries WHERE project_id=?', (project_id,)).fetchone()
        return dict(row) if row else None

    def update_discovery(self, project_id, **values):
        allowed = {'status', 'error', 'result_path', 'result_json', 'fingerprint', 'evaluated', 'total', 'settings_json', 'progress_json'}
        if not values or not values.keys() <= allowed:
            raise ValueError('Invalid discovery update')
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            if not db.execute('SELECT 1 FROM projects WHERE id=?', (project_id,)).fetchone():
                raise KeyError('Project not found')
            db.execute("INSERT OR IGNORE INTO discoveries (project_id,status,updated_at) VALUES (?,'preparing_transcript',?)", (project_id, now))
            db.execute(f"UPDATE discoveries SET {','.join(f'{key}=?' for key in values)},updated_at=? WHERE project_id=?", (*values.values(), now, project_id))

    def complete_discovery(self, project_id, result, target, progress):
        # Commit new results and reset old edits together; a failed/cancelled attempt
        # never destroys the previously completed SQLite result.
        with self.connect() as db:
            if not db.execute('SELECT 1 FROM projects WHERE id=?', (project_id,)).fetchone():
                raise KeyError('Project not found')
            db.execute('DELETE FROM clip_edits WHERE project_id=?', (project_id,))
            db.execute("""UPDATE discoveries SET status='completed', error=NULL, result_json=?,
                result_path=?, fingerprint=?, progress_json=?, updated_at=? WHERE project_id=?""",
                (json.dumps(result, ensure_ascii=False), str(target), result['fingerprint'], json.dumps(progress),
                 datetime.now(timezone.utc).isoformat(), project_id))

    def invalidate_discovery(self, project_id):
        with self.connect() as db:
            db.execute('DELETE FROM discoveries WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM clip_edits WHERE project_id=?', (project_id,))

    def edits(self, project_id):
        with self.connect() as db:
            return {row['clip_id']: dict(row) for row in db.execute('SELECT * FROM clip_edits WHERE project_id=?', (project_id,))}

    def save_edit(self, project_id, clip_id, start, end):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO clip_edits (project_id,clip_id,start,end) VALUES (?,?,?,?)', (project_id, clip_id, start, end))

    def clear_edits(self, project_id):
        with self.connect() as db:
            db.execute('DELETE FROM clip_edits WHERE project_id=?', (project_id,))

    def save_feedback(self, feedback_id, project_id, clip_id, rating=None, action=None,
                     adjusted_start=None, adjusted_end=None, user_notes=None,
                     model_version=None, algorithm_version=None,
                     original_start=None, original_end=None, scoring_factors=None):
        """Save user feedback for a clip."""
        from datetime import datetime, timezone
        factors_str = json.dumps(scoring_factors) if isinstance(scoring_factors, dict) else scoring_factors
        with self.connect() as db:
            db.execute('''INSERT OR REPLACE INTO clip_feedback
                (id, project_id, clip_id, rating, action, adjusted_start, adjusted_end,
                 user_notes, model_version, algorithm_version, created_at,
                 original_start, original_end, scoring_factors)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (feedback_id, project_id, clip_id, rating, action, adjusted_start, adjusted_end,
                 user_notes, model_version, algorithm_version, datetime.now(timezone.utc).isoformat(),
                 original_start, original_end, factors_str))

    def get_feedback(self, project_id):
        """Get all feedback for a project."""
        with self.connect() as db:
            records = []
            for row in db.execute('SELECT * FROM clip_feedback WHERE project_id=? ORDER BY created_at DESC', (project_id,)):
                item = dict(row)
                if item.get('scoring_factors') and isinstance(item['scoring_factors'], str):
                    try:
                        item['scoring_factors'] = json.loads(item['scoring_factors'])
                    except Exception:
                        pass
                records.append(item)
            return records

    def save_manual_clip(self, clip_id, project_id, title, start, end, notes=None):
        """Save manually marked reference/discovered clip."""
        from datetime import datetime, timezone
        duration = round(end - start, 3)
        with self.connect() as db:
            db.execute('''INSERT OR REPLACE INTO manual_clips
                (id, project_id, title, start, end, duration, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                (clip_id, project_id, title, start, end, duration, notes,
                 datetime.now(timezone.utc).isoformat()))
            return {'id': clip_id, 'project_id': project_id, 'title': title,
                    'start': start, 'end': end, 'duration': duration, 'notes': notes}

    def get_manual_clips(self, project_id):
        """Get all manually marked clips for a project."""
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                'SELECT * FROM manual_clips WHERE project_id=? ORDER BY start ASC',
                (project_id,))]

    def delete_manual_clip(self, project_id, clip_id):
        """Delete a manually marked clip."""
        with self.connect() as db:
            db.execute('DELETE FROM manual_clips WHERE project_id=? AND id=?', (project_id, clip_id))

    def save_export(self, export_id, project_id, clip_id, export_path, strategy, duration, file_size):
        """Save export record."""
        from datetime import datetime, timezone
        with self.connect() as db:
            db.execute('''INSERT INTO clip_exports
                (id, project_id, clip_id, export_path, strategy, duration, file_size, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                (export_id, project_id, clip_id, export_path, strategy, duration, file_size,
                 datetime.now(timezone.utc).isoformat()))

    def get_exports(self, project_id):
        """Get all exports for a project."""
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                'SELECT * FROM clip_exports WHERE project_id=? ORDER BY created_at DESC',
                (project_id,))]

    def delete(self, project_id):
        """Called only after the owned directory has been verified absent."""
        with self.connect() as db:
            db.execute('DELETE FROM reframing_recommendations WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM speaker_labels WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM speaker_analysis WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM clip_enhancements WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM manual_clips WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM clip_feedback WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM clip_exports WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM clip_edits WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM discoveries WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM projects WHERE id=?', (project_id,))


def public_project(row):
    return {key: (json.loads(value) if key in {'metadata', 'processing', 'content_profile', 'youtube_metadata'} and value else value)
            for key, value in row.items() if key not in {'source_path', 'transcript_path'}}

    
    def save_enhancement(self, enhancement_id, project_id, clip_id, fingerprint, enhancement_data):
        """Save clip enhancement recommendations."""
        with self.connect() as db:
            db.execute(
                'INSERT OR REPLACE INTO clip_enhancements (id, project_id, clip_id, fingerprint, enhancement_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                (enhancement_id, project_id, clip_id, fingerprint, json.dumps(enhancement_data), datetime.now(timezone.utc).isoformat())
            )
    
    def get_enhancement(self, project_id, clip_id):
        """Get cached enhancement for a clip."""
        with self.connect() as db:
            row = db.execute(
                'SELECT * FROM clip_enhancements WHERE project_id=? AND clip_id=? ORDER BY created_at DESC LIMIT 1',
                (project_id, clip_id)
            ).fetchone()
        if row:
            result = dict(row)
            result['enhancement_json'] = json.loads(result['enhancement_json'])
            return result
        return None
    
    def delete_enhancement(self, project_id, clip_id):
        """Delete enhancement cache for a clip."""
        with self.connect() as db:
            db.execute('DELETE FROM clip_enhancements WHERE project_id=? AND clip_id=?', (project_id, clip_id))

    # Speaker Intelligence methods
    def save_speaker_analysis(self, analysis_id, project_id, fingerprint, analysis_data):
        """Save speaker diarization analysis."""
        with self.connect() as db:
            db.execute(
                'INSERT OR REPLACE INTO speaker_analysis (id, project_id, fingerprint, analysis_json, created_at) VALUES (?, ?, ?, ?, ?)',
                (analysis_id, project_id, fingerprint, json.dumps(analysis_data), datetime.now(timezone.utc).isoformat())
            )
    
    def get_speaker_analysis(self, project_id):
        """Get cached speaker analysis for a project."""
        with self.connect() as db:
            row = db.execute(
                'SELECT * FROM speaker_analysis WHERE project_id=? ORDER BY created_at DESC LIMIT 1',
                (project_id,)
            ).fetchone()
        if row:
            result = dict(row)
            result['analysis_json'] = json.loads(result['analysis_json'])
            return result
        return None
    
    def delete_speaker_analysis(self, project_id):
        """Delete speaker analysis for a project."""
        with self.connect() as db:
            db.execute('DELETE FROM speaker_analysis WHERE project_id=?', (project_id,))
    
    def save_speaker_label(self, project_id, speaker_id, user_label):
        """Save user-assigned label for a speaker."""
        with self.connect() as db:
            db.execute(
                'INSERT OR REPLACE INTO speaker_labels (project_id, speaker_id, user_label) VALUES (?, ?, ?)',
                (project_id, speaker_id, user_label)
            )
    
    def get_speaker_labels(self, project_id):
        """Get all speaker labels for a project."""
        with self.connect() as db:
            rows = db.execute(
                'SELECT * FROM speaker_labels WHERE project_id=?',
                (project_id,)
            ).fetchall()
        return {row['speaker_id']: row['user_label'] for row in rows}
    
    def delete_speaker_label(self, project_id, speaker_id):
        """Delete a speaker label."""
        with self.connect() as db:
            db.execute('DELETE FROM speaker_labels WHERE project_id=? AND speaker_id=?', (project_id, speaker_id))
    
    def save_reframing_recommendation(self, recommendation_id, project_id, clip_id, recommendation_data):
        """Save reframing recommendation for a clip."""
        with self.connect() as db:
            db.execute(
                'INSERT OR REPLACE INTO reframing_recommendations (id, project_id, clip_id, recommendation_json, created_at) VALUES (?, ?, ?, ?, ?)',
                (recommendation_id, project_id, clip_id, json.dumps(recommendation_data), datetime.now(timezone.utc).isoformat())
            )
    
    def get_reframing_recommendation(self, project_id, clip_id):
        """Get reframing recommendation for a clip."""
        with self.connect() as db:
            row = db.execute(
                'SELECT * FROM reframing_recommendations WHERE project_id=? AND clip_id=? ORDER BY created_at DESC LIMIT 1',
                (project_id, clip_id)
            ).fetchone()
        if row:
            result = dict(row)
            result['recommendation_json'] = json.loads(result['recommendation_json'])
            return result
        return None
    
    def delete_reframing_recommendation(self, project_id, clip_id):
        """Delete reframing recommendation for a clip."""
        with self.connect() as db:
            db.execute('DELETE FROM reframing_recommendations WHERE project_id=? AND clip_id=?', (project_id, clip_id))
