import { useEffect, useRef, useState } from 'react';
import { pointToSegmentDistance, toPixels } from '../lib/geometry';

const MAX_ANALYSIS_WIDTH = 320;
const FRAME_INTERVAL = 70;
const TRACK_TIMEOUT = 220;
const RELEASE_TIMEOUT = 180;

function mergeNearbyBlobs(sourceBlobs) {
  const blobs = [...sourceBlobs];
  const merged = [];

  while (blobs.length) {
    let base = blobs.pop();
    let didMerge = true;

    while (didMerge) {
      didMerge = false;
      for (let i = blobs.length - 1; i >= 0; i -= 1) {
        const candidate = blobs[i];
        const cx = base.centroid.x - candidate.centroid.x;
        const cy = base.centroid.y - candidate.centroid.y;
        const centroidDistance = Math.hypot(cx, cy);

        const gapX = Math.max(
          0,
          Math.max(base.bbox.minX, candidate.bbox.minX) - Math.min(base.bbox.maxX, candidate.bbox.maxX),
        );
        const gapY = Math.max(
          0,
          Math.max(base.bbox.minY, candidate.bbox.minY) - Math.min(base.bbox.maxY, candidate.bbox.maxY),
        );
        const edgeGap = Math.hypot(gapX, gapY);

        if (centroidDistance > 90 && edgeGap > 28) continue;

        const area = base.area + candidate.area;
        base = {
          area,
          centroid: {
            x: (base.centroid.x * base.area + candidate.centroid.x * candidate.area) / area,
            y: (base.centroid.y * base.area + candidate.centroid.y * candidate.area) / area,
          },
          bbox: {
            minX: Math.min(base.bbox.minX, candidate.bbox.minX),
            minY: Math.min(base.bbox.minY, candidate.bbox.minY),
            maxX: Math.max(base.bbox.maxX, candidate.bbox.maxX),
            maxY: Math.max(base.bbox.maxY, candidate.bbox.maxY),
          },
        };
        blobs.splice(i, 1);
        didMerge = true;
      }
    }

    merged.push(base);
  }

  return merged;
}

function connectedComponents(binary, width, height, minArea) {
  const visited = new Uint8Array(binary.length);
  const blobs = [];
  const queue = [];

  for (let i = 0; i < binary.length; i += 1) {
    if (!binary[i] || visited[i]) continue;

    visited[i] = 1;
    queue.length = 0;
    queue.push(i);

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (queue.length) {
      const idx = queue.pop();
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
        const nx = n % width;
        const ny = Math.floor(n / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) > 1) return;
        visited[n] = 1;
        queue.push(n);
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

export function useMotionDetection({
  videoRef,
  dimensions,
  isPlaying,
  lines,
  debugEnabled,
}) {
  const [debugState, setDebugState] = useState({ blobs: [], active: [] });
  const [intersections, setIntersections] = useState([]);

  const rafRef = useRef(null);
  const frameRef = useRef({ prev: null, ts: 0 });
  const trackingRef = useRef({
    nextTrackId: 1,
    tracks: new Map(),
    activePairs: new Map(),
  });
  const analysisCanvasRef = useRef(null);

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
    const analysisHeight = Math.round(analysisWidth * (dimensions.height / dimensions.width));
    analysisCanvas.width = analysisWidth;
    analysisCanvas.height = analysisHeight;
    const ctx = analysisCanvas.getContext('2d', { willReadFrequently: true });

    const minArea = Math.max(8, Math.round((analysisWidth * analysisHeight) / 5000));

    const tick = (ts) => {
      rafRef.current = requestAnimationFrame(tick);

      if (ts - frameRef.current.ts < FRAME_INTERVAL || video.paused || video.ended) return;
      frameRef.current.ts = ts;

      ctx.drawImage(video, 0, 0, analysisWidth, analysisHeight);
      const frame = ctx.getImageData(0, 0, analysisWidth, analysisHeight);

      if (!frameRef.current.prev) {
        frameRef.current.prev = frame;
        return;
      }

      const diffBinary = new Uint8Array(analysisWidth * analysisHeight);
      const prevData = frameRef.current.prev.data;
      const currData = frame.data;

      for (let i = 0, p = 0; i < currData.length; i += 4, p += 1) {
        const diff =
          Math.abs(currData[i] - prevData[i]) +
          Math.abs(currData[i + 1] - prevData[i + 1]) +
          Math.abs(currData[i + 2] - prevData[i + 2]);
        if (diff > 46) diffBinary[p] = 1;
      }

      const scaledBlobs = connectedComponents(diffBinary, analysisWidth, analysisHeight, minArea).map((blob) => ({
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

      const blobs = mergeNearbyBlobs(scaledBlobs);

      const tracker = trackingRef.current;
      const now = performance.now();
      const trackIds = new Set();

      blobs.forEach((blob) => {
        let closestTrack = null;
        let closestDistance = Infinity;

        tracker.tracks.forEach((track) => {
          const d = Math.hypot(track.position.x - blob.centroid.x, track.position.y - blob.centroid.y);
          if (d < closestDistance && d < 90) {
            closestDistance = d;
            closestTrack = track;
          }
        });

        if (!closestTrack) {
          closestTrack = {
            id: tracker.nextTrackId++,
            position: blob.centroid,
            speed: 0,
            lastSeen: now,
          };
          tracker.tracks.set(closestTrack.id, closestTrack);
        }

        const dt = Math.max(0.016, (now - closestTrack.lastSeen) / 1000);
        const instantSpeed = Math.hypot(
          blob.centroid.x - closestTrack.position.x,
          blob.centroid.y - closestTrack.position.y,
        ) / dt;

        closestTrack.speed = closestTrack.speed * 0.6 + instantSpeed * 0.4;
        closestTrack.position = blob.centroid;
        closestTrack.lastSeen = now;
        trackIds.add(closestTrack.id);
        blob.trackId = closestTrack.id;
        blob.speed = closestTrack.speed;
      });

      tracker.tracks.forEach((track, id) => {
        if (!trackIds.has(id) && now - track.lastSeen > TRACK_TIMEOUT) {
          tracker.tracks.delete(id);
        }
      });

      const active = [];
      const candidatePairs = new Set();

      lines.filter((line) => line.enabled).forEach((line) => {
        const a = toPixels(line.p1, dimensions.width, dimensions.height);
        const b = toPixels(line.p2, dimensions.width, dimensions.height);

        blobs.forEach((blob) => {
          const dist = pointToSegmentDistance(blob.centroid, a, b);
          const blobRadius = Math.max(6, Math.sqrt(blob.area) * 1.4);
          if (dist > line.thickness + blobRadius) return;

          const pairId = `${line.id}:${blob.trackId}`;
          candidatePairs.add(pairId);
          const prev = tracker.activePairs.get(pairId) || { enteredAt: now, lineId: line.id, trackId: blob.trackId };
          prev.lastSeen = now;
          prev.speed = blob.speed;
          prev.centroid = blob.centroid;
          tracker.activePairs.set(pairId, prev);

          active.push({
            id: pairId,
            lineId: line.id,
            trackId: blob.trackId,
            speed: blob.speed,
            centroid: blob.centroid,
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

      if (debugEnabled) {
        setDebugState({ blobs, active });
      } else {
        setDebugState({ blobs: [], active: [] });
      }

      frameRef.current.prev = frame;
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [debugEnabled, dimensions.height, dimensions.width, isPlaying, lines, videoRef]);

  return { debugState, intersections };
}
