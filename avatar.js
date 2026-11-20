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
  const image = new Image();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scale = canvas.width / crop.width;
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
  let paintedMotion = true;

  function paintRegion([x, y, width, height, center], compression, gaze = 0, stretch = 0) {
    for (let row = 0; row < height; row++) {
      const fade = Math.sin(Math.PI * row / height) ** 2;
      const sourceY = y + row - (row - center) * fade * compression;
      const segments = Math.abs(stretch) > 0.04 ? 5 : 1;
      for (let column = 0; column < segments; column++) {
        const left = column / segments;
        const right = (column + 1) / segments;
        const sourceLeft = x + width * left + Math.sin(2 * Math.PI * left) * stretch * fade * 8;
        const sourceRight = x + width * right + Math.sin(2 * Math.PI * right) * stretch * fade * 8;
        ctx.drawImage(image, sourceLeft - gaze * fade, sourceY, sourceRight - sourceLeft, 1.8,
          (x + width * left - crop.x) * scale, (y + row) * scale, width * (right - left) * scale, 1.8 * scale);
      }
    }
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
    if (analyser && !quiet) {
      const face = spokenPose?.();
      if (face) {
        target = face.open;
        widthTarget = face.width;
      } else {
        analyser.getFloatTimeDomainData(waveform);
        let energy = 0;
        for (const sample of waveform) energy += sample * sample;
        target = Math.min(1, Math.max(0, Math.sqrt(energy / waveform.length) * 7 - 0.07));
      }
    }
    mouth = quiet ? 0 : mouth + (target - mouth) * (target > mouth ? 0.45 : 0.35);
    mouthWidth = quiet ? 0 : mouthWidth + (widthTarget - mouthWidth) * 0.38;
    const moving = pose.weight > 0 || blink !== 0 || mouth > 0.03 || Math.abs(mouthWidth) > 0.04;
    if (moving || paintedMotion) paint(pose, blink);
    paintedMotion = moving;
    requestAnimationFrame(draw);
  }

  function paint({ type, direction = 0, weight }, blink) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (weight) {
      const turn = direction * weight * (type === 'shift' ? 0.025 : 0.012);
      ctx.translate(canvas.width / 2 + direction * weight * 3, canvas.height * 0.48 + weight * 2);
      ctx.rotate(turn);
      ctx.scale(1 + weight * 0.012, 1 + weight * 0.012);
      ctx.translate(-canvas.width / 2, -canvas.height * 0.48);
    }
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    const gaze = type === 'thought' ? direction * weight * 3.2 : 0;
    const eyelid = type === 'yawn' ? -1.35 * weight : type === 'thought' ? -0.42 * weight : 0;
    if (blink || eyelid || gaze) {
      const compression = Math.min(blink, eyelid);
      paintRegion(leftEye, compression, gaze);
      paintRegion(rightEye, compression, gaze);
    }
    const lipMovement = type === 'yawn' ? weight * 0.85 : mouth * 0.71;
    if (lipMovement > 0.02 || Math.abs(mouthWidth) > 0.04) paintRegion(lips, lipMovement, 0, mouthWidth);
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
