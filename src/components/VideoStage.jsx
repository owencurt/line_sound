import { useEffect, useMemo, useRef, useState } from 'react';
import {
  distance,
  lineNormal,
  midpoint,
  rotatePointAround,
  toNormalized,
  toPixels,
} from '../lib/geometry';

const HANDLE_RADIUS = 8;

function hitTest(line, pt, width, height) {
  const p1 = toPixels(line.p1, width, height);
  const p2 = toPixels(line.p2, width, height);
  const mid = midpoint(p1, p2);
  const normal = lineNormal({ p1, p2 });
  const rotate = { x: mid.x + normal.x * 32, y: mid.y + normal.y * 32 };

  if (distance(pt, p1) <= HANDLE_RADIUS + 4) return { mode: 'resize-start' };
  if (distance(pt, p2) <= HANDLE_RADIUS + 4) return { mode: 'resize-end' };
  if (distance(pt, rotate) <= HANDLE_RADIUS + 5) return { mode: 'rotate' };

  const lineDist = Math.abs((p2.y - p1.y) * pt.x - (p2.x - p1.x) * pt.y + p2.x * p1.y - p2.y * p1.x) /
    (Math.hypot(p2.y - p1.y, p2.x - p1.x) || 1);

  if (lineDist <= line.thickness + 8) return { mode: 'move' };
  return null;
}

export function VideoStage({
  videoRef,
  sourceUrl,
  videoSize,
  lines,
  selectedLineId,
  onSelectLine,
  onUpdateLine,
  debugState,
  showDebug,
  onLoadedMetadata,
  onPlaybackState,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [displayRect, setDisplayRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const interactionRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !videoSize.width || !videoSize.height) return;

    const observer = new ResizeObserver(() => {
      const rect = containerRef.current.getBoundingClientRect();
      const arVideo = videoSize.width / videoSize.height;
      const arBox = rect.width / rect.height;

      let width = rect.width;
      let height = rect.height;
      if (arBox > arVideo) {
        width = rect.height * arVideo;
      } else {
        height = rect.width / arVideo;
      }

      setDisplayRect({
        left: (rect.width - width) / 2,
        top: (rect.height - height) / 2,
        width,
        height,
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [videoSize.height, videoSize.width]);

  const selectedLine = useMemo(
    () => lines.find((line) => line.id === selectedLineId),
    [lines, selectedLineId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !displayRect.width || !displayRect.height) return;

    canvas.width = Math.round(displayRect.width);
    canvas.height = Math.round(displayRect.height);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showDebug) {
      debugState.blobs.forEach((blob) => {
        const x = (blob.bbox.minX / videoSize.width) * canvas.width;
        const y = (blob.bbox.minY / videoSize.height) * canvas.height;
        const w = ((blob.bbox.maxX - blob.bbox.minX) / videoSize.width) * canvas.width;
        const h = ((blob.bbox.maxY - blob.bbox.minY) / videoSize.height) * canvas.height;
        ctx.strokeStyle = 'rgba(118, 248, 255, 0.8)';
        ctx.strokeRect(x, y, w, h);
        ctx.beginPath();
        ctx.arc((blob.centroid.x / videoSize.width) * canvas.width, (blob.centroid.y / videoSize.height) * canvas.height, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#76f8ff';
        ctx.fill();
      });
    }

    lines.forEach((line) => {
      const p1 = toPixels(line.p1, canvas.width, canvas.height);
      const p2 = toPixels(line.p2, canvas.width, canvas.height);
      ctx.strokeStyle = line.enabled ? line.color : '#6b7280';
      ctx.lineWidth = line.thickness * 2;
      ctx.lineCap = 'round';
      ctx.globalAlpha = line.enabled ? 0.95 : 0.45;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (line.id === selectedLineId) {
        const mid = midpoint(p1, p2);
        const normal = lineNormal({ p1, p2 });
        const rotate = { x: mid.x + normal.x * 32, y: mid.y + normal.y * 32 };

        [p1, p2, mid, rotate].forEach((handle, index) => {
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, index === 3 ? 7 : HANDLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = index === 3 ? '#fde047' : '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#111827';
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      }
    });

    if (showDebug) {
      debugState.active.forEach((item) => {
        const p = {
          x: (item.centroid.x / videoSize.width) * canvas.width,
          y: (item.centroid.y / videoSize.height) * canvas.height,
        };
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }
  }, [debugState.active, debugState.blobs, displayRect.height, displayRect.width, lines, selectedLineId, showDebug, videoSize.height, videoSize.width]);

  const toCanvasPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e) => {
    if (!displayRect.width || !displayRect.height) return;
    const point = toCanvasPoint(e);

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      const hit = hitTest(line, point, displayRect.width, displayRect.height);
      if (!hit) continue;

      onSelectLine(line.id);
      interactionRef.current = { lineId: line.id, mode: hit.mode, start: point };
      return;
    }

    onSelectLine(null);
  };

  const handlePointerMove = (e) => {
    const interaction = interactionRef.current;
    if (!interaction) return;

    const point = toCanvasPoint(e);
    const line = lines.find((item) => item.id === interaction.lineId);
    if (!line) return;

    const p1 = toPixels(line.p1, displayRect.width, displayRect.height);
    const p2 = toPixels(line.p2, displayRect.width, displayRect.height);

    if (interaction.mode === 'move') {
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      onUpdateLine(line.id, {
        p1: toNormalized({ x: p1.x + dx, y: p1.y + dy }, displayRect.width, displayRect.height),
        p2: toNormalized({ x: p2.x + dx, y: p2.y + dy }, displayRect.width, displayRect.height),
      });
      interactionRef.current.start = point;
      return;
    }

    if (interaction.mode === 'resize-start') {
      onUpdateLine(line.id, { p1: toNormalized(point, displayRect.width, displayRect.height) });
      return;
    }

    if (interaction.mode === 'resize-end') {
      onUpdateLine(line.id, { p2: toNormalized(point, displayRect.width, displayRect.height) });
      return;
    }

    if (interaction.mode === 'rotate') {
      const mid = midpoint(p1, p2);
      const baseAngle = Math.atan2(interaction.start.y - mid.y, interaction.start.x - mid.x);
      const currentAngle = Math.atan2(point.y - mid.y, point.x - mid.x);
      const delta = currentAngle - baseAngle;
      onUpdateLine(line.id, {
        p1: toNormalized(rotatePointAround(p1, mid, delta), displayRect.width, displayRect.height),
        p2: toNormalized(rotatePointAround(p2, mid, delta), displayRect.width, displayRect.height),
      });
      interactionRef.current.start = point;
    }
  };

  return (
    <div className="video-stage" ref={containerRef}>
      {sourceUrl ? (
        <>
          <video
            ref={videoRef}
            src={sourceUrl}
            style={{
              position: 'absolute',
              left: displayRect.left,
              top: displayRect.top,
              width: displayRect.width,
              height: displayRect.height,
            }}
            onLoadedMetadata={onLoadedMetadata}
            onPlay={() => onPlaybackState(true)}
            onPause={() => onPlaybackState(false)}
            controls
          />
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              left: displayRect.left,
              top: displayRect.top,
              width: displayRect.width,
              height: displayRect.height,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => {
              interactionRef.current = null;
            }}
            onPointerLeave={() => {
              interactionRef.current = null;
            }}
          />
        </>
      ) : (
        <div className="empty-state">Upload a video to start composing motion lines.</div>
      )}
      {selectedLine && <div className="selection-badge">Editing: {selectedLine.name}</div>}
    </div>
  );
}
