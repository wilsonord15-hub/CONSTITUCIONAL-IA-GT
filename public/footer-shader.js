const canvas = document.querySelector('.footer-wave');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let inView = false;
let setActive;
let loading = false;

// Adapted from Ali Imam's WebGL Shader example for a shallow, blue footer.
const fragmentShader = `
  precision highp float;
  uniform vec2 resolution;
  uniform float time;

  float beam(float distance, float width) {
    return width / (width + distance * distance);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= clamp(resolution.x / resolution.y, 2.7, 5.0) * 0.67;
    float spread = length(p) * 0.055;
    float phase = time * 0.32 + 1.35;
    float height = p.y + 0.27;
    float ice = height - sin(p.x * (1.0 + spread) + phase) * 0.34;
    float blue = height - sin(p.x + phase) * 0.34;
    float violet = height - sin(p.x * (1.0 - spread) + phase) * 0.34;
    vec3 color = vec3(0.11, 0.42, 0.62) * beam(ice, 0.0013);
    color += vec3(0.10, 0.28, 0.54) * beam(blue, 0.0009);
    color += vec3(0.19, 0.16, 0.45) * beam(violet, 0.0008);
    color += vec3(0.20, 0.33, 0.47) * beam(blue, 0.014) * 0.50;
    float brightness = max(color.r, max(color.g, color.b));
    float fade = smoothstep(0.0, 0.12, uv.y) * smoothstep(0.0, 0.12, 1.0 - uv.y);
    gl_FragColor = vec4(color / max(brightness, 0.001), min(brightness, 1.0) * fade);
  }
`;

async function createWave() {
  const context = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: false, antialias: false, powerPreference: 'low-power'
  });
  if (!context) return;

  const { WebGLRenderer, Scene, Camera, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } =
    await import('./three.module.js');
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, premultipliedAlpha: false });
  const scene = new Scene();
  const camera = new Camera();
  const uniforms = { resolution: { value: new Vector2() }, time: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader
  });
  const wave = new Mesh(new PlaneGeometry(2, 2), material);
  wave.frustumCulled = false;
  scene.add(wave);

  let frame;
  let previousTime;
  let active = false;
  let contextLost = false;
  let needsResize = true;
  new ResizeObserver(() => { needsResize = true; }).observe(canvas.parentElement);

  function draw(timestamp) {
    if (needsResize) {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25, 1100 / width));
      renderer.setSize(width, height, false);
      renderer.getDrawingBufferSize(uniforms.resolution.value);
      needsResize = false;
    }
    if (previousTime !== undefined) uniforms.time.value += Math.min((timestamp - previousTime) / 1000, 0.05);
    previousTime = timestamp;
    renderer.render(scene, camera);
    if (!canvas.hasAttribute('data-rendered')) canvas.dataset.rendered = '';
    frame = requestAnimationFrame(draw);
  }

  function sync() {
    if (active && !contextLost) {
      frame ??= requestAnimationFrame(draw);
    } else {
      cancelAnimationFrame(frame);
      frame = undefined;
      previousTime = undefined;
    }
  }

  canvas.addEventListener('webglcontextlost', () => {
    contextLost = true;
    delete canvas.dataset.rendered;
    sync();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    needsResize = true;
    sync();
  });
  return playing => {
    active = playing;
    sync();
  };
}

function update() {
  const playing = inView && !motion.matches && !document.hidden;
  if (setActive) {
    setActive(playing);
  } else if (playing && !loading) {
    loading = true;
    createWave().then(wave => {
      setActive = wave;
      update();
    }).catch(() => {
      // The footer's CSS background also covers browsers without WebGL.
    });
  }
}

if (canvas) {
  const observer = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    update();
  });
  observer.observe(canvas.parentElement);
  motion.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
}
