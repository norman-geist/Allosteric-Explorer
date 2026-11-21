"""Bounded, thread-safe progress for synchronous analysis requests."""
from collections import OrderedDict
from contextvars import ContextVar
from threading import Lock
from time import monotonic

_job = ContextVar('explorer_progress_job', default=None)
_records = OrderedDict()
_lock = Lock()
_LIMIT = 100


def start(job):
    with _lock:
        _records[job] = dict(stage='Preparing analysis', completed=None, total=None, status='running', updated=monotonic())
        while len(_records) > _LIMIT:
            _records.popitem(last=False)
    return _job.set(job)


def report(stage, completed=None, total=None):
    job = _job.get()
    if job is None:
        return
    with _lock:
        if job in _records:
            _records[job].update(stage=stage, completed=completed, total=total, updated=monotonic())


def finish(token, failed=False):
    job = _job.get()
    with _lock:
        if job in _records:
            _records[job].update(status='failed' if failed else 'complete', updated=monotonic())
    _job.reset(token)


def read(job):
    with _lock:
        row = _records.get(job)
        if row is None or monotonic() - row['updated'] > 3600:
            return None
        return {key: value for key, value in row.items() if key != 'updated'}
