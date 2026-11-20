const neutral = { open: 0, width: 0, weight: 0.65 };
const shape = {
  a: { open: 0.9, width: 0.08, weight: 1.35 },
  e: { open: 0.52, width: 0.5, weight: 1.25 },
  i: { open: 0.32, width: 0.65, weight: 1.15 },
  o: { open: 0.66, width: -0.55, weight: 1.25 },
  u: { open: 0.32, width: -0.7, weight: 1.15 },
  labial: { open: 0, width: -0.12, weight: 0.8 },
  dental: { open: 0.22, width: 0.23, weight: 0.78 }
};

export function createAudioMouth(analyser, sampleRate) {
  const waveform = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const recent = waveform.subarray(Math.max(0, waveform.length - Math.round(sampleRate * 0.018)));
  const binWidth = sampleRate / analyser.fftSize;

  function band(from, to) {
    let power = 0;
    const first = Math.ceil(from / binWidth);
    const last = Math.min(spectrum.length, Math.ceil(to / binWidth));
    for (let index = first; index < last; index++) power += 10 ** (spectrum[index] / 10);
    return last > first ? power / (last - first) : 0;
  }

  return () => {
    analyser.getFloatTimeDomainData(waveform);
    const energy = Math.sqrt(recent.reduce((sum, value) => sum + value * value, 0) / recent.length);
    if (energy <= 0.004) return { energy, open: 0, width: 0 };

    analyser.getFloatFrequencyData(spectrum);
    const low = band(250, 580);
    const middle = band(580, 1050);
    const rounded = band(850, 1450);
    const front = band(1450, 2800);
    const hiss = band(3000, 6200);
    const lift = middle / (low + middle + 1e-12);
    const consonant = hiss / (hiss + middle + rounded + front + 1e-12);
    const strength = 1 - Math.exp(-(energy - 0.004) * 45);
    return {
      energy,
      open: strength * (0.64 + 0.36 * lift) * (1 - consonant * 0.65),
      width: strength * Math.tanh(Math.log((front + hiss + 1e-11) / (rounded + 1e-11)) * 0.62)
    };
  };
}

export function decodeSpeech(buffer, contentType) {
  if (!contentType?.startsWith('application/x-dr-speech')) return { audio: buffer, words: [] };
  if (buffer.byteLength < 5) throw new Error('La muestra de voz está incompleta.');
  const metadataEnd = new DataView(buffer).getUint32(0) + 4;
  if (metadataEnd >= buffer.byteLength) throw new Error('La muestra de voz está incompleta.');
  let words = [];
  try {
    const metadata = JSON.parse(new TextDecoder().decode(buffer.slice(4, metadataEnd)));
    if (Array.isArray(metadata)) words = metadata;
  } catch {}
  return { audio: buffer.slice(metadataEnd), words };
}

function spanishMouthShapes(word) {
  const letters = word.toLowerCase().normalize('NFD')
    .replace(/u\u0308/g, 'ü')
    .replace(/n\u0303/g, 'ñ')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zñü]/g, '')
    .replace(/qu(?=[ei])/g, 'k')
    .replace(/gu(?=[ei])/g, 'g')
    .replace(/ch|rr|ll/g, 'j')
    .replace(/h/g, '');
  return Array.from(letters, (letter, index) => {
    if (letter === 'ü' || (letter === 'y' && index === letters.length - 1)) {
      return shape[letter === 'ü' ? 'u' : 'i'];
    }
    if ('bmpv'.includes(letter)) return shape.labial;
    if ('dfstz'.includes(letter)) return shape.dental;
    return shape[letter] || neutral;
  });
}

export function makeMouthTrack(words, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const cues = [];
  let previousEnd = 0;
  for (const entry of words) {
    if (!Array.isArray(entry)) continue;
    const [word, start, end] = entry;
    if (typeof word !== 'string' || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const from = Math.max(previousEnd, start, 0);
    const to = Math.min(duration, end);
    if (to <= from) continue;
    const shapes = spanishMouthShapes(word);
    if (!shapes.length) continue;
    const weight = shapes.reduce((total, item) => total + item.weight, 0);
    let position = from;
    for (const item of shapes) {
      const length = (to - from) * item.weight / weight;
      cues.push({ from: position, to: position + length, open: item.open, width: item.width });
      position += length;
    }
    previousEnd = to;
  }
  if (!cues.length) return undefined;

  return time => {
    let lower = 0;
    let upper = cues.length;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (cues[middle].to <= time) lower = middle + 1;
      else upper = middle;
    }
    const cue = cues[lower];
    return cue && time >= cue.from ? cue : neutral;
  };
}
