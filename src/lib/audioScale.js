import { clamp } from './geometry';

const SCALE_NOTES = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];

export const midiToFrequency = (midi) => 440 * 2 ** ((midi - 69) / 12);

export const speedToMidi = (speed, offset = 0, sensitivity = 1) => {
  const normalized = clamp((speed * sensitivity) / 350, 0, 1);
  const index = Math.round(normalized * (SCALE_NOTES.length - 1));
  const midi = SCALE_NOTES[index] + offset;
  return clamp(midi, 24, 96);
};

export const speedToFrequency = (speed, settings) => {
  const offset = settings?.noteOffset ?? 0;
  const sensitivity = settings?.sensitivity ?? 1;
  const pitchSpread = settings?.pitchSpread ?? 1;

  const normalized = clamp((speed * sensitivity) / 350, 0, 1);
  const spreadLength = clamp(Math.round((SCALE_NOTES.length - 1) * pitchSpread), 3, SCALE_NOTES.length - 1);
  const index = Math.round(normalized * spreadLength);
  const midi = clamp(SCALE_NOTES[index] + offset, 24, 96);
  return midiToFrequency(midi);
};
