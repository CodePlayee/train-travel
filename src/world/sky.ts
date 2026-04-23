import * as THREE from 'three';

const VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uElapsed;
  uniform vec3 uSunDir;
  varying vec3 vWorldPosition;

  // --- Color palettes ---
  vec3 dayTop = vec3(0.25, 0.48, 0.88);
  vec3 dayHorizon = vec3(0.55, 0.72, 0.92);
  vec3 sunsetTop = vec3(0.18, 0.12, 0.38);
  vec3 sunsetHorizon = vec3(0.92, 0.38, 0.12);
  vec3 nightTop = vec3(0.01, 0.01, 0.06);
  vec3 nightHorizon = vec3(0.04, 0.04, 0.12);

  // --- Simplex-style hash for procedural clouds ---
  vec3 hash3(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123);
  }

  float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = mix(
      mix(
        mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
            dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), f.x),
        mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
            dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), f.x), f.y),
      mix(
        mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
            dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), f.x),
        mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
            dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), f.x), f.y),
      f.z);
    return n * 0.5 + 0.5;
  }

  float fbm(vec3 p) {
    float val = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      val += amp * noise3D(p);
      p *= 2.1;
      amp *= 0.5;
    }
    return val;
  }

  void main() {
    vec3 dir = normalize(vWorldPosition);
    float elevation = dir.y;

    float t = uTime;
    vec3 topColor, horizonColor;

    if (t < 0.2) {
      topColor = nightTop;
      horizonColor = nightHorizon;
    } else if (t < 0.3) {
      float f = (t - 0.2) / 0.1;
      topColor = mix(nightTop, sunsetTop, f);
      horizonColor = mix(nightHorizon, sunsetHorizon, f);
    } else if (t < 0.4) {
      float f = (t - 0.3) / 0.1;
      topColor = mix(sunsetTop, dayTop, f);
      horizonColor = mix(sunsetHorizon, dayHorizon, f);
    } else if (t < 0.65) {
      topColor = dayTop;
      horizonColor = dayHorizon;
    } else if (t < 0.75) {
      float f = (t - 0.65) / 0.1;
      topColor = mix(dayTop, sunsetTop, f);
      horizonColor = mix(dayHorizon, sunsetHorizon, f);
    } else if (t < 0.85) {
      float f = (t - 0.75) / 0.1;
      topColor = mix(sunsetTop, nightTop, f);
      horizonColor = mix(sunsetHorizon, nightHorizon, f);
    } else {
      topColor = nightTop;
      horizonColor = nightHorizon;
    }

    float h = max(elevation, 0.0);
    vec3 color = mix(horizonColor, topColor, pow(h, 0.45));

    // --- Atmospheric scattering (Rayleigh-like) ---
    float sunDot = max(dot(dir, uSunDir), 0.0);

    // Sun disc with soft edge
    float sunDisc = smoothstep(0.997, 0.999, sunDot);
    color += vec3(1.0, 0.95, 0.8) * sunDisc * 2.0;

    // Sun glow halo (outer)
    color += vec3(1.0, 0.8, 0.4) * pow(sunDot, 64.0) * 0.9;
    // Sun scattering (wide warm glow near horizon)
    color += vec3(1.0, 0.55, 0.15) * pow(sunDot, 6.0) * 0.12;

    // Moon glow
    vec3 moonDir = -uSunDir;
    float moonDot = max(dot(dir, moonDir), 0.0);
    float moonDisc = smoothstep(0.998, 0.9995, moonDot);
    color += vec3(0.8, 0.85, 1.0) * moonDisc * 0.8;
    color += vec3(0.5, 0.55, 0.7) * pow(moonDot, 32.0) * 0.15;

    // --- Procedural clouds ---
    // Only render clouds above horizon
    if (elevation > 0.02) {
      // Project onto a dome surface for cloud UVs
      vec2 cloudUV = dir.xz / (dir.y + 0.1) * 0.3;
      vec3 cloudPos = vec3(cloudUV * 3.0 + uElapsed * 0.008, uElapsed * 0.003);

      float cloudDensity = fbm(cloudPos);
      // Shape clouds: threshold + soft edge
      cloudDensity = smoothstep(0.42, 0.7, cloudDensity);
      // Fade clouds near horizon to prevent hard cutoff
      float horizonFade = smoothstep(0.02, 0.2, elevation);
      cloudDensity *= horizonFade;

      // Cloud color: bright during day, dark at night, orange at sunset
      float dayFactor = smoothstep(0.3, 0.45, t) - smoothstep(0.65, 0.85, t);
      float sunsetFactor = smoothstep(0.2, 0.3, t) * (1.0 - smoothstep(0.35, 0.45, t))
                         + smoothstep(0.65, 0.75, t) * (1.0 - smoothstep(0.8, 0.9, t));

      vec3 cloudDayColor = vec3(0.95, 0.95, 0.97);
      vec3 cloudSunsetColor = vec3(1.0, 0.6, 0.3);
      vec3 cloudNightColor = vec3(0.08, 0.08, 0.14);

      vec3 cloudColor = mix(cloudNightColor, cloudDayColor, dayFactor);
      cloudColor = mix(cloudColor, cloudSunsetColor, sunsetFactor * 0.7);

      // Sun-lit edge highlight on clouds
      float sunHighlight = pow(sunDot, 4.0) * 0.3 * dayFactor;
      cloudColor += vec3(1.0, 0.9, 0.7) * sunHighlight;

      color = mix(color, cloudColor, cloudDensity * 0.75);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

// Star vertex shader with twinkle
const STAR_VERTEX_SHADER = `
  attribute float aTwinkleSpeed;
  attribute float aTwinklePhase;
  attribute float aSize;
  uniform float uElapsed;
  varying float vBrightness;

  void main() {
    // Twinkle: combine two sine waves for natural flicker
    float twinkle = sin(uElapsed * aTwinkleSpeed + aTwinklePhase) * 0.3
                  + sin(uElapsed * aTwinkleSpeed * 1.7 + aTwinklePhase * 2.3) * 0.2;
    vBrightness = 0.5 + twinkle;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_FRAGMENT_SHADER = `
  varying float vBrightness;
  uniform float uOpacity;

  void main() {
    // Soft circular point
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, dist);

    // Color variation: slight blue/warm tint based on brightness
    vec3 starColor = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.95, 0.85), vBrightness);
    gl_FragColor = vec4(starColor * vBrightness, alpha * uOpacity);
  }
`;

export interface SkyState {
  dayTime: number;
}

export class SkySystem {
  private skyDome: THREE.Mesh;
  private starField: THREE.Points;
  private moonLight: THREE.DirectionalLight;
  private dayTime = 0.25; // Start at sunrise
  private elapsed = 0;
  private paused = false;
  private readonly cycleDuration = 180; // seconds

  constructor(
    private scene: THREE.Scene,
    private sunLight: THREE.DirectionalLight,
    private ambientLight: THREE.AmbientLight,
    private renderer: THREE.WebGLRenderer,
  ) {
    // Sky dome
    const skyGeo = new THREE.SphereGeometry(500, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.25 },
        uElapsed: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this.skyDome);

    // Stars with twinkle
    const starCount = 800;
    const starGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const twinkleSpeeds: number[] = [];
    const twinklePhases: number[] = [];
    const sizes: number[] = [];

    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = 450;
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.abs(Math.cos(phi)),
        r * Math.sin(phi) * Math.sin(theta),
      );
      twinkleSpeeds.push(1.5 + Math.random() * 3.0);
      twinklePhases.push(Math.random() * Math.PI * 2);
      sizes.push(0.8 + Math.random() * 2.0);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    starGeo.setAttribute('aTwinkleSpeed', new THREE.Float32BufferAttribute(twinkleSpeeds, 1));
    starGeo.setAttribute('aTwinklePhase', new THREE.Float32BufferAttribute(twinklePhases, 1));
    starGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    const starMat = new THREE.ShaderMaterial({
      uniforms: {
        uElapsed: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: STAR_VERTEX_SHADER,
      fragmentShader: STAR_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.starField = new THREE.Points(starGeo, starMat);
    scene.add(this.starField);

    // Moonlight
    this.moonLight = new THREE.DirectionalLight(0x6688cc, 0);
    scene.add(this.moonLight);

    // Enable shadow maps on sun light
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    const shadowCam = this.sunLight.shadow.camera;
    shadowCam.near = 1;
    shadowCam.far = 300;
    shadowCam.left = -60;
    shadowCam.right = 60;
    shadowCam.top = 60;
    shadowCam.bottom = -60;
    this.sunLight.shadow.bias = -0.002;
    this.sunLight.shadow.normalBias = 0.02;
  }

  update(dt: number): SkyState {
    if (!this.paused) {
      this.dayTime = (this.dayTime + dt / this.cycleDuration) % 1;
    }
    this.elapsed += dt;

    const sunAngle = this.dayTime * Math.PI * 2 - Math.PI / 2;
    const sunY = Math.sin(sunAngle) * 300;
    const sunZ = Math.cos(sunAngle) * 300;

    const sunDir = new THREE.Vector3(0, sunY, sunZ).normalize();
    const skyMat = this.skyDome.material as THREE.ShaderMaterial;
    skyMat.uniforms.uTime.value = this.dayTime;
    skyMat.uniforms.uElapsed.value = this.elapsed;
    skyMat.uniforms.uSunDir.value.copy(sunDir);

    // Update star twinkle time
    const starMat = this.starField.material as THREE.ShaderMaterial;
    starMat.uniforms.uElapsed.value = this.elapsed;

    // Stars fade in/out
    const nightness = Math.max(0, -Math.sin(sunAngle));
    starMat.uniforms.uOpacity.value = nightness;

    // Directional light
    const dayFactor = Math.max(0, Math.sin(sunAngle));
    this.sunLight.position.copy(sunDir.clone().multiplyScalar(100));
    this.sunLight.intensity = 0.2 + dayFactor * 1.3;
    this.ambientLight.intensity = 0.15 + dayFactor * 0.35;

    // Only enable shadow maps during daytime for performance
    this.sunLight.castShadow = dayFactor > 0.1;

    // Moonlight -- opposite to sun, active at night
    const moonDir = new THREE.Vector3(0, -sunY, -sunZ).normalize();
    this.moonLight.position.copy(moonDir.clone().multiplyScalar(100));
    const nightFactor = Math.max(0, -Math.sin(sunAngle));
    this.moonLight.intensity = nightFactor * 0.6;
    this.ambientLight.intensity += nightFactor * 0.12;

    // Light color shifts
    if (this.dayTime > 0.2 && this.dayTime < 0.35) {
      this.sunLight.color.setRGB(1.0, 0.7, 0.4);
    } else if (this.dayTime > 0.65 && this.dayTime < 0.8) {
      this.sunLight.color.setRGB(1.0, 0.6, 0.3);
    } else if (dayFactor > 0.1) {
      this.sunLight.color.setRGB(1.0, 0.98, 0.9);
    } else {
      this.sunLight.color.setRGB(0.3, 0.35, 0.5);
    }

    // Fog color (matches horizon)
    const fogDay = new THREE.Color(0.55, 0.72, 0.92);
    const fogSunset = new THREE.Color(0.6, 0.38, 0.25);
    const fogNight = new THREE.Color(0.04, 0.04, 0.1);
    let fogColor: THREE.Color;

    if (dayFactor > 0.3) {
      fogColor = fogDay;
    } else if (this.dayTime > 0.2 && this.dayTime < 0.4) {
      fogColor = fogSunset.clone().lerp(fogDay, (this.dayTime - 0.2) / 0.2);
    } else if (this.dayTime > 0.65 && this.dayTime < 0.85) {
      fogColor = fogDay.clone().lerp(fogSunset, (this.dayTime - 0.65) / 0.2);
    } else {
      fogColor = fogNight;
    }

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(fogColor);
    }
    this.renderer.setClearColor(fogColor);

    // Adjust tone mapping exposure based on time of day
    const exposure = 0.8 + dayFactor * 0.5 + nightFactor * 0.1;
    this.renderer.toneMappingExposure = exposure;

    return { dayTime: this.dayTime };
  }

  setDayTime(t: number): void {
    this.dayTime = ((t % 1) + 1) % 1;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }
}
