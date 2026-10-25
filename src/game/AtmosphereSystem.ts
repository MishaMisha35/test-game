import * as THREE from "three";

export type AtmosphereQuality = "low" | "medium" | "high" | "ultra";
const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;

/** A continuous 20-minute sky clock. All sky elements follow the view; terrain never moves. */
export class AtmosphereSystem {
  readonly sunOffset = new THREE.Vector3(-60, 30, -28);
  private clockHour = 17.4;
  private preset: AtmosphereQuality = "high";
  private readonly skyRoot = new THREE.Group();
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly hemisphere = new THREE.HemisphereLight(
    "#c8d9d0",
    "#454a35",
    1.5,
  );
  private readonly moonLight = new THREE.DirectionalLight("#91b8ed", 0);
  private readonly sunDisc: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshBasicMaterial
  >;
  private readonly moonDisc: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshBasicMaterial
  >;
  private readonly sunHalo: THREE.Sprite;
  private readonly stars: THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >;
  private readonly fog = new THREE.Fog("#c8c9b0", 40, 165);
  private readonly direction = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3();
  private readonly topColor = new THREE.Color();
  private readonly horizonColor = new THREE.Color();
  private readonly fogColor = new THREE.Color();
  private readonly dayTop = new THREE.Color("#709ba5");
  private readonly nightTop = new THREE.Color("#10192e");
  private readonly dayHorizon = new THREE.Color("#cbd6c7");
  private readonly nightHorizon = new THREE.Color("#263b51");
  private readonly goldenHorizon = new THREE.Color("#e5c89b");
  private readonly duskHorizon = new THREE.Color("#b48b83");
  private readonly daytimeFog = new THREE.Color("#b9c7b3");
  private readonly nighttimeFog = new THREE.Color("#22394a");
  private readonly goldenFog = new THREE.Color("#c8bea0");
  private readonly whiteSun = new THREE.Color("#fff0d0");
  private readonly warmSun = new THREE.Color("#ffc484");
  private readonly groundDay = new THREE.Color("#4b5037");
  private readonly groundNight = new THREE.Color("#192831");

  constructor(
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
  ) {
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        duskColor: { value: new THREE.Color("#efbd8c") },
        sunDirection: { value: this.direction },
        sunset: { value: 0.5 },
      },
      vertexShader: `varying vec3 skyDirection;
        void main(){skyDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 skyDirection;
        uniform vec3 top;uniform vec3 horizon;uniform vec3 duskColor;
        uniform vec3 sunDirection;uniform float sunset;
        void main(){vec3 ray=normalize(skyDirection);float height=pow(clamp(ray.y,0.,1.),.56);
          vec3 sky=mix(horizon,top,height);
          float glow=pow(max(0.,dot(ray,sunDirection)),5.)*sunset;
          sky=mix(sky,duskColor,glow*.25);
          gl_FragColor=vec4(sky,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(320, 32, 16),
      this.skyMaterial,
    );
    dome.frustumCulled = false;
    dome.renderOrder = -100;
    this.skyRoot.add(dome);
    const sphere = new THREE.SphereGeometry(1, 20, 12);
    this.sunDisc = new THREE.Mesh(
      sphere,
      new THREE.MeshBasicMaterial({
        color: "#fff0c9",
        fog: false,
        transparent: true,
      }),
    );
    this.sunDisc.scale.setScalar(4.1);
    this.skyRoot.add(this.sunDisc);
    this.moonDisc = new THREE.Mesh(
      sphere,
      new THREE.MeshBasicMaterial({
        color: "#d8e8ed",
        fog: false,
        transparent: true,
      }),
    );
    this.moonDisc.scale.setScalar(2.6);
    this.skyRoot.add(this.moonDisc);
    this.sunHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.radialTexture(),
        color: "#ffc88e",
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        opacity: 0.25,
      }),
    );
    this.sunHalo.scale.set(34, 34, 1);
    this.skyRoot.add(this.sunHalo);
    const starPositions = new Float32Array(1200 * 3);
    const starColors = new Float32Array(1200 * 3);
    let seed = 80477;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    const color = new THREE.Color();
    for (let i = 0; i < 1200; i++) {
      const azimuth = random() * TAU,
        y = 0.08 + random() * 0.92,
        r = Math.sqrt(1 - y * y);
      starPositions[i * 3] = Math.cos(azimuth) * r * 300;
      starPositions[i * 3 + 1] = y * 300;
      starPositions[i * 3 + 2] = Math.sin(azimuth) * r * 300;
      color
        .setHSL(
          0.53 + random() * 0.12,
          0.15 + random() * 0.25,
          0.65 + random() * 0.3,
        )
        .toArray(starColors, i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3),
    );
    starGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(starColors, 3),
    );
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 0.5,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        opacity: 0,
      }),
    );
    this.stars.frustumCulled = false;
    this.skyRoot.add(this.stars);
    this.moonLight.castShadow = false;
    scene.add(
      this.skyRoot,
      this.hemisphere,
      this.moonLight,
      this.moonLight.target,
    );
    scene.fog = this.fog;
    this.setQuality("high");
    this.update(0, 0, new THREE.Vector3());
  }

  get hour(): number {
    return this.clockHour;
  }

  setQuality(preset: AtmosphereQuality): void {
    this.preset = preset;
    this.stars.geometry.setDrawRange(
      0,
      { low: 160, medium: 400, high: 800, ultra: 1200 }[preset],
    );
    this.sunHalo.visible = preset === "high" || preset === "ultra";
  }

  update(_dt: number, time: number, cameraPos: THREE.Vector3): void {
    this.clockHour = (17.4 + (Math.max(0, time) * 24) / 1200) % 24;
    const angle = ((this.clockHour - 6) * TAU) / 24;
    const elevation = (Math.sin(angle) + 0.22) / 1.22;
    this.direction.set(Math.cos(angle), elevation, -0.36).normalize();
    this.moonDirection.copy(this.direction).negate();
    this.sunOffset.copy(this.direction).multiplyScalar(78);
    const daylight = smooth(elevation, -0.1, 0.16);
    const night = 1 - smooth(elevation, -0.2, 0.02);
    const golden = (1 - smooth(Math.abs(elevation), 0.15, 0.7)) * daylight;
    const twilight =
      (1 - smooth(Math.abs(elevation), 0.03, 0.25)) * (1 - daylight * 0.6);
    this.topColor.copy(this.nightTop).lerp(this.dayTop, daylight);
    this.horizonColor
      .copy(this.nightHorizon)
      .lerp(this.dayHorizon, daylight)
      .lerp(this.goldenHorizon, golden * 0.72)
      .lerp(this.duskHorizon, twilight * 0.45);
    this.fogColor
      .copy(this.nighttimeFog)
      .lerp(this.daytimeFog, daylight)
      .lerp(this.goldenFog, golden * 0.52);
    this.skyMaterial.uniforms.top.value.copy(this.topColor);
    this.skyMaterial.uniforms.horizon.value.copy(this.horizonColor);
    this.skyMaterial.uniforms.sunset.value = golden + twilight * 0.4;
    this.sun.color.copy(this.whiteSun).lerp(this.warmSun, golden);
    this.sun.intensity = (2.3 + smooth(elevation, 0.2, 0.7) * 0.85) * daylight;
    this.sun.visible = this.sun.intensity > 0.015;
    this.hemisphere.color
      .copy(this.horizonColor)
      .lerp(this.dayTop, daylight * 0.3);
    this.hemisphere.groundColor
      .copy(this.groundNight)
      .lerp(this.groundDay, daylight);
    this.hemisphere.intensity = 0.75 + daylight * 0.85;
    this.moonLight.intensity = night * 0.72;
    this.moonLight.position
      .copy(cameraPos)
      .addScaledVector(this.moonDirection, 65);
    this.moonLight.target.position.copy(cameraPos);
    this.moonLight.target.updateMatrixWorld();
    this.skyRoot.position.copy(cameraPos);
    this.sunDisc.position.copy(this.direction).multiplyScalar(290);
    this.sunDisc.material.opacity = smooth(elevation, -0.04, 0.02);
    this.sunDisc.visible = elevation > -0.05;
    this.sunHalo.position.copy(this.sunDisc.position);
    this.sunHalo.material.opacity =
      (0.16 + golden * 0.15) * this.sunDisc.material.opacity;
    this.moonDisc.position.copy(this.moonDirection).multiplyScalar(290);
    this.moonDisc.material.opacity = night * 0.92;
    this.moonDisc.visible = night > 0.01;
    this.stars.material.opacity = night * 0.87;
    this.stars.visible = night > 0.015;
    this.stars.rotation.y = time * 0.000012;
    this.fog.color.copy(this.fogColor);
    this.fog.near = THREE.MathUtils.lerp(25, 40, daylight);
    this.fog.far = THREE.MathUtils.lerp(
      125,
      this.preset === "low" ? 145 : 165,
      daylight,
    );
    if (this.scene.background instanceof THREE.Color)
      this.scene.background.copy(this.horizonColor);
  }

  private radialTexture(): THREE.DataTexture {
    const size = 64,
      data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const radius = Math.hypot(
          ((x + 0.5) / size) * 2 - 1,
          ((y + 0.5) / size) * 2 - 1,
        );
        const alpha = Math.max(0, 1 - radius) ** 3;
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = Math.round(alpha * 255);
      }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }
}
