import json
import math
import shutil
import subprocess
import time
from pathlib import Path


class ProcessingError(Exception):
    pass


class Cancelled(Exception):
    pass


def check_cancel(cancel):
    if cancel and cancel():
        raise Cancelled('Processing cancelled.')


def available(command: str) -> bool:
    return shutil.which(command) is not None


def probe(source: Path, command: str):
    if not available(command):
        raise ProcessingError('ffprobe is missing. Install FFmpeg and add its bin folder to PATH, then restart the backend.')
    try:
        result = subprocess.run([command, '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', str(source)],
                                capture_output=True, text=True, timeout=60, check=True)
        data = json.loads(result.stdout)
        video = next(s for s in data['streams'] if s['codec_type'] == 'video' and not s.get('disposition', {}).get('attached_pic'))
        duration = float(data['format'].get('duration', video.get('duration', 0)))
        if not math.isfinite(duration) or duration <= 0 or 'mp4' not in data['format']['format_name']:
            raise ValueError('Invalid MP4')
        if not any(s['codec_type'] == 'audio' for s in data['streams']):
            raise ProcessingError('This video has no audio track. Choose an MP4 containing speech.')
        return {'duration': duration, 'width': video['width'], 'height': video['height'], 'codec': video['codec_name']}
    except ProcessingError:
        raise
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, StopIteration):
        raise ProcessingError('The file is not a readable MP4 video, is corrupted, or took too long to inspect.') from None


def extract(source: Path, destination: Path, command: str, cancel=None):
    if not available(command):
        raise ProcessingError('FFmpeg is missing. Install FFmpeg and add its bin folder to PATH, then restart the backend.')
    try:
        check_cancel(cancel)
        with subprocess.Popen([command, '-nostdin', '-v', 'error', '-y', '-protocol_whitelist', 'file,pipe', '-i', str(source),
                        '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(destination)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
            started = time.monotonic()
            try:
                while process.poll() is None:
                    check_cancel(cancel)
                    if time.monotonic() - started > 7200:
                        raise ProcessingError('Audio extraction exceeded the two-hour limit.')
                    time.sleep(.1)
                if process.returncode:
                    raise ProcessingError('Audio extraction failed. Verify the video and free disk space.')
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
    except (OSError, subprocess.SubprocessError):
        raise ProcessingError('Audio extraction failed. Verify the video plays correctly and that sufficient disk space is available.') from None
