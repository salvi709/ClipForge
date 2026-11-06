"""Delete only a UUID-named project tree; never trust a database path for rmtree."""
import os
import shutil
import stat
from pathlib import Path
from uuid import UUID


class DeletionError(Exception):
    pass


def _is_link(path):
    attrs = path.lstat()
    return stat.S_ISLNK(attrs.st_mode) or bool(getattr(attrs, 'st_file_attributes', 0) & 0x400)


def remove_project_files(settings, project, discovery):
    project_id = str(UUID(project['id']))
    root = settings.data_dir.resolve()
    parent = root / 'projects'
    target = parent / project_id
    # Refuse symlinks, junctions and other Windows reparse points at every level.
    for path in (parent, target):
        if os.path.lexists(path) and _is_link(path):
            raise DeletionError('Deletion refused: the project directory is a link or junction. No external files were removed.')
    if target.resolve() != target or target.parent.resolve() != parent or not target.is_relative_to(root):
        raise DeletionError('Deletion refused: project storage is outside the managed data directory.')
    for stored in (project.get('source_path'), project.get('transcript_path'), (discovery or {}).get('result_path')):
        if stored and not Path(stored).resolve().is_relative_to(target):
            raise DeletionError('Deletion refused: a recorded artifact is outside this project directory. Resolve the storage path before retrying.')
    if target.exists():
        for directory, dirs, files in os.walk(target, followlinks=False):
            for name in [*dirs, *files]:
                path = Path(directory) / name
                if _is_link(path) or not path.resolve().is_relative_to(target):
                    raise DeletionError('Deletion refused: a project artifact is a link or junction. No external files were removed.')
        shutil.rmtree(target)
    if os.path.lexists(target):
        raise OSError('Project directory remains after deletion')
