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
            db.execute('''CREATE TABLE IF NOT EXISTS clip_exports (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL,
                export_path TEXT NOT NULL, strategy TEXT, duration REAL,
                file_size INTEGER, created_at TEXT NOT NULL,
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

    def create(self, project_id, filename, source, size, language='auto', quality='fast'):
        with self.connect() as db:
            db.execute('INSERT INTO projects (id,filename,source_path,size,status,created_at,language,quality) VALUES (?,?,?,?,?,?,?,?)',
                       (project_id, filename, str(source), size, 'waiting', datetime.now(timezone.utc).isoformat(), language, quality))

    def get(self, project_id):
        with self.connect() as db:
            row = db.execute('SELECT * FROM projects WHERE id=?', (project_id,)).fetchone()
        return dict(row) if row else None

    def list(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute('SELECT * FROM projects ORDER BY created_at DESC')]

    def update(self, project_id, **values):
        allowed = {'status', 'metadata', 'transcript_path', 'error', 'warning', 'language', 'quality', 'processing', 
                   'content_profile', 'detected_category', 'user_category', 'category_confidence'}
        if not values or not values.keys() <= allowed:
            raise ValueError('Invalid project update')
        if isinstance(values.get('metadata'), dict):
            values['metadata'] = json.dumps(values['metadata'])
        if isinstance(values.get('processing'), dict):
            values['processing'] = json.dumps(values['processing'])
        if isinstance(values.get('content_profile'), dict):
            values['content_profile'] = json.dumps(values['content_profile'])
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
                     model_version=None, algorithm_version=None):
        """Save user feedback for a clip."""
        from datetime import datetime, timezone
        with self.connect() as db:
            db.execute('''INSERT OR REPLACE INTO clip_feedback
                (id, project_id, clip_id, rating, action, adjusted_start, adjusted_end,
                 user_notes, model_version, algorithm_version, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (feedback_id, project_id, clip_id, rating, action, adjusted_start, adjusted_end,
                 user_notes, model_version, algorithm_version, datetime.now(timezone.utc).isoformat()))

    def get_feedback(self, project_id):
        """Get all feedback for a project."""
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                'SELECT * FROM clip_feedback WHERE project_id=? ORDER BY created_at DESC',
                (project_id,))]

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
            db.execute('DELETE FROM clip_feedback WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM clip_exports WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM clip_edits WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM discoveries WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM projects WHERE id=?', (project_id,))


def public_project(row):
    return {key: (json.loads(value) if key in {'metadata', 'processing', 'content_profile'} and value else value)
            for key, value in row.items() if key not in {'source_path', 'transcript_path'}}
