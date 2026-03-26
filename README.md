# Line Sound

Line Sound is a browser-only creative instrument: upload a prerecorded video, place custom lines over the frame, and turn moving objects into sustained musical notes.

As motion intersects each line, a polyphonic synth plays notes whose pitch tracks object speed. Multiple lines and multiple moving objects can perform simultaneously.

## Features

- Local video upload (no backend required)
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
- Line/track pairs are held with hysteresis timeouts to avoid flicker:
  - enter: start note once
  - sustain: keep note alive while pair remains active
  - exit: release after timeout

### 4) Audio mapping logic

- Web Audio API poly synth (triangle + sine harmonic through lowpass filter).
- Object speed maps to a curated musical scale (not arbitrary frequencies).
- Per-line note offset and sensitivity shape pitch behavior.
- Notes update pitch while sustained and release with envelope smoothing.

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
- Tracking is intentionally lightweight and may swap IDs in crowded/fast scenes.
- Current synth is “piano-like” but not sample-based acoustic piano.
- Best results with stable camera footage and visible object contrast.

## Future improvements

- Optional Tone.js/sample-based instruments
- Better tracking (Kalman/optical flow)
- Per-line scales, quantization modes, and MIDI export
- Timeline automation + recorded performance rendering
- Save/load full sessions (video metadata + line presets)
