"""Resumable, hash-checked model transfers without changing the active model."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import urllib.request

import portable_lock

RESERVE = 20 * 1024 ** 3


def ranged_fetch(entry, partial, directory, stopped, report):
    """Bounded HTTPS ranges; a journal distinguishes completed data from holes."""
    journal = Path(str(partial) + '.ranges.json')
    if journal.exists():
        state = json.loads(journal.read_text())
        if state['size'] != entry['size'] or state['sha256'] != entry['sha256'] or not partial.exists():
            raise RuntimeError('Range journal mismatch; partial preserved')
    else:
        prefix = partial.stat().st_size if partial.exists() else 0
        if prefix > entry['size']:
            raise RuntimeError('Partial exceeds expected size; preserved')
        state = {'size': entry['size'], 'sha256': entry['sha256'], 'prefix': prefix,
                 'chunk': 128 * 1024 ** 2, 'complete': []}
        partial.touch(exist_ok=True)
        journal.write_text(json.dumps(state))
    prefix, chunk = state['prefix'], state['chunk']
    ranges = [(a, min(a + chunk, entry['size'])) for a in range(prefix, entry['size'], chunk)]
    completed = set(state['complete'])
    if prefix < 0 or prefix > entry['size'] or any(not isinstance(i, int) or i < 0 or i >= len(ranges) for i in completed):
        raise RuntimeError('Invalid range journal; partial preserved')
    counts = {i: ranges[i][1] - ranges[i][0] for i in completed}
    guard = threading.Lock()
    fd = os.open(str(partial), os.O_WRONLY)

    def part(index):
        start, end = ranges[index]
        if index in completed:
            return
        for attempt in range(3):
            try:
                headers = {'User-Agent': 'Filmma-model-manager/1.0', 'Range': 'bytes=%d-%d' % (start, end - 1)}
                with urllib.request.urlopen(urllib.request.Request(entry['url'], headers=headers), timeout=90) as response:
                    if response.status != 206 or not response.headers.get('Content-Range', '').startswith('bytes %d-%d/' % (start, end - 1)):
                        raise RuntimeError('Server did not honor exact range; partial preserved')
                    position = start
                    while position < end:
                        if stopped.is_set() or shutil.disk_usage(directory).free < RESERVE:
                            raise RuntimeError('Range transfer paused; partial preserved')
                        block = response.read(min(4 * 1024 ** 2, end - position))
                        if not block:
                            raise OSError('Incomplete HTTPS range')
                        written = 0
                        while written < len(block):
                            n = os.pwrite(fd, block[written:], position + written)
                            if n <= 0:
                                raise OSError('Could not write range')
                            written += n
                        position += len(block)
                        with guard:
                            counts[index] = position - start
                            count = prefix + sum(counts.values())
                        report(entry, count, 'download')
                # Commit only completed ranges. A crash can safely refetch an
                # uncommitted chunk even if its bytes were already written.
                with guard:
                    completed.add(index)
                    state['complete'] = sorted(completed)
                    temporary = Path(str(journal) + '.tmp')
                    temporary.write_text(json.dumps(state))
                    temporary.replace(journal)
                return
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            pending = [pool.submit(part, i) for i in range(len(ranges)) if i not in completed]
            try:
                for future in concurrent.futures.as_completed(pending):
                    future.result()
            except BaseException:
                stopped.set()
                for future in pending:
                    future.cancel()
                raise
        os.fsync(fd)
    finally:
        os.close(fd)
    if not file_matches(partial, entry):
        raise RuntimeError('Range download failed verification; partial preserved: ' + str(partial))
    return journal


def file_matches(path, entry):
    if not path.is_file() or path.stat().st_size != entry['size']:
        return False
    digest = hashlib.sha256() if entry.get('sha256') else hashlib.sha1()
    if not entry.get('sha256'):
        digest.update(('blob %d\0' % entry['size']).encode())
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 ** 2), b''):
            digest.update(block)
    return digest.hexdigest() == entry.get('sha256', entry.get('gitSha1'))


def transfer(manifest, directory, progress=print):
    """Only pinned public Hub URLs; never overwrite a failed or original file."""
    directory = Path(directory).resolve()
    if len(directory.parts) >= 3 and directory.parts[1] == 'Volumes' and not os.path.ismount(Path(*directory.parts[:3])):
        raise RuntimeError('Conecta el volumen externo antes de preparar el modelo; no se crea una carpeta sustituta.')
    directory.mkdir(parents=True, exist_ok=True)
    lock_path = directory / '.download.lock'
    with lock_path.open('a+') as lock:
        portable_lock.acquire(lock)
        entries = manifest['files']
        for entry in entries:
            target = directory / entry['path']
            if not target.resolve().is_relative_to(directory):
                raise ValueError('Model path escapes destination')
            if not entry['url'].startswith('https://huggingface.co/') or '/resolve/' not in entry['url']:
                raise ValueError('Model source must be a pinned Hugging Face URL')
            if not entry.get('sha256', entry.get('gitSha1')):
                raise ValueError('Every model file requires a digest')
        remaining = sum(max(0, x['size'] - min(x['size'], (directory / (x['path'] + '.part')).stat().st_size
                    if (directory / (x['path'] + '.part')).exists() else 0))
                    for x in entries if not (directory / x['path']).exists())
        if shutil.disk_usage(directory).free < remaining + RESERVE:
            raise RuntimeError('Insufficient space including the 20 GiB reserve')
        state_lock = threading.Lock()
        stopped = threading.Event()
        counts = {}
        last_report = [0.0]
        total = sum(x['size'] for x in entries)

        def report(entry, count, stage):
            with state_lock:
                counts[entry['path']] = count
                now = time.monotonic()
                if now - last_report[0] > 5 or stage == 'verified':
                    progress(json.dumps({'stage': stage, 'file': entry['path'],
                        'downloadedBytes': sum(counts.values()), 'totalBytes': total}, ensure_ascii=False))
                    last_report[0] = now

        def fetch(entry):
            target = directory / entry['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if not file_matches(target, entry):
                    raise RuntimeError('Existing file failed verification; preserved: ' + str(target))
                report(entry, entry['size'], 'verified')
                return
            partial = Path(str(target) + '.part')
            legacy_ranges = Path(str(partial) + '.aria2')
            if legacy_ranges.exists():
                # Never interpret an aria2 sparse file as a contiguous prefix.
                accelerator = shutil.which('aria2c')
                if not accelerator:
                    raise RuntimeError('This partial needs aria2 to resume its range journal; preserved')
                with Path(str(partial) + '.transfer.log').open('a') as log:
                    child = subprocess.Popen([accelerator, '--continue=true', '--file-allocation=none',
                        '--max-connection-per-server=4', '--split=4', '--min-split-size=64M',
                        '--auto-file-renaming=false', '--allow-overwrite=false', '--max-tries=3',
                        '--retry-wait=2', '--enable-color=false', '--console-log-level=warn',
                        '--summary-interval=0', '--download-result=hide',
                        '--dir=' + str(partial.parent), '--out=' + partial.name, entry['url']], stdout=log, stderr=subprocess.STDOUT)
                    try:
                        while child.poll() is None:
                            if stopped.wait(1) or shutil.disk_usage(directory).free < RESERVE:
                                raise RuntimeError('Transfer paused; sparse partial preserved')
                        if child.returncode:
                            raise RuntimeError('Sparse partial needs resume; see transfer log')
                    finally:
                        if child.poll() is None:
                            child.terminate()
                            try: child.wait(timeout=5)
                            except subprocess.TimeoutExpired:
                                child.kill(); child.wait()
                if not file_matches(partial, entry):
                    raise RuntimeError('Sparse download failed verification; preserved')
                os.link(str(partial), str(target))
                partial.unlink()
                report(entry, entry['size'], 'verified')
                return
            if entry['size'] > 1024 ** 3 and hasattr(os, 'pwrite'):
                journal = ranged_fetch(entry, partial, directory, stopped, report)
                os.link(str(partial), str(target))
                partial.unlink()
                journal.unlink()
                report(entry, entry['size'], 'verified')
                return
            for attempt in range(3):
                try:
                    offset = partial.stat().st_size if partial.exists() else 0
                    if offset > entry['size']:
                        raise RuntimeError('Partial file exceeds expected size; preserved: ' + str(partial))
                    if offset < entry['size']:
                        headers = {'User-Agent': 'Filmma-model-manager/1.0'}
                        if offset:
                            headers['Range'] = 'bytes=%d-' % offset
                        with urllib.request.urlopen(urllib.request.Request(entry['url'], headers=headers), timeout=90) as response:
                            if offset and (response.status != 206 or not response.headers.get('Content-Range', '').startswith('bytes %d-' % offset)):
                                raise RuntimeError('Server did not honor resume; partial preserved')
                            with partial.open('ab' if offset else 'wb') as stream:
                                while True:
                                    if stopped.is_set():
                                        raise RuntimeError('Transfer paused after another file failed')
                                    block = response.read(4 * 1024 ** 2)
                                    if not block:
                                        break
                                    if shutil.disk_usage(directory).free - len(block) < RESERVE:
                                        raise RuntimeError('20 GiB disk reserve reached; partial preserved')
                                    stream.write(block)
                                    offset += len(block)
                                    if offset > entry['size']:
                                        raise RuntimeError('Unexpected response size; partial preserved')
                                    report(entry, offset, 'download')
                    if not file_matches(partial, entry):
                        raise RuntimeError('Downloaded file failed verification; partial preserved: ' + str(partial))
                    # Exclusive creation avoids replacing any independently created original.
                    os.link(str(partial), str(target))
                    partial.unlink()
                    report(entry, entry['size'], 'verified')
                    return
                except OSError:
                    if attempt == 2:
                        raise
                    time.sleep(attempt + 1)

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            pending = [pool.submit(fetch, entry) for entry in entries]
            try:
                for future in concurrent.futures.as_completed(pending):
                    future.result()
            except BaseException:
                stopped.set()
                for future in pending:
                    future.cancel()
                raise
        receipt = {**manifest, 'verifiedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        temp = directory / '.verified-model.tmp'
        temp.write_text(json.dumps(receipt, indent=2) + '\n')
        temp.replace(directory / 'verified-model.json')
        return receipt


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest')
    parser.add_argument('directory')
    args = parser.parse_args()
    transfer(json.loads(Path(args.manifest).read_text()), args.directory, lambda x: print(x, flush=True))
