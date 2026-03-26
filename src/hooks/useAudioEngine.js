import { useCallback, useEffect, useRef } from 'react';
import { speedToFrequency } from '../lib/audioScale';

export function useAudioEngine() {
  const audioContextRef = useRef(null);
  const masterRef = useRef(null);
  const voicesRef = useRef(new Map());
  const waveRef = useRef(null);

  const ensureContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const context = new window.AudioContext();
      const master = context.createGain();
      master.gain.value = 0.55;
      master.connect(context.destination);
      audioContextRef.current = context;
      masterRef.current = master;

      const real = new Float32Array([0, 1, 0.42, 0.22, 0.1, 0.08, 0.05, 0.03]);
      const imag = new Float32Array(real.length);
      waveRef.current = context.createPeriodicWave(real, imag);
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
      existing.oscC.frequency.setTargetAtTime(frequency * 3.98, context.currentTime, 0.05);
      return;
    }

    const output = context.createGain();
    const body = context.createGain();
    const hammer = context.createGain();
    const toneFilter = context.createBiquadFilter();
    const hammerFilter = context.createBiquadFilter();
    const oscA = context.createOscillator();
    const oscB = context.createOscillator();
    const oscC = context.createOscillator();
    const noise = context.createBufferSource();

    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 3600;
    toneFilter.Q.value = 0.9;

    hammerFilter.type = 'bandpass';
    hammerFilter.frequency.value = 2400;
    hammerFilter.Q.value = 0.7;

    oscA.setPeriodicWave(waveRef.current);
    oscB.type = 'sine';
    oscC.type = 'triangle';

    oscA.frequency.value = frequency;
    oscB.frequency.value = frequency * 2.01;
    oscC.frequency.value = frequency * 3.98;

    const noiseBuffer = context.createBuffer(1, Math.round(context.sampleRate * 0.02), context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i += 1) {
      noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
    }
    noise.buffer = noiseBuffer;

    body.gain.value = 0.7;
    hammer.gain.value = 0;
    output.gain.value = 0;

    oscA.connect(body);
    oscB.connect(body);
    oscC.connect(body);
    body.connect(toneFilter);
    toneFilter.connect(output);

    noise.connect(hammerFilter);
    hammerFilter.connect(hammer);
    hammer.connect(output);

    output.connect(masterRef.current);

    const now = context.currentTime;
    const peak = 0.12 + settings.gain * 0.2;
    const sustain = peak * 0.45;

    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(0, now);
    output.gain.linearRampToValueAtTime(peak, now + 0.01);
    output.gain.exponentialRampToValueAtTime(sustain, now + 0.18);

    hammer.gain.setValueAtTime(0.12, now);
    hammer.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    toneFilter.frequency.setValueAtTime(4800, now);
    toneFilter.frequency.exponentialRampToValueAtTime(2600, now + 0.22);

    oscA.start(now);
    oscB.start(now);
    oscC.start(now);
    noise.start(now);
    noise.stop(now + 0.06);

    voicesRef.current.set(id, { oscA, oscB, oscC, output, targetFrequency: frequency });
  }, [ensureContext]);

  const noteOff = useCallback((id) => {
    const context = audioContextRef.current;
    const voice = voicesRef.current.get(id);
    if (!voice || !context) return;

    const now = context.currentTime;
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setTargetAtTime(0.0001, now, 0.09);

    const stopAt = now + 0.45;
    voice.oscA.stop(stopAt);
    voice.oscB.stop(stopAt);
    voice.oscC.stop(stopAt);

    voicesRef.current.delete(id);
  }, []);

  const stopAll = useCallback(() => {
    Array.from(voicesRef.current.keys()).forEach((id) => noteOff(id));
  }, [noteOff]);

  useEffect(() => () => stopAll(), [stopAll]);

  return { ensureContext, noteOn, noteOff, stopAll };
}
