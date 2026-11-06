"""OS-released local lock prevents competing workers from resurrecting deleted data."""
import os
from contextlib import contextmanager


@contextmanager
def single_engine(data_dir):
    data_dir.mkdir(parents=True, exist_ok=True)
    handle = (data_dir / '.engine.lock').open('a+b')
    acquired = False
    try:
        if os.name == 'nt':
            import msvcrt
            if handle.tell() == 0:
                handle.write(b'0'); handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise RuntimeError('Another ClipForge backend owns this data directory. Stop it before restarting; use one worker.') from None
        else:
            import fcntl
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise RuntimeError('Another ClipForge backend owns this data directory. Stop it before restarting; use one worker.') from None
        acquired = True
        yield
    finally:
        if acquired:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)
        handle.close()
