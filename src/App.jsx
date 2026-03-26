import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { ControlsPanel } from './components/ControlsPanel';
import { VideoStage } from './components/VideoStage';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useMotionDetection } from './hooks/useMotionDetection';

const STORAGE_KEY = 'line-sound-lines-v1';
const COLORS = ['#f900ff', '#2dd4bf', '#f97316', '#60a5fa', '#f43f5e', '#facc15'];

const defaultLineValues = {
  enabled: true,
  thickness: 8,
  noteOffset: 0,
  sensitivity: 1,
  pitchSpread: 1,
  gain: 0.7,
  p1: { x: 0.3, y: 0.2 },
  p2: { x: 0.7, y: 0.8 },
};

function sanitizeLine(line, index = 0) {
  return {
    id: line.id ?? crypto.randomUUID(),
    name: line.name ?? `Line ${index + 1}`,
    color: line.color ?? COLORS[index % COLORS.length],
    enabled: typeof line.enabled === 'boolean' ? line.enabled : defaultLineValues.enabled,
    thickness: Number.isFinite(line.thickness) ? line.thickness : defaultLineValues.thickness,
    noteOffset: Number.isFinite(line.noteOffset) ? line.noteOffset : defaultLineValues.noteOffset,
    sensitivity: Number.isFinite(line.sensitivity) ? line.sensitivity : defaultLineValues.sensitivity,
    pitchSpread: Number.isFinite(line.pitchSpread) ? line.pitchSpread : defaultLineValues.pitchSpread,
    gain: Number.isFinite(line.gain) ? line.gain : defaultLineValues.gain,
    p1: line.p1 ?? defaultLineValues.p1,
    p2: line.p2 ?? defaultLineValues.p2,
  };
}

function createLine(index = 0) {
  return {
    id: crypto.randomUUID(),
    name: `Line ${index + 1}`,
    color: COLORS[index % COLORS.length],
    ...defaultLineValues,
  };
}

function getInitialLines() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createLine(0)];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return [createLine(0)];
    return parsed.map((line, index) => sanitizeLine(line, index));
  } catch {
    return [createLine(0)];
  }
}

export default function App() {
  const videoRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [lines, setLines] = useState(getInitialLines);
  const [selectedLineId, setSelectedLineId] = useState(lines[0]?.id ?? null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoMuted, setVideoMuted] = useState(false);

  const audio = useAudioEngine();

  const { debugState, intersections } = useMotionDetection({
    videoRef,
    dimensions: videoSize,
    isPlaying,
    lines,
    debugEnabled: showDebug,
  });

  const linesById = useMemo(
    () => new Map(lines.map((line) => [line.id, line])),
    [lines],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  useEffect(() => {
    const activeIds = new Set(intersections.map((item) => item.id));

    intersections.forEach((intersection) => {
      const line = linesById.get(intersection.lineId);
      if (!line || !line.enabled) return;
      audio.noteOn(intersection.id, intersection.speed, line);
    });

    audioStateRef.current.forEach((_, voiceId) => {
      if (!activeIds.has(voiceId)) {
        audio.noteOff(voiceId);
        audioStateRef.current.delete(voiceId);
      }
    });

    intersections.forEach((intersection) => {
      audioStateRef.current.set(intersection.id, true);
    });
  }, [audio, intersections, linesById]);

  const audioStateRef = useRef(new Map());

  const onUpdateLine = (id, patch) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const onAddLine = () => {
    setLines((current) => {
      const next = [...current, createLine(current.length)];
      setSelectedLineId(next[next.length - 1].id);
      return next;
    });
  };

  const onDuplicateLine = (id) => {
    setLines((current) => {
      const line = current.find((item) => item.id === id);
      if (!line) return current;
      const duplicate = { ...line, id: crypto.randomUUID(), name: `${line.name} Copy` };
      const next = [...current, duplicate];
      setSelectedLineId(duplicate.id);
      return next;
    });
  };

  const onDeleteLine = (id) => {
    setLines((current) => {
      const next = current.filter((line) => line.id !== id);
      setSelectedLineId(next[0]?.id ?? null);
      return next.length ? next : [createLine(0)];
    });
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(lines, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'line-sound-lines.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length) {
      const next = parsed.map((line, index) => sanitizeLine(line, index));
      setLines(next);
      setSelectedLineId(next[0].id);
    }
    event.target.value = '';
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await audio.ensureContext();
    audio.stopAll();
    const url = URL.createObjectURL(file);
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(url);
    setCurrentTime(0);
    setDuration(0);
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    await audio.ensureContext();
    if (video.paused) {
      await video.play();
    } else {
      video.pause();
    }
  };

  const onScrub = (value) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    setCurrentTime(value);
  };

  return (
    <div className="app-shell">
      <header>
        <h1>Line Sound</h1>
        <p>Upload a video, draw expressive lines, and let motion perform harmonies.</p>
      </header>

      <main>
        <ControlsPanel
          lines={lines}
          selectedLineId={selectedLineId}
          onSelectLine={setSelectedLineId}
          onAddLine={onAddLine}
          onDeleteLine={onDeleteLine}
          onDuplicateLine={onDuplicateLine}
          onUpdateLine={onUpdateLine}
          showDebug={showDebug}
          onToggleDebug={setShowDebug}
          onExport={onExport}
          onImport={onImport}
        />

        <section className="stage-wrap">
          <label className="upload-row">
            <span>Upload video</span>
            <input type="file" accept="video/*" onChange={handleUpload} />
          </label>

          <VideoStage
            videoRef={videoRef}
            sourceUrl={sourceUrl}
            videoSize={videoSize}
            lines={lines}
            selectedLineId={selectedLineId}
            onSelectLine={setSelectedLineId}
            onUpdateLine={onUpdateLine}
            debugState={debugState}
            showDebug={showDebug}
            onLoadedMetadata={() => {
              const video = videoRef.current;
              if (!video) return;
              setVideoSize({ width: video.videoWidth, height: video.videoHeight });
              setDuration(video.duration || 0);
            }}
            onPlaybackState={setIsPlaying}
            onTimeUpdate={() => {
              const video = videoRef.current;
              if (!video) return;
              setCurrentTime(video.currentTime);
            }}
            onDurationChange={() => {
              const video = videoRef.current;
              if (!video) return;
              setDuration(video.duration || 0);
            }}
            muted={videoMuted}
          />
          {sourceUrl && (
            <div className="playback-controls">
              <button onClick={togglePlayback}>{isPlaying ? 'Pause' : 'Play'}</button>
              <input
                type="range"
                min="0"
                max={Math.max(duration, 0.001)}
                step="0.01"
                value={Math.min(currentTime, duration || 0)}
                onChange={(e) => onScrub(Number(e.target.value))}
              />
              <span>
                {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
              </span>
              <label className="mute-toggle">
                <input
                  type="checkbox"
                  checked={videoMuted}
                  onChange={(e) => setVideoMuted(e.target.checked)}
                />
                Mute original video
              </label>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
