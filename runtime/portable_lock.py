"""OS-owned file locks: release on crash, never infer ownership from a PID file."""
import os
if os.name == 'nt':
    import msvcrt
else:
    import fcntl

def acquire(handle, blocking=False):
    if os.name != 'nt':
        return fcntl.flock(handle, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
    handle.seek(0)
    if not handle.read(1):
        handle.write('0')
        handle.flush()
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK, 1)
    except OSError as exc:
        raise BlockingIOError('Runtime already locked') from exc

def release(handle):
    if os.name != 'nt':
        return fcntl.flock(handle, fcntl.LOCK_UN)
    handle.seek(0)
    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
