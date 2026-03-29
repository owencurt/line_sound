import { useEffect, useRef, useState } from 'react';
import { toPixels } from '../lib/geometry';

const MAX_ANALYSIS_WIDTH = 360;
const FRAME_INTERVAL = 60;
const TRACK_TIMEOUT = 320;
const RELEASE_TIMEOUT = 120;

const FG_THRESHOLD = 28;
const BG_ALPHA_STATIC = 0.06;
const BG_ALPHA_MOVING = 0.003;

function dilate(binary, width, height) {
  const out = new Uint8Array(binary.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (
        binary[idx] ||
        binary[idx - 1] ||
        binary[idx + 1] ||
        binary[idx - width] ||
        binary[idx + width]
      ) {
        out[idx] = 1;
      }
    }
  }
  return out;
}

function erode(binary, width, height) {
  const out = new Uint8Array(binary.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (
        binary[idx] &&
        binary[idx - 1] &&
        binary[idx + 1] &&
        binary[idx - width] &&
        binary[idx + width]
      ) {
        out[idx] = 1;
      }
    }
  }
  return out;
}

function connectedComponents(binary, width, height, minArea) {
  const visited = new Uint8Array(binary.length);
  const blobs = [];
  const stack = [];

  for (let i = 0; i < binary.length; i += 1) {
    if (!binary[i] || visited[i]) continue;

    visited[i] = 1;
    stack.length = 0;
    stack.push(i);

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = Math.floor(idx / width);

      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
      neighbors.forEach((n) => {
        if (n < 0 || n >= binary.length || visited[n] || !binary[n]) return;
        visited[n] = 1;
        stack.push(n);
      });
    }

    if (area >= minArea) {
      blobs.push({
        area,
        centroid: { x: sumX / area, y: sumY / area },
        bbox: { minX, minY, maxX, maxY },
      });
    }
  }

  return blobs;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.00001) return 0;
  return value > 0 ? 1 : 2;
}

function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  return o1 !== o2 && o3 !== o4;
}

function pointInRect(point, rect) {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

function lineIntersectsRect(a, b, rect, padding = 0) {
  const padded = {
    minX: rect.minX - padding,
    minY: rect.minY - padding,
    maxX: rect.maxX + padding,
    maxY: rect.maxY + padding,
  };

  if (pointInRect(a, padded) || pointInRect(b, padded)) return true;

  const topLeft = { x: padded.minX, y: padded.minY };
  const topRight = { x: padded.maxX, y: padded.minY };
  const bottomLeft = { x: padded.minX, y: padded.maxY };
  const bottomRight = { x: padded.maxX, y: padded.maxY };

  return (
    segmentsIntersect(a, b, topLeft, topRight) ||
    segmentsIntersect(a, b, topRight, bottomRight) ||
    segmentsIntersect(a, b, bottomRight, bottomLeft) ||
    segmentsIntersect(a, b, bottomLeft, topLeft)
  );
}

function bboxIoU(a, b) {
  const xA = Math.max(a.minX, b.minX);
  const yA = Math.max(a.minY, b.minY);
  const xB = Math.min(a.maxX, b.maxX);
  const yB = Math.min(a.maxY, b.maxY);

  const interW = Math.max(0, xB - xA);
  const interH = Math.max(0, yB - yA);
  const intersection = interW * interH;
  if (!intersection) return 0;

  const areaA = (a.maxX - a.minX) * (a.maxY - a.minY);
  const areaB = (b.maxX - b.minX) * (b.maxY - b.minY);
  return intersection / (areaA + areaB - intersection);
}

export function useMotionDetection({ videoRef, dimensions, isPlaying, lines, debugEnabled }) {
  const [debugState, setDebugState] = useState({ blobs: [], active: [] });
  const [intersections, setIntersections] = useState([]);

  const rafRef = useRef(null);
  const frameRef = useRef({ ts: 0, background: null });
  const analysisCanvasRef = useRef(null);

  const trackingRef = useRef({
    nextTrackId: 1,
    tracks: new Map(),
    activePairs: new Map(),
  });

  useEffect(() => {
    analysisCanvasRef.current = document.createElement('canvas');
  }, []);

  useEffect(() => {
    if (!videoRef.current || !dimensions.width || !dimensions.height || !isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const video = videoRef.current;
    const analysisCanvas = analysisCanvasRef.current;
    const analysisWidth = Math.min(MAX_ANALYSIS_WIDTH, dimensions.width);
    const analysisHeight = Math.round((analysisWidth * dimensions.height) / dimensions.width);
    const minArea = Math.max(12, Math.round((analysisWidth * analysisHeight) / 11000));

    analysisCanvas.width = analysisWidth;
    analysisCanvas.height = analysisHeight;

    const ctx = analysisCanvas.getContext('2d', { willReadFrequently: true });

    const tick = (ts) => {
      rafRef.current = requestAnimationFrame(tick);
      if (ts - frameRef.current.ts < FRAME_INTERVAL || video.paused || video.ended) return;
      frameRef.current.ts = ts;

      ctx.drawImage(video, 0, 0, analysisWidth, analysisHeight);
      const frame = ctx.getImageData(0, 0, analysisWidth, analysisHeight);

      const gray = new Float32Array(analysisWidth * analysisHeight);
      for (let i = 0, p = 0; i < frame.data.length; i += 4, p += 1) {
        gray[p] = frame.data[i] * 0.299 + frame.data[i + 1] * 0.587 + frame.data[i + 2] * 0.114;
      }

      if (!frameRef.current.background) {
        frameRef.current.background = gray;
        return;
      }

      const background = frameRef.current.background;
      const fg = new Uint8Array(gray.length);

      for (let i = 0; i < gray.length; i += 1) {
        const diff = Math.abs(gray[i] - background[i]);
        const moving = diff > FG_THRESHOLD;
        fg[i] = moving ? 1 : 0;
        const alpha = moving ? BG_ALPHA_MOVING : BG_ALPHA_STATIC;
        background[i] = background[i] * (1 - alpha) + gray[i] * alpha;
      }

      const morph = erode(dilate(fg, analysisWidth, analysisHeight), analysisWidth, analysisHeight);
      const blobs = connectedComponents(morph, analysisWidth, analysisHeight, minArea).map((blob) => ({
        ...blob,
        centroid: {
          x: (blob.centroid.x / analysisWidth) * dimensions.width,
          y: (blob.centroid.y / analysisHeight) * dimensions.height,
        },
        bbox: {
          minX: (blob.bbox.minX / analysisWidth) * dimensions.width,
          minY: (blob.bbox.minY / analysisHeight) * dimensions.height,
          maxX: (blob.bbox.maxX / analysisWidth) * dimensions.width,
          maxY: (blob.bbox.maxY / analysisHeight) * dimensions.height,
        },
      }));

      const tracker = trackingRef.current;
      const now = performance.now();
      const unmatchedTracks = new Set(tracker.tracks.keys());

      blobs.forEach((blob) => {
        let bestTrack = null;
        let bestScore = 0;

        tracker.tracks.forEach((track) => {
          if (!unmatchedTracks.has(track.id)) return;
          const iou = bboxIoU(track.bbox, blob.bbox);
          const dist = Math.hypot(track.centroid.x - blob.centroid.x, track.centroid.y - blob.centroid.y);
          const score = iou > 0 ? iou + 0.2 : dist < 90 ? 0.15 - dist / 900 : 0;
          if (score > bestScore) {
            bestScore = score;
            bestTrack = track;
          }
        });

        if (!bestTrack) {
          const track = {
            id: tracker.nextTrackId++,
            bbox: blob.bbox,
            centroid: blob.centroid,
            speed: 0,
            lastSeen: now,
          };
          tracker.tracks.set(track.id, track);
          blob.trackId = track.id;
          blob.speed = 0;
          return;
        }

        const dt = Math.max(0.016, (now - bestTrack.lastSeen) / 1000);
        const instantSpeed = Math.hypot(blob.centroid.x - bestTrack.centroid.x, blob.centroid.y - bestTrack.centroid.y) / dt;

        bestTrack.speed = bestTrack.speed * 0.6 + instantSpeed * 0.4;
        bestTrack.bbox = blob.bbox;
        bestTrack.centroid = blob.centroid;
        bestTrack.lastSeen = now;

        blob.trackId = bestTrack.id;
        blob.speed = bestTrack.speed;
        unmatchedTracks.delete(bestTrack.id);
      });

      tracker.tracks.forEach((track, id) => {
        if (now - track.lastSeen > TRACK_TIMEOUT) tracker.tracks.delete(id);
      });

      const candidatePairs = new Set();
      const active = [];

      lines.filter((line) => line.enabled).forEach((line) => {
        const a = toPixels(line.p1, dimensions.width, dimensions.height);
        const b = toPixels(line.p2, dimensions.width, dimensions.height);

        blobs.forEach((blob) => {
          const touching = lineIntersectsRect(a, b, blob.bbox, line.thickness);
          if (!touching) return;

          const pairId = `${line.id}:track-${blob.trackId}`;
          candidatePairs.add(pairId);

          const previous = tracker.activePairs.get(pairId) || {
            enteredAt: now,
            lineId: line.id,
            trackId: blob.trackId,
          };
          previous.lastSeen = now;
          previous.speed = blob.speed;
          previous.centroid = blob.centroid;
          previous.bbox = blob.bbox;
          tracker.activePairs.set(pairId, previous);

          active.push({
            id: pairId,
            lineId: line.id,
            trackId: blob.trackId,
            speed: blob.speed,
            centroid: blob.centroid,
            bbox: blob.bbox,
            color: line.color,
          });
        });
      });

      tracker.activePairs.forEach((pair, key) => {
        if (!candidatePairs.has(key) && now - pair.lastSeen > RELEASE_TIMEOUT) {
          tracker.activePairs.delete(key);
        }
      });

      setIntersections(Array.from(tracker.activePairs.entries()).map(([id, pair]) => ({ id, ...pair })));
      setDebugState(debugEnabled ? { blobs, active } : { blobs: [], active: [] });
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [debugEnabled, dimensions.height, dimensions.width, isPlaying, lines, videoRef]);

  return { debugState, intersections };
}
