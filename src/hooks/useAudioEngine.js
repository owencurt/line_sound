import { useCallback, useEffect, useRef } from 'react';
import { speedToMidiFromSettings } from '../lib/audioScale';

const SAMPLE_ROOTS = [36, 43, 48, 55, 60, 67, 72, 79, 84];
const SAMPLE_BASE_URL = 'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@master/FluidR3_GM/acoustic_grand_piano-mp3';

const midiToNoteName = (midi) => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = names[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
};

const pickNearestSampleMidi = (targetMidi) => {
  let nearest = SAMPLE_ROOTS[0];
  let best = Math.abs(targetMidi - nearest);
  SAMPLE_ROOTS.forEach((root) => {
    const d = Math.abs(targetMidi - root);
    if (d < best) {
      best = d;
      nearest = root;
    }
  });
  return nearest;
};

export function useAudioEngine() {
  const audioContextRef = useRef(null);
  const masterRef = useRef(null);
  const sampleBuffersRef = useRef(new Map());
  const loadingRef = useRef(new Map());
  const voicesRef = useRef(new Map());

  const ensureContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const context = new window.AudioContext();
      const master = context.createGain();
      master.gain.value = 0.8;
      master.connect(context.destination);
      audioContextRef.current = context;
      masterRef.current = master;
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  }, []);

  const fetchSample = useCallback(async (midi) => {
    if (sampleBuffersRef.current.has(midi)) return sampleBuffersRef.current.get(midi);
    if (loadingRef.current.has(midi)) return loadingRef.current.get(midi);

    const noteName = midiToNoteName(midi).replace('#', 's');
    const promise = (async () => {
      const response = await fetch(`${SAMPLE_BASE_URL}/${noteName}.mp3`);
      if (!response.ok) throw new Error(`Failed to load piano sample ${noteName}`);
      const buffer = await response.arrayBuffer();
      const decoded = await audioContextRef.current.decodeAudioData(buffer);
      sampleBuffersRef.current.set(midi, decoded);
      loadingRef.current.delete(midi);
      return decoded;
    })();

    loadingRef.current.set(midi, promise);
    return promise;
  }, []);

  const noteOn = useCallback(async (id, speed, settings, noteContext = {}) => {
    await ensureContext();
    const context = audioContextRef.current;
    if (!context || !masterRef.current) return;

    const targetMidi = speedToMidiFromSettings(speed, settings, noteContext);
    const voice = voicesRef.current.get(id);

    if (voice) {
      return;
    }

    const rootMidi = pickNearestSampleMidi(targetMidi);
    let sampleBuffer;
    try {
      sampleBuffer = await fetchSample(rootMidi);
    } catch {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = sampleBuffer;
    source.loop = true;
    source.loopStart = Math.min(0.42, Math.max(0, sampleBuffer.duration * 0.2));
    source.loopEnd = Math.max(source.loopStart + 0.12, sampleBuffer.duration - 0.03);

    const noteGain = context.createGain();
    const bodyFilter = context.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.value = 5600;
    bodyFilter.Q.value = 0.6;

    source.playbackRate.value = 2 ** ((targetMidi - rootMidi) / 12);

    source.connect(bodyFilter);
    bodyFilter.connect(noteGain);
    noteGain.connect(masterRef.current);

    const now = context.currentTime;
    const peak = 0.1 + settings.gain * 0.24;
    const sustain = peak * 0.7;
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(peak, now + 0.015);
    noteGain.gain.exponentialRampToValueAtTime(sustain, now + 0.24);

    source.start(now);

    voicesRef.current.set(id, { source, noteGain });
  }, [ensureContext, fetchSample]);

  const noteOff = useCallback((id) => {
    const context = audioContextRef.current;
    const voice = voicesRef.current.get(id);
    if (!voice || !context) return;

    const now = context.currentTime;
    voice.noteGain.gain.cancelScheduledValues(now);
    voice.noteGain.gain.setTargetAtTime(0.0001, now, 0.13);
    voice.source.stop(now + 0.7);
    voicesRef.current.delete(id);
  }, []);

  const stopAll = useCallback(() => {
    Array.from(voicesRef.current.keys()).forEach((id) => noteOff(id));
  }, [noteOff]);

  useEffect(() => () => stopAll(), [stopAll]);

  return { ensureContext, noteOn, noteOff, stopAll };
}
