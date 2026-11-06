"""Real FFmpeg checks; skipped if the tools have not been installed."""
import shutil
import subprocess
import wave

import pytest

from app.core.config import Settings
from app.services.media import ProcessingError, extract, probe


@pytest.fixture
def media_tools():
    settings = Settings()
    if not shutil.which(settings.ffmpeg) or not shutil.which(settings.ffprobe):
        pytest.skip('Install/configure FFmpeg and ffprobe for media integration tests')
    return settings


def test_real_probe_and_audio_extraction(tmp_path, media_tools):
    source = tmp_path / 'video.mp4'
    audio = tmp_path / 'audio.wav'
    subprocess.run([media_tools.ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=s=320x240:r=10',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1',
                    '-c:v', 'libx264', '-c:a', 'aac', str(source)], check=True, timeout=30)
    original = source.read_bytes()
    metadata = probe(source, media_tools.ffprobe)
    assert metadata['width'] == 320 and metadata['height'] == 240
    assert .9 <= metadata['duration'] <= 1.1
    extract(source, audio, media_tools.ffmpeg)
    with wave.open(str(audio)) as result:
        assert result.getframerate() == 16000
        assert result.getnchannels() == 1
        assert result.getsampwidth() == 2
    assert source.read_bytes() == original


def test_real_corrupt_and_silent_video_errors(tmp_path, media_tools):
    corrupt = tmp_path / 'corrupt.mp4'
    corrupt.write_bytes(b'not an MP4')
    with pytest.raises(ProcessingError, match='not a readable MP4'):
        probe(corrupt, media_tools.ffprobe)
    silent = tmp_path / 'silent.mp4'
    subprocess.run([media_tools.ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=s=160x120:r=10',
                    '-t', '1', '-c:v', 'libx264', str(silent)], check=True, timeout=30)
    with pytest.raises(ProcessingError, match='no audio track'):
        probe(silent, media_tools.ffprobe)
