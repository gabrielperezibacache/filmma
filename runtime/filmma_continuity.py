#!/usr/bin/env python3
"""Small launcher for Filmma's local, CPU-only Apple Vision comparison worker."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "filmma_continuity.swift"
CACHE = ROOT / "vendor" / "continuity"
CHILD = None


def binary_path():
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()[:20]
    return CACHE / ("filmma-continuity-" + digest)


def doctor():
    binary = binary_path()
    supported = platform.system() == "Darwin"
    return {"ready": supported and (binary.is_file() or shutil.which("xcrun") is not None),
            "engine": "apple-vision-cpu", "platform": platform.system(),
            "compiled": binary.is_file(), "binary": str(binary),
            "reason": None if supported else "El análisis local requiere macOS y Apple Vision."}


def stop(signum, _frame):
    if CHILD is not None and CHILD.poll() is None:
        CHILD.terminate()
        try:
            CHILD.wait(timeout=1)
        except subprocess.TimeoutExpired:
            CHILD.kill()
            CHILD.wait()
    raise SystemExit(128 + signum)


def ensure_binary():
    global CHILD
    if platform.system() != "Darwin":
        raise RuntimeError("El análisis local requiere macOS y Apple Vision.")
    binary = binary_path()
    CACHE.mkdir(parents=True, exist_ok=True)
    with (CACHE / "compile.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if binary.is_file():
            return binary
        temporary = binary.with_name(binary.name + ".building")
        command = ["xcrun", "swiftc", "-O", "-module-cache-path", str(CACHE / "module-cache"),
                   str(SOURCE), "-o", str(temporary)]
        CHILD = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            _, stderr = CHILD.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            CHILD.kill()
            CHILD.wait()
            raise RuntimeError("La preparación de Apple Vision superó 120 segundos.")
        if CHILD.returncode:
            raise RuntimeError("No se pudo preparar Apple Vision: " + stderr[-5000:])
        CHILD = None
        temporary.replace(binary)
    return binary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--doctor", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.doctor:
        print(json.dumps(doctor(), ensure_ascii=False))
        return
    if not args.input:
        parser.error("--input es obligatorio")
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        binary = ensure_binary()
        # Replacing the launcher means cancellation signals reach Vision directly.
        os.execv(str(binary), [str(binary), "--input", str(Path(args.input).resolve())])
    except Exception as error:
        print(json.dumps({"error": "CONTINUITY_UNAVAILABLE", "message": str(error)}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
