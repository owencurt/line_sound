# Line Sound

Line Sound is a browser-only creative instrument: upload a prerecorded video, place custom lines over the frame, and turn moving objects into sustained musical notes.

As motion intersects each line, a polyphonic synth plays notes whose pitch tracks object speed. Multiple lines and multiple moving objects can perform simultaneously.

## Features

- Local video upload (no backend required)
- Optional mute toggle for original video audio
- Responsive video stage with aspect-ratio-safe canvas overlays
- Multi-line editor with:
  - drag to move
  - endpoint resize
  - rotate handle
  - select/deselect
  - duplicate/delete
- Per-line customization:
  - name
  - color
  - enable/disable
  - line thickness
  - note offset
  - pitch sensitivity
  - high pitch range
  - gain
- Motion detection pipeline:
  - frame differencing
  - connected-component blob extraction
  - centroid speed estimation
  - lightweight blob tracking for multiple objects
- Entry/sustain/release intersection state for stable note triggering
- Polyphonic Web Audio synth with smooth envelope and anti-spam sustain behavior
- Debug overlay toggle (blobs, centroids, active intersections)
- Line persistence in `localStorage`
- JSON export/import for line configurations

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL.

## How it works

### 1) Video and coordinate system

- The video is displayed with contain-fit behavior inside a responsive stage.
- A canvas overlay is positioned to exactly match the displayed video rectangle (not the full stage).
- Line geometry is stored in normalized coordinates (`0..1`) so lines stay aligned regardless of resize.

### 2) Motion detection approach

- While video is playing, frames are sampled on a downscaled hidden canvas for performance.
- Per-pixel RGB frame differencing identifies motion pixels.
- A thresholded binary mask is grouped via connected components into blobs.
- Each blob yields centroid + bounding box + area.

### 3) Tracking and intersections

- Blobs are associated to short-lived tracks using nearest-centroid matching.
- Track speed is smoothed over time.
- For each enabled line, centroid-to-segment distance is checked against line thickness + blob radius.
- To reduce single-object double-triggering (front/back edges), intersecting blobs are clustered per line before note triggering so each physical object tends to produce one held note.
- Line/track pairs are held with hysteresis timeouts to avoid flicker:
  - enter: start note once
  - sustain: keep note alive while pair remains active
  - exit: release after timeout

### 4) Audio mapping logic

- Web Audio API poly synth (triangle + sine harmonic through lowpass filter).
- Object speed maps to a curated musical scale (not arbitrary frequencies): each line converts smoothed object speed into a normalized motion value and selects scale notes from low→high.
- Note chosen for each active object/line pair depends on:
  - smoothed centroid speed from the tracker
  - per-line `pitch sensitivity` (how quickly speed climbs the scale)
  - per-line `high pitch range` (how much of the top end of the scale is reachable)
  - per-line `note offset` (global transposition in semitones)
- A note starts once when a tracked object first intersects a line, sustains while the pair remains active, and releases after hysteresis timeout if intersection disappears.
- Sustain/release timing factors:
  - frame processing interval (analysis cadence)
  - `RELEASE_TIMEOUT` hysteresis in motion hook (prevents flicker cut-offs)
  - audio envelope release in `useAudioEngine` (smooth tail on note-off)

## Architecture

```text
src/
  components/
    ControlsPanel.jsx
    VideoStage.jsx
  hooks/
    useAudioEngine.js
    useMotionDetection.js
  lib/
    audioScale.js
    geometry.js
  App.jsx
```

## Limitations

- Motion detection uses simple frame differencing, so sudden lighting changes can trigger blobs.
- Tracking is intentionally lightweight and may swap IDs in crowded/fast scenes (though nearby blob merging helps reduce front/back double-trigger artifacts on single objects).
- Current synth is “piano-like” but not sample-based acoustic piano.
- Best results with stable camera footage and visible object contrast.

## Future improvements

- Optional Tone.js/sample-based instruments
- Better tracking (Kalman/optical flow)
- Per-line scales, quantization modes, and MIDI export
- Timeline automation + recorded performance rendering
- Save/load full sessions (video metadata + line presets)
