import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { ControlsPanel } from './components/ControlsPanel';
import { VideoStage } from './components/VideoStage';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useMotionDetection } from './hooks/useMotionDetection';

const STORAGE_KEY = 'line-sound-lines-v1';
const COLORS = ['#f900ff', '#2dd4bf', '#f97316', '#60a5fa', '#f43f5e', '#facc15'];

function createLine(index = 0) {
  return {
    id: crypto.randomUUID(),
    name: `Line ${index + 1}`,
    color: COLORS[index % COLORS.length],
    enabled: true,
    thickness: 8,
    noteOffset: 0,
    sensitivity: 1,
    gain: 0.7,
    p1: { x: 0.3, y: 0.2 },
    p2: { x: 0.7, y: 0.8 },
  };
}

function getInitialLines() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createLine(0)];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return [createLine(0)];
    return parsed;
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
      setLines(parsed);
      setSelectedLineId(parsed[0].id);
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
            }}
            onPlaybackState={setIsPlaying}
          />
        </section>
      </main>
    </div>
  );
}
