import { state } from './config.js';

function hexToVector3(hex) {
  const normalized = typeof hex === "number"
    ? hex
    : Number.parseInt(String(hex).replace("#", ""), 16);

  return new THREE.Vector3(
    ((normalized >> 16) & 255) / 255,
    ((normalized >> 8) & 255) / 255,
    (normalized & 255) / 255
  );
}

class TouchTexture {
  constructor() {
    this.size = 64;
    this.width = this.height = this.size;
    this.maxAge = 64;
    this.radius = 0.25 * this.size;
    this.speed = 1 / this.maxAge;
    this.trail = [];
    this.last = null;
    this.initTexture();
  }

  initTexture() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture = new THREE.Texture(this.canvas);
  }

  update() {
    this.clear();
    let speed = this.speed;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const point = this.trail[i];
      let f = point.force * speed * (1 - point.age / this.maxAge);
      point.x += point.vx * f;
      point.y += point.vy * f;
      point.age++;
      if (point.age > this.maxAge) {
        this.trail.splice(i, 1);
      } else {
        this.drawPoint(point);
      }
    }
    this.texture.needsUpdate = true;
  }

  clear() {
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  addTouch(point) {
    let force = 0;
    let vx = 0;
    let vy = 0;
    const last = this.last;
    if (last) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (dx === 0 && dy === 0) return;
      const dd = dx * dx + dy * dy;
      let d = Math.sqrt(dd);
      vx = dx / d;
      vy = dy / d;
      force = Math.min(dd * 20000, 2.0);
    }
    this.last = { x: point.x, y: point.y };
    this.trail.push({ x: point.x, y: point.y, age: 0, force, vx, vy });
  }

  drawPoint(point) {
    const pos = { x: point.x * this.width, y: (1 - point.y) * this.height };
    let intensity = 1;
    if (point.age < this.maxAge * 0.3) {
      intensity = Math.sin((point.age / (this.maxAge * 0.3)) * (Math.PI / 2));
    } else {
      const t = 1 - (point.age - this.maxAge * 0.3) / (this.maxAge * 0.7);
      intensity = -t * (t - 2);
    }
    intensity *= point.force;

    const radius = this.radius;
    let color = `${((point.vx + 1) / 2) * 255}, ${((point.vy + 1) / 2) * 255}, ${intensity * 255}`;
    let offset = this.size * 5;
    this.ctx.shadowOffsetX = offset;
    this.ctx.shadowOffsetY = offset;
    this.ctx.shadowBlur = radius * 1;
    this.ctx.shadowColor = `rgba(${color},${0.2 * intensity})`;

    this.ctx.beginPath();
    this.ctx.fillStyle = "rgba(255,0,0,1)";
    this.ctx.arc(pos.x - offset, pos.y - offset, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }
}

class GradientBackground {
  constructor(app) {
    this.app = app;
    this.mesh = null;
    this.uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uColor1: { value: new THREE.Vector3(1, 1, 1) },
      uColor2: { value: new THREE.Vector3(1, 1, 1) },
      uColor3: { value: new THREE.Vector3(1, 1, 1) },
      uColor4: { value: new THREE.Vector3(1, 1, 1) },
      uColor5: { value: new THREE.Vector3(1, 1, 1) },
      uColor6: { value: new THREE.Vector3(1, 1, 1) },
      uSpeed: { value: 1.2 },
      uIntensity: { value: 1.8 },
      uTouchTexture: { value: null },
      uTouchStrength: { value: 0.8 },
      uGrainIntensity: { value: 0.08 },
      uDarkNavy: { value: new THREE.Vector3(0, 0, 0) },
      uGradientSize: { value: 1.0 },
      uGradientCount: { value: 6.0 },
      uColor1Weight: { value: 1.0 },
      uColor2Weight: { value: 1.0 }
    };
  }

  init() {
    const viewSize = this.app.getViewSize();
    const geometry = new THREE.PlaneGeometry(viewSize.width, viewSize.height, 1, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vUv = uv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec2 uResolution;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        uniform vec3 uColor3;
        uniform vec3 uColor4;
        uniform vec3 uColor5;
        uniform vec3 uColor6;
        uniform float uSpeed;
        uniform float uIntensity;
        uniform sampler2D uTouchTexture;
        uniform float uTouchStrength;
        uniform float uGrainIntensity;
        uniform vec3 uDarkNavy;
        uniform float uGradientSize;
        uniform float uGradientCount;
        uniform float uColor1Weight;
        uniform float uColor2Weight;
        varying vec2 vUv;

        float grain(vec2 uv, float time) {
          vec2 grainUv = uv * uResolution * 0.5;
          return fract(sin(dot(grainUv + time, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
        }

        vec2 rotateAroundCenter(vec2 point, float angle) {
          point -= 0.5;
          point = vec2(
            point.x * cos(angle) - point.y * sin(angle),
            point.x * sin(angle) + point.y * cos(angle)
          );
          return point + 0.5;
        }

        vec3 getGradientColor(vec2 uv, float time) {
          float gradientRadius = uGradientSize;

          vec2 c1 = vec2(0.5 + sin(time * uSpeed * 0.40) * 0.40, 0.5 + cos(time * uSpeed * 0.50) * 0.40);
          vec2 c2 = vec2(0.5 + cos(time * uSpeed * 0.60) * 0.50, 0.5 + sin(time * uSpeed * 0.45) * 0.50);
          vec2 c3 = vec2(0.5 + sin(time * uSpeed * 0.35) * 0.45, 0.5 + cos(time * uSpeed * 0.55) * 0.45);
          vec2 c4 = vec2(0.5 + cos(time * uSpeed * 0.50) * 0.40, 0.5 + sin(time * uSpeed * 0.40) * 0.40);
          vec2 c5 = vec2(0.5 + sin(time * uSpeed * 0.70) * 0.35, 0.5 + cos(time * uSpeed * 0.60) * 0.35);
          vec2 c6 = vec2(0.5 + cos(time * uSpeed * 0.45) * 0.50, 0.5 + sin(time * uSpeed * 0.65) * 0.50);
          vec2 c7 = vec2(0.5 + sin(time * uSpeed * 0.55) * 0.38, 0.5 + cos(time * uSpeed * 0.48) * 0.42);
          vec2 c8 = vec2(0.5 + cos(time * uSpeed * 0.65) * 0.36, 0.5 + sin(time * uSpeed * 0.52) * 0.44);
          vec2 c9 = vec2(0.5 + sin(time * uSpeed * 0.42) * 0.41, 0.5 + cos(time * uSpeed * 0.58) * 0.39);
          vec2 c10 = vec2(0.5 + cos(time * uSpeed * 0.48) * 0.37, 0.5 + sin(time * uSpeed * 0.62) * 0.43);
          vec2 c11 = vec2(0.5 + sin(time * uSpeed * 0.68) * 0.33, 0.5 + cos(time * uSpeed * 0.44) * 0.46);
          vec2 c12 = vec2(0.5 + cos(time * uSpeed * 0.38) * 0.39, 0.5 + sin(time * uSpeed * 0.56) * 0.41);

          float i1 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c1));
          float i2 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c2));
          float i3 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c3));
          float i4 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c4));
          float i5 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c5));
          float i6 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c6));
          float i7 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c7));
          float i8 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c8));
          float i9 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c9));
          float i10 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c10));
          float i11 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c11));
          float i12 = 1.0 - smoothstep(0.0, gradientRadius, length(uv - c12));

          vec2 rotatedUv1 = rotateAroundCenter(uv, time * uSpeed * 0.15);
          vec2 rotatedUv2 = rotateAroundCenter(uv, -time * uSpeed * 0.12);
          float radialInfluence1 = 1.0 - smoothstep(0.0, 0.8, length(rotatedUv1 - 0.5));
          float radialInfluence2 = 1.0 - smoothstep(0.0, 0.8, length(rotatedUv2 - 0.5));

          vec3 color = vec3(0.0);
          color += uColor1 * i1 * (0.55 + 0.45 * sin(time * uSpeed)) * uColor1Weight;
          color += uColor2 * i2 * (0.55 + 0.45 * cos(time * uSpeed * 1.20)) * uColor2Weight;
          color += uColor3 * i3 * (0.55 + 0.45 * sin(time * uSpeed * 0.80)) * uColor1Weight;
          color += uColor4 * i4 * (0.55 + 0.45 * cos(time * uSpeed * 1.30)) * uColor2Weight;
          color += uColor5 * i5 * (0.55 + 0.45 * sin(time * uSpeed * 1.10)) * uColor1Weight;
          color += uColor6 * i6 * (0.55 + 0.45 * cos(time * uSpeed * 0.90)) * uColor2Weight;

          if (uGradientCount > 6.0) {
            color += uColor1 * i7 * (0.55 + 0.45 * sin(time * uSpeed * 1.40)) * uColor1Weight;
            color += uColor2 * i8 * (0.55 + 0.45 * cos(time * uSpeed * 1.50)) * uColor2Weight;
            color += uColor3 * i9 * (0.55 + 0.45 * sin(time * uSpeed * 1.60)) * uColor1Weight;
            color += uColor4 * i10 * (0.55 + 0.45 * cos(time * uSpeed * 1.70)) * uColor2Weight;
          }

          if (uGradientCount > 10.0) {
            color += uColor5 * i11 * (0.55 + 0.45 * sin(time * uSpeed * 1.80)) * uColor1Weight;
            color += uColor6 * i12 * (0.55 + 0.45 * cos(time * uSpeed * 1.90)) * uColor2Weight;
          }

          color += mix(uColor1, uColor3, radialInfluence1) * 0.32 * uColor1Weight;
          color += mix(uColor2, uColor4, radialInfluence2) * 0.28 * uColor2Weight;

          color = clamp(color, 0.0, 1.0) * uIntensity;

          float luminance = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(vec3(luminance), color, 1.2);
          color = pow(color, vec3(0.94));

          float brightness = length(color);
          float mixFactor = max(brightness * 1.1, 0.12);
          color = mix(uDarkNavy, color, mixFactor);

          float maxBrightness = 1.0;
          if (brightness > maxBrightness) {
            color *= maxBrightness / brightness;
          }

          return clamp(color, 0.0, 1.0);
        }

        void main() {
          vec2 uv = vUv;
          vec4 touchTex = texture2D(uTouchTexture, uv);
          float vx = -(touchTex.r * 2.0 - 1.0);
          float vy = -(touchTex.g * 2.0 - 1.0);
          float touchIntensity = touchTex.b;

          uv += vec2(vx, vy) * (uTouchStrength * touchIntensity);

          float dist = length(uv - vec2(0.5));
          float ripple = sin(dist * 20.0 - uTime * 3.0) * 0.04 * touchIntensity * uTouchStrength;
          float wave = sin(dist * 15.0 - uTime * 2.0) * 0.03 * touchIntensity * (uTouchStrength * 0.8);
          uv += vec2(ripple + wave);

          vec3 color = getGradientColor(uv, uTime);
          color += grain(uv, uTime) * uGrainIntensity;

          float timeShift = uTime * 0.5;
          color.r += sin(timeShift) * 0.02;
          color.g += cos(timeShift * 1.4) * 0.02;
          color.b += sin(timeShift * 1.2) * 0.02;

          float brightness = length(color);
          float mixFactor = max(brightness * 1.1, 0.12);
          color = mix(uDarkNavy, color, mixFactor);

          gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
      `
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.app.scene.add(this.mesh);
  }

  update(delta) {
    this.uniforms.uTime.value += delta;
  }

  onResize() {
    const viewSize = this.app.getViewSize();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.PlaneGeometry(viewSize.width, viewSize.height, 1, 1);
    }
    this.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  }
}

class LiquidApp {
  constructor() {
    const container = document.getElementById("liquid-bg-container");
    if (!container) return;

    this.container = container;
    this.frameId = 0;
    this.animationEnabled = true;
    this.supported = true;

    const probeCanvas = document.createElement("canvas");
    const probeContext = probeCanvas.getContext("webgl2")
      || probeCanvas.getContext("webgl")
      || probeCanvas.getContext("experimental-webgl");

    if (!probeContext) {
      this.supported = false;
      this.renderer = null;
      this.camera = null;
      this.scene = null;
      this.clock = null;
      this.touchTexture = null;
      this.gradient = null;
      console.warn("Liquid background disabled: WebGL is not available in this browser.");
    }

    if (probeContext) {
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 50;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf4efe7);
        this.clock = new THREE.Clock();

        this.touchTexture = new TouchTexture();
        this.gradient = new GradientBackground(this);
        this.gradient.uniforms.uTouchTexture.value = this.touchTexture.texture;
      } catch (error) {
        this.supported = false;
        this.renderer = null;
        this.camera = null;
        this.scene = null;
        this.clock = null;
        this.touchTexture = null;
        this.gradient = null;
        console.warn("Liquid background disabled: unable to create WebGL context.", error);
      }
    }

    this.palettes = {
      cedar: {
        background: 0xf4efe7,
        base: hexToVector3(0xf8f2e8),
        colors: [
          hexToVector3(0xffafbd),
          hexToVector3(0xffc3a0),
          hexToVector3(0xff9a9e),
          hexToVector3(0xfecfef),
          hexToVector3(0xa18cd1),
          hexToVector3(0xfad0c4)
        ],
        settings: {
          speed: 0.4,
          intensity: 1.3,
          grainIntensity: 0.02,
          gradientSize: 0.8,
          gradientCount: 6.0,
          color1Weight: 1.0,
          color2Weight: 1.0,
          touchStrength: 0.3
        }
      },
      white: {
        background: 0xf0f4fa,
        base: hexToVector3(0xf5f8ff),
        colors: [
          hexToVector3(0x84fab0),
          hexToVector3(0x8fd3f4),
          hexToVector3(0xa1c4fd),
          hexToVector3(0xc2e9fb),
          hexToVector3(0xcfd9df),
          hexToVector3(0xe2ebf0)
        ],
        settings: {
          speed: 0.4,
          intensity: 1.3,
          grainIntensity: 0.015,
          gradientSize: 0.8,
          gradientCount: 6.0,
          color1Weight: 1.0,
          color2Weight: 1.0,
          touchStrength: 0.2
        }
      },
      dark: {
        background: 0x0a0e27,
        base: hexToVector3(0x0a0e27),
        colors: [
          hexToVector3(0xf15a22),
          hexToVector3(0x004238),
          hexToVector3(0xf15a22),
          hexToVector3(0x000000),
          hexToVector3(0xf15a22),
          hexToVector3(0x000000)
        ],
        settings: {
          speed: 1.5,
          intensity: 1.8,
          grainIntensity: 0.08,
          gradientSize: 0.45,
          gradientCount: 12.0,
          color1Weight: 0.5,
          color2Weight: 1.8,
          touchStrength: 0.8
        }
      },
      navy: {
        background: 0x0a0e27,
        base: hexToVector3(0x0a0e27),
        colors: [
          hexToVector3(0xf15a22),
          hexToVector3(0x0a0e27),
          hexToVector3(0xf15a22),
          hexToVector3(0x0a0e27),
          hexToVector3(0xf15a22),
          hexToVector3(0x0a0e27)
        ],
        settings: {
          speed: 1.5,
          intensity: 1.8,
          grainIntensity: 0.08,
          gradientSize: 0.45,
          gradientCount: 12.0,
          color1Weight: 0.5,
          color2Weight: 1.8,
          touchStrength: 0.8
        }
      }
    };

    this.init();
  }

  init() {
    if (!this.supported) {
      this.setAnimationEnabled(state.backgroundAnimation);
      return;
    }

    this.gradient.init();
    this.updateColors();
    this.setAnimationEnabled(state.backgroundAnimation);
    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("mousemove", (e) => this.onMouseMove(e));
  }

  updateColors() {
    if (!this.supported || !this.gradient || !this.scene) {
      return;
    }

    const theme = state.theme === "rose" ? "cedar" : state.theme;
    const p = this.palettes[theme] || this.palettes.cedar;
    const u = this.gradient.uniforms;
    const colors = p.colors;

    u.uColor1.value.copy(colors[0]);
    u.uColor2.value.copy(colors[1]);
    u.uColor3.value.copy(colors[2] || colors[0]);
    u.uColor4.value.copy(colors[3] || colors[1] || colors[0]);
    u.uColor5.value.copy(colors[4] || colors[2] || colors[0]);
    u.uColor6.value.copy(colors[5] || colors[3] || colors[1] || colors[0]);
    u.uDarkNavy.value.copy(p.base);
    this.scene.background = new THREE.Color(p.background);

    u.uSpeed.value = p.settings.speed;
    u.uIntensity.value = p.settings.intensity;
    u.uGrainIntensity.value = p.settings.grainIntensity;
    u.uGradientSize.value = p.settings.gradientSize;
    u.uGradientCount.value = p.settings.gradientCount;
    u.uColor1Weight.value = p.settings.color1Weight;
    u.uColor2Weight.value = p.settings.color2Weight;
    u.uTouchStrength.value = p.settings.touchStrength;
  }

  onMouseMove(e) {
    if (!this.supported || !this.animationEnabled) {
      return;
    }
    this.touchTexture.addTouch({ x: e.clientX / window.innerWidth, y: 1 - e.clientY / window.innerHeight });
  }

  getViewSize() {
    const fov = (this.camera.fov * Math.PI) / 180;
    const h = Math.abs(this.camera.position.z * Math.tan(fov / 2) * 2);
    return { width: h * this.camera.aspect, height: h };
  }

  renderFrame() {
    if (!this.supported || !this.renderer || !this.touchTexture || !this.gradient || !this.camera || !this.scene) {
      return;
    }

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.touchTexture.update();
    this.gradient.update(delta);
    this.renderer.render(this.scene, this.camera);
  }

  startLoop() {
    if (this.frameId) {
      return;
    }

    const step = () => {
      if (!this.animationEnabled) {
        this.frameId = 0;
        return;
      }
      this.renderFrame();
      this.frameId = requestAnimationFrame(step);
    };

    this.frameId = requestAnimationFrame(step);
  }

  stopLoop() {
    if (!this.frameId) {
      return;
    }
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
  }

  setAnimationEnabled(enabled) {
    this.animationEnabled = enabled !== false;
    this.container.hidden = !this.animationEnabled;

    if (!this.supported) {
      return;
    }

    if (!this.animationEnabled) {
      this.stopLoop();
      return;
    }

    this.clock.getDelta();
    this.renderFrame();
    this.startLoop();
  }

  onResize() {
    if (!this.supported || !this.renderer || !this.camera || !this.gradient) {
      return;
    }

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.gradient.onResize();
    if (this.animationEnabled) {
      this.renderFrame();
    }
  }
}

let appInstance = null;

export const initBackground = () => {
  if (!appInstance) {
    appInstance = new LiquidApp();
  }
};

export const updateBackground = () => {
  if (appInstance) {
    appInstance.updateColors();
  }
};

export const setBackgroundAnimationEnabled = (enabled) => {
  if (appInstance) {
    appInstance.setAnimationEnabled(enabled);
  }
};
