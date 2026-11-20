const crop = { x: 178, y: 0, width: 1022, height: 1080 };
const leftEye = [531, 277, 70, 40, 18];
const rightEye = [716, 269, 69, 41, 18];
const lips = [569, 419, 177, 75, 32];
const durations = { shift: 2400, thought: 3600, yawn: 4500 };

function smooth(progress) {
  const value = Math.max(0, Math.min(1, progress));
  return value * value * (3 - 2 * value);
}

function envelope(elapsed, duration, rise, fall) {
  return smooth(elapsed / rise) * smooth((duration - elapsed) / fall);
}

export function createAvatar(canvas, isEngaged = () => false) {
  const ctx = canvas.getContext('2d');
  const portrait = document.createElement('canvas');
  portrait.width = canvas.width;
  portrait.height = canvas.height;
  const face = portrait.getContext('2d');
  const posedPortrait = document.createElement('canvas');
  posedPortrait.width = canvas.width;
  posedPortrait.height = canvas.height;
  const posture = posedPortrait.getContext('2d');
  const image = new Image();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scale = canvas.width / crop.width;
  const neckStart = Math.round(505 * scale);
  const neckEnd = Math.round(694 * scale);
  let blinkAt = 0;
  let gestureAt = 0;
  let yawnAfter = 0;
  let gesture;
  let previousGesture;
  let analyser;
  let waveform;
  let spokenPose;
  let mouth = 0;
  let mouthWidth = 0;
  let voiceLevel = 0;
  let emphasisAt = 0;
  let nextEmphasis = 0;
  let speakingSince = 0;
  let speaking = false;
  let speakingDirection = 1;
  let paintedMotion = true;

  function paintRegion([x, y, width, height, center], compression, gaze = 0, stretch = 0, jaw = 0) {
    const segments = jaw ? 10 : Math.abs(stretch) > 0.04 ? 5 : 1;
    for (let row = 0; row < height; row++) {
      const fade = Math.sin(Math.PI * row / height) ** 2;
      for (let column = 0; column < segments; column++) {
        const left = column / segments;
        const right = (column + 1) / segments;
        const taper = jaw ? Math.sin(Math.PI * (left + right) / 2) : 1;
        const lowerLip = jaw * smooth((row - center + 3) / 31);
        const sourceY = y + row - ((row - center) * compression + lowerLip) * fade * taper;
        const sourceLeft = x + width * left + Math.sin(2 * Math.PI * left) * stretch * fade * 8;
        const sourceRight = x + width * right + Math.sin(2 * Math.PI * right) * stretch * fade * 8;
        face.drawImage(image, sourceLeft - gaze * fade, sourceY, sourceRight - sourceLeft, 1.8,
          (x + width * left - crop.x) * scale, (y + row) * scale, width * (right - left) * scale, 1.8 * scale);
      }
    }
  }

  function moveHead({ headOffset, nod }) {
    posture.clearRect(0, 0, canvas.width, canvas.height);
    const weight = y => 1 - smooth((y - neckStart) / (neckEnd - neckStart));
    for (let y = 0; y < canvas.height;) {
      const end = y < neckStart ? neckStart : y < neckEnd ? Math.min(neckEnd, y + 8) : canvas.height;
      const from = weight(y);
      const to = weight(end);
      const top = y + Math.round(from * nod);
      const height = end + Math.round(to * nod) - top;
      posture.save();
      posture.transform(1, 0, (to - from) * headOffset / height, 1, from * headOffset, top);
      posture.drawImage(portrait, 0, y, canvas.width, end - y, 0, 0, canvas.width, height);
      posture.restore();
      y = end;
    }
  }

  function speakingPose(now, energy) {
    if (energy >= 0.065 && now >= nextEmphasis && energy * 5 > voiceLevel + 0.12) {
      if (!speaking) {
        speaking = true;
        speakingSince = now;
      }
      emphasisAt = now;
      nextEmphasis = now + 1250 + Math.random() * 950;
      speakingDirection *= -1;
    }
    const target = Math.min(1, energy * 5);
    voiceLevel += (target - voiceLevel) * (target > voiceLevel ? 0.085 : 0.035);
    if (!analyser && voiceLevel < 0.01) {
      speaking = false;
      nextEmphasis = 0;
      return;
    }
    if (!speaking) return;
    const emphasis = envelope(now - emphasisAt, 760, 190, 430);
    const sway = Math.sin((now - speakingSince) / 640) * voiceLevel;
    return {
      shoulderRoll: sway * 0.015 + speakingDirection * emphasis * 0.008,
      shoulderLift: voiceLevel * 4 + emphasis * 2,
      zoom: voiceLevel * 0.024 + emphasis * 0.015,
      headOffset: (sway * 7 - speakingDirection * emphasis * 5) * scale,
      nod: (emphasis * 8 - voiceLevel * 2) * scale
    };
  }

  function restingPose(now, engaged) {
    if (engaged) {
      gesture = undefined;
      gestureAt = 0;
      return { weight: 0 };
    }
    if (!gestureAt) gestureAt = now + 8000 + Math.random() * 6000;
    if (!yawnAfter) yawnAfter = now + 32000;
    if (!gesture && now >= gestureAt) {
      const choices = now >= yawnAfter ? ['thought', 'shift', 'yawn'] : ['thought', 'shift'];
      const options = choices.filter(choice => choice !== previousGesture);
      const type = options[Math.floor(Math.random() * options.length)];
      gesture = { type, start: now, direction: Math.random() < 0.5 ? -1 : 1 };
      previousGesture = type;
      if (type === 'yawn') yawnAfter = now + 60000;
    }
    if (!gesture) return { weight: 0 };
    const elapsed = now - gesture.start;
    const duration = durations[gesture.type];
    if (elapsed >= duration) {
      gesture = undefined;
      gestureAt = now + 10500 + Math.random() * 11000;
      return { weight: 0 };
    }
    return {
      type: gesture.type,
      direction: gesture.direction,
      weight: envelope(elapsed, duration, gesture.type === 'yawn' ? 1550 : 720, 920)
    };
  }

  function draw(now) {
    const quiet = reducedMotion.matches;
    const engaged = Boolean(analyser) || isEngaged();
    const pose = restingPose(now, quiet || engaged);
    if (!blinkAt) blinkAt = now + 3000;
    const elapsed = now - blinkAt;
    if (elapsed > 160) blinkAt = now + 2300 + Math.random() * 3700;
    const blink = !quiet && elapsed >= 0 && elapsed < 160
      ? Math.sin(Math.PI * elapsed / 160) * -2.1 : 0;
    let target = 0;
    let widthTarget = 0;
    let energy = 0;
    if (analyser && !quiet) {
      analyser.getFloatTimeDomainData(waveform);
      let power = 0;
      let change = 0;
      let previous = waveform[0];
      for (const sample of waveform) {
        power += sample * sample;
        change += (sample - previous) ** 2;
        previous = sample;
      }
      energy = Math.sqrt(power / waveform.length);
      const cue = spokenPose?.();
      if (cue) {
        target = cue.open;
        widthTarget = cue.width;
      } else {
        target = smooth((energy - 0.012) * 6.5);
        if (power > 0 && target > 0) widthTarget = target * Math.tanh(Math.sqrt(change / power) * 3 - 0.9);
      }
    }
    mouth = quiet ? 0 : mouth + (target - mouth) * (target > mouth ? 0.52 : 0.4);
    mouthWidth = quiet ? 0 : mouthWidth + (widthTarget - mouthWidth) * 0.38;
    const speech = speakingPose(now, energy);
    const moving = Boolean(!quiet && speech) || pose.weight > 0 || blink !== 0 || mouth > 0.03 || Math.abs(mouthWidth) > 0.04;
    if (moving || paintedMotion) paint(pose, blink, quiet ? undefined : speech);
    paintedMotion = moving;
    requestAnimationFrame(draw);
  }

  function paint({ type, direction = 0, weight }, blink, speech) {
    face.clearRect(0, 0, canvas.width, canvas.height);
    face.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    const gaze = type === 'thought' ? direction * weight * 3.2 : 0;
    const eyelid = type === 'yawn' ? -1.35 * weight : type === 'thought' ? -0.42 * weight : 0;
    if (blink || eyelid || gaze) {
      const compression = Math.min(blink, eyelid);
      paintRegion(leftEye, compression, gaze);
      paintRegion(rightEye, compression, gaze);
    }
    const lipMovement = type === 'yawn' ? weight * 0.85 : mouth * 0.84;
    if (lipMovement > 0.02 || Math.abs(mouthWidth) > 0.04) {
      paintRegion(lips, lipMovement, 0, mouthWidth, mouth * 4.3);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (weight || speech) {
      const turn = direction * weight * (type === 'shift' ? 0.025 : 0.012) + (speech?.shoulderRoll || 0);
      ctx.translate(canvas.width / 2 + direction * weight * 3,
        canvas.height * 0.48 + weight * 2 - (speech?.shoulderLift || 0));
      ctx.rotate(turn);
      const zoom = 1 + weight * 0.012 + (speech?.zoom || 0);
      ctx.scale(zoom, zoom);
      ctx.translate(-canvas.width / 2, -canvas.height * 0.48);
    }
    if (speech) moveHead(speech);
    ctx.drawImage(speech ? posedPortrait : portrait, 0, 0);
    ctx.restore();
  }

  image.onload = () => requestAnimationFrame(draw);
  image.src = '/retrato.png';
  return {
    connect(node, poseAtTime) {
      analyser = node;
      waveform = node ? new Float32Array(node.fftSize) : undefined;
      spokenPose = node ? poseAtTime : undefined;
    }
  };
}
