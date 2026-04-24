import { state } from './config.js';

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

        vec3 getGradientColor(vec2 uv, float time) {
          float r = uGradientSize;
          vec2 c1 = vec2(0.5 + sin(time * uSpeed * 0.4) * 0.4, 0.5 + cos(time * uSpeed * 0.5) * 0.4);
          vec2 c2 = vec2(0.5 + cos(time * uSpeed * 0.6) * 0.5, 0.5 + sin(time * uSpeed * 0.45) * 0.5);
          vec2 c3 = vec2(0.5 + sin(time * uSpeed * 0.35) * 0.45, 0.5 + cos(time * uSpeed * 0.55) * 0.45);
          vec2 c4 = vec2(0.5 + cos(time * uSpeed * 0.5) * 0.4, 0.5 + sin(time * uSpeed * 0.4) * 0.4);
          vec2 c5 = vec2(0.5 + sin(time * uSpeed * 0.7) * 0.35, 0.5 + cos(time * uSpeed * 0.6) * 0.35);
          vec2 c6 = vec2(0.5 + cos(time * uSpeed * 0.45) * 0.5, 0.5 + sin(time * uSpeed * 0.65) * 0.5);

          float i1 = 1.0 - smoothstep(0.0, r, length(uv - c1));
          float i2 = 1.0 - smoothstep(0.0, r, length(uv - c2));
          float i3 = 1.0 - smoothstep(0.0, r, length(uv - c3));
          float i4 = 1.0 - smoothstep(0.0, r, length(uv - c4));
          float i5 = 1.0 - smoothstep(0.0, r, length(uv - c5));
          float i6 = 1.0 - smoothstep(0.0, r, length(uv - c6));

          vec3 color = vec3(0.0);
          color += uColor1 * i1 * (0.55 + 0.45 * sin(time * uSpeed)) * uColor1Weight;
          color += uColor2 * i2 * (0.55 + 0.45 * cos(time * uSpeed * 1.2)) * uColor2Weight;
          color += uColor3 * i3 * (0.55 + 0.45 * sin(time * uSpeed * 0.8)) * uColor1Weight;
          color += uColor4 * i4 * (0.55 + 0.45 * cos(time * uSpeed * 1.3)) * uColor2Weight;
          color += uColor5 * i5 * (0.55 + 0.45 * sin(time * uSpeed * 1.1)) * uColor1Weight;
          color += uColor6 * i6 * (0.55 + 0.45 * cos(time * uSpeed * 0.9)) * uColor2Weight;

          color = clamp(color, 0.0, 1.0) * uIntensity;
          return mix(uDarkNavy, color, max(length(color) * 1.2, 0.15));
        }

        void main() {
          vec2 uv = vUv;
          vec4 touchTex = texture2D(uTouchTexture, uv);
          uv.x += -(touchTex.r * 2.0 - 1.0) * 0.8 * touchTex.b;
          uv.y += -(touchTex.g * 2.0 - 1.0) * 0.8 * touchTex.b;

          vec3 color = getGradientColor(uv, uTime);
          color += grain(uv, uTime) * uGrainIntensity;
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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.z = 50;
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();

    this.touchTexture = new TouchTexture();
    this.gradient = new GradientBackground(this);
    this.gradient.uniforms.uTouchTexture.value = this.touchTexture.texture;

    this.palettes = {
      cedar: {
        colors: [new THREE.Vector3(0.95, 0.45, 0.25), new THREE.Vector3(0.1, 0.3, 0.25), new THREE.Vector3(0.9, 0.8, 0.7)],
        base: new THREE.Vector3(0.1, 0.05, 0.02)
      },
      white: {
        colors: [new THREE.Vector3(0.1, 0.4, 0.8), new THREE.Vector3(0.4, 0.8, 1.0), new THREE.Vector3(0.9, 0.95, 1.0)],
        base: new THREE.Vector3(0.95, 0.97, 1.0)
      },
      dark: { // Scheme 5
        colors: [new THREE.Vector3(0.945, 0.353, 0.133), new THREE.Vector3(0.0, 0.259, 0.22), new THREE.Vector3(0, 0, 0)],
        base: new THREE.Vector3(0.01, 0.02, 0.05)
      },
      navy: { // Scheme 1
        colors: [new THREE.Vector3(0.945, 0.353, 0.133), new THREE.Vector3(0.039, 0.055, 0.153), new THREE.Vector3(0.1, 0.2, 0.4)],
        base: new THREE.Vector3(0.039, 0.055, 0.153)
      }
    };

    this.init();
  }

  init() {
    this.gradient.init();
    this.updateColors();
    this.tick();
    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("mousemove", (e) => this.onMouseMove(e));
  }

  updateColors() {
    const theme = state.theme === "rose" ? "cedar" : state.theme;
    const p = this.palettes[theme] || this.palettes.cedar;
    const u = this.gradient.uniforms;
    u.uColor1.value.copy(p.colors[0]);
    u.uColor2.value.copy(p.colors[1]);
    u.uColor3.value.copy(p.colors[2] || p.colors[0]);
    u.uColor4.value.copy(p.colors[0]);
    u.uColor5.value.copy(p.colors[1]);
    u.uColor6.value.copy(p.colors[2] || p.colors[1]);
    u.uDarkNavy.value.copy(p.base);

    if (theme === 'dark' || theme === 'navy') {
        u.uGradientSize.value = 0.45;
        u.uGradientCount.value = 12.0;
        u.uSpeed.value = 1.5;
        u.uColor1Weight.value = 0.5;
        u.uColor2Weight.value = 1.8;
    } else {
        u.uGradientSize.value = 1.0;
        u.uGradientCount.value = 6.0;
        u.uSpeed.value = 1.2;
        u.uColor1Weight.value = 1.0;
        u.uColor2Weight.value = 1.0;
    }
  }

  onMouseMove(e) {
    this.touchTexture.addTouch({ x: e.clientX / window.innerWidth, y: 1 - e.clientY / window.innerHeight });
  }

  getViewSize() {
    const fov = (this.camera.fov * Math.PI) / 180;
    const h = Math.abs(this.camera.position.z * Math.tan(fov / 2) * 2);
    return { width: h * this.camera.aspect, height: h };
  }

  tick() {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.touchTexture.update();
    this.gradient.update(delta);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.tick());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.gradient.onResize();
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
