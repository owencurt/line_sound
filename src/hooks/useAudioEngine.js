import { useCallback, useEffect, useRef } from 'react';
import { speedToFrequency } from '../lib/audioScale';

export function useAudioEngine() {
  const audioContextRef = useRef(null);
  const masterRef = useRef(null);
  const voicesRef = useRef(new Map());

  const ensureContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const context = new window.AudioContext();
      const master = context.createGain();
      master.gain.value = 0.7;
      master.connect(context.destination);
      audioContextRef.current = context;
      masterRef.current = master;
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  }, []);

  const noteOn = useCallback(async (id, speed, settings) => {
    await ensureContext();
    const context = audioContextRef.current;

    if (!context || !masterRef.current) return;

    const existing = voicesRef.current.get(id);
    const frequency = speedToFrequency(speed, settings.noteOffset, settings.sensitivity);

    if (existing) {
      existing.targetFrequency = frequency;
      existing.oscA.frequency.setTargetAtTime(frequency, context.currentTime, 0.05);
      existing.oscB.frequency.setTargetAtTime(frequency * 2, context.currentTime, 0.05);
      return;
    }

    const output = context.createGain();
    const tone = context.createGain();
    const filter = context.createBiquadFilter();
    const oscA = context.createOscillator();
    const oscB = context.createOscillator();

    filter.type = 'lowpass';
    filter.frequency.value = 4200;
    filter.Q.value = 0.8;

    oscA.type = 'triangle';
    oscB.type = 'sine';

    oscA.frequency.value = frequency;
    oscB.frequency.value = frequency * 2;

    tone.gain.value = 0.6;
    output.gain.value = 0;

    oscA.connect(tone);
    oscB.connect(tone);
    tone.connect(filter);
    filter.connect(output);
    output.connect(masterRef.current);

    const now = context.currentTime;
    const gainTarget = 0.08 + settings.gain * 0.24;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(0, now);
    output.gain.linearRampToValueAtTime(gainTarget, now + 0.03);

    oscA.start();
    oscB.start();

    voicesRef.current.set(id, { oscA, oscB, output, targetFrequency: frequency });
  }, [ensureContext]);

  const noteOff = useCallback((id) => {
    const context = audioContextRef.current;
    const voice = voicesRef.current.get(id);
    if (!voice || !context) return;

    const now = context.currentTime;
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setTargetAtTime(0.0001, now, 0.09);

    const stopAt = now + 0.35;
    voice.oscA.stop(stopAt);
    voice.oscB.stop(stopAt);

    voicesRef.current.delete(id);
  }, []);

  const stopAll = useCallback(() => {
    Array.from(voicesRef.current.keys()).forEach((id) => noteOff(id));
  }, [noteOff]);

  useEffect(() => () => stopAll(), [stopAll]);

  return { ensureContext, noteOn, noteOff, stopAll };
}
