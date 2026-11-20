export function createAvatar(canvas) {
  const ctx = canvas.getContext('2d');
  const image = new Image();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const crop = { x: 222, y: 0, width: 880, height: 930 };
  let blinkAt = 0;
  let analyser;
  let waveform;
  let mouth = 0;

  function paintRegion(x, y, width, height, center, amount) {
    const scale = canvas.width / crop.width;
    for (let row = 0; row < height; row++) {
      const position = row / height;
      const fade = Math.sin(Math.PI * position) ** 2;
      const sourceY = y + row - (row - center) * fade * amount;
      ctx.drawImage(image, x, sourceY, width, 1.8,
        (x - crop.x) * scale, (y + row) * scale, width * scale, 1.8 * scale);
    }
  }

  function draw(now) {
    if (!blinkAt) blinkAt = now + 3000;
    const elapsed = now - blinkAt;
    if (elapsed > 160) blinkAt = now + 2300 + Math.random() * 3700;
    let target = 0;
    if (analyser && !reducedMotion.matches) {
      analyser.getFloatTimeDomainData(waveform);
      let energy = 0;
      for (const sample of waveform) energy += sample * sample;
      target = Math.min(1, Math.max(0, Math.sqrt(energy / waveform.length) * 7 - 0.07));
    }
    mouth += (target - mouth) * (target > mouth ? 0.45 : 0.35);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    if (!reducedMotion.matches && elapsed >= 0 && elapsed < 160) {
      const blink = Math.sin(Math.PI * elapsed / 160) * -2.1;
      paintRegion(531, 277, 70, 40, 18, blink);
      paintRegion(716, 269, 69, 41, 18, blink);
    }
    if (mouth > 0.03) paintRegion(569, 419, 177, 75, 32, mouth * 0.71);
    requestAnimationFrame(draw);
  }

  image.onload = () => requestAnimationFrame(draw);
  image.src = '/retrato.png';
  return {
    connect(node) {
      analyser = node;
      waveform = node ? new Float32Array(node.fftSize) : undefined;
    }
  };
}
