import { createAudioMouth } from './lipsync.js';

const crop = { x: 178, y: 0, width: 1022, height: 1080 };
const leftEye = [531, 277, 70, 40, 18];
const rightEye = [716, 269, 69, 41, 18];
const mouthSeam = [[582, 448], [603, 451], [625, 450], [650, 450], [664, 450], [679, 447], [696, 446], [714, 446], [736, 442]];
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
  let readMouth;
  let mouth = 0;
  let mouthWidth = 0;
  let lastFrame;
  let voiceLevel = 0;
  let emphasisAt = 0;
  let nextEmphasis = 0;
  let speakingSince = 0;
  let speaking = false;
  let speakingDirection = 1;
  let paintedMotion = true;

  function paintRegion([x, y, width, height, center], compression, gaze) {
    for (let row = 0; row < height; row++) {
      const fade = Math.sin(Math.PI * row / height) ** 2;
      const sourceY = y + row - (row - center) * compression * fade;
      face.drawImage(image, x - gaze * fade, sourceY, width, 1.8,
        (x - crop.x) * scale, (y + row) * scale, width * scale, 1.8 * scale);
    }
  }

  function paintMouth(open, width) {
    const area = { left: 554, right: 766, top: 416, bottom: 515 };
    const [left, right] = [mouthSeam[0][0], mouthSeam.at(-1)[0]];
    const middle = (left + right) / 2;
    const slices = [];
    const sourceX = x => x - width * 0.17 * (x - middle) *
      Math.sin(Math.PI * (x - area.left) / (area.right - area.left)) ** 2;
    for (let x = area.left; x < area.right; x += 4) {
      const source = sourceX(x + 2);
      let seam = source < left ? mouthSeam[0][1] : mouthSeam.at(-1)[1];
      for (let index = 1; index < mouthSeam.length; index++) {
        const [from, y1] = mouthSeam[index - 1];
        const [to, y2] = mouthSeam[index];
        if (source >= from && source <= to) {
          seam = y1 + (y2 - y1) * (source - from) / (to - from);
          break;
        }
      }
      const position = (source - left) / (right - left);
      const contour = Math.sin(Math.PI * Math.max(0, Math.min(1, position))) ** 1.4;
      const opening = 38 * open * contour;
      slices.push({ x, seam, upper: seam - opening * 0.22, lower: seam + opening * 0.78 });
    }

    face.save();
    face.scale(scale, scale);
    face.translate(-crop.x, 0);
    const depth = face.createLinearGradient(0, 439, 0, 474);
    depth.addColorStop(0, '#60312d');
    depth.addColorStop(0.5, '#733c37');
    depth.addColorStop(1, '#a7685f');
    face.fillStyle = depth;
    face.beginPath();
    for (const slice of slices) face.lineTo(slice.x + 2, slice.upper - 0.65);
    for (const slice of slices.slice().reverse()) face.lineTo(slice.x + 2, slice.lower + 0.65);
    face.closePath();
    face.fill();

    for (const { x, seam, upper, lower } of slices) {
      const from = sourceX(x);
      const to = sourceX(Math.min(area.right, x + 4.35));
      const drawnWidth = Math.min(area.right - x, 4.35);
      face.drawImage(image, from, area.top, to - from, seam - area.top,
        x, area.top, drawnWidth, upper - area.top);
      face.drawImage(image, from, seam, to - from, area.bottom - seam,
        x, lower, drawnWidth, area.bottom - lower);
    }
    face.restore();
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
    if (energy < 0.004 && voiceLevel < 0.01) {
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
    const cue = !quiet && readMouth ? readMouth() : { energy: 0, open: 0, width: 0 };
    const engaged = cue.energy > 0.004 || isEngaged();
    const pose = restingPose(now, quiet || engaged);
    if (!blinkAt) blinkAt = now + 3000;
    const elapsed = now - blinkAt;
    if (elapsed > 160) blinkAt = now + 2300 + Math.random() * 3700;
    const blink = !quiet && elapsed >= 0 && elapsed < 160
      ? Math.sin(Math.PI * elapsed / 160) * -2.1 : 0;
    const frameTime = Math.min(48, now - (lastFrame ?? now - 16));
    lastFrame = now;
    const change = 1 - Math.exp(-frameTime / (cue.open > mouth ? 17 : 26));
    mouth = quiet ? 0 : mouth + (cue.open - mouth) * change;
    mouthWidth = quiet ? 0 : mouthWidth + (cue.width - mouthWidth) * (1 - Math.exp(-frameTime / 23));
    const speech = speakingPose(now, cue.energy);
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
    const lipMovement = type === 'yawn' ? weight * 0.76 : mouth;
    if (lipMovement > 0.02 || Math.abs(mouthWidth) > 0.04) {
      paintMouth(lipMovement, mouthWidth);
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
    connect(node, sampleRate) {
      readMouth = node ? createAudioMouth(node, sampleRate) : undefined;
    }
  };
}
