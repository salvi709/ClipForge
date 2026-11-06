import json
import logging
import time
from contextlib import contextmanager

logger = logging.getLogger('uvicorn.error')


def record(project_id, stage, seconds, **details):
    logger.info(json.dumps({'event': 'clipforge.performance', 'project_id': project_id,
                            'stage': stage, 'seconds': round(seconds, 4), **details}))


@contextmanager
def measure(timings, stage, project_id=None):
    started = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - started
        timings[stage] = round(timings.get(stage, 0) + elapsed, 4)
        record(project_id, stage, elapsed)
