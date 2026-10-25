import * as THREE from "three";
interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  duration: number;
  size: number;
  color: THREE.Color;
  gravity: number;
}
export type StrikeKind = "light" | "heavy" | "critical" | "blocked" | "guardBreak";
interface Ripple {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  duration: number;
  start: number;
  end: number;
  opacity: number;
}
interface Label {
  sprite: THREE.Sprite;
  life: number;
}
/** One draw call and a fixed pool for all transient sparks, dust and healing motes. */
export class Effects {
  private readonly capacity = 320;
  private limit = 230;
  private cursor = 0;
  private readonly particles: Particle[] = Array.from({ length: 320 }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    life: 0,
    duration: 1,
    size: 1,
    color: new THREE.Color(),
    gravity: 3,
  }));
  private readonly positions = new Float32Array(320 * 3);
  private readonly colors = new Float32Array(320 * 3);
  private readonly sizes = new Float32Array(320);
  private readonly cloud: THREE.Points;
  private labels: Label[] = [];
  private readonly ripples: Ripple[] = [];
  private rippleCursor = 0;
  private rippleLimit = 8;
  constructor(private scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
    this.cloud = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        vertexShader:
          "attribute float size; varying vec3 vColor;varying float vVisible;void main(){vVisible=step(.001,size);vColor=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=min(36.,size*180./max(1.,-p.z));}",
        fragmentShader:
          "varying vec3 vColor;varying float vVisible;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(vColor,pow(1.-d,1.8)*.8*vVisible);}",
      }),
    );
    this.cloud.frustumCulled = false;
    scene.add(this.cloud);
    const rippleGeometry = new THREE.RingGeometry(0.88, 1, 36);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(rippleGeometry, new THREE.MeshBasicMaterial({ color: 0xe3c488, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
      mesh.name = "pooled-impact-ripple";
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.onBeforeRender = (_renderer, _scene, camera) => {
        mesh.quaternion.copy(camera.quaternion);
        mesh.updateMatrixWorld();
      };
      scene.add(mesh);
      this.ripples.push({ mesh, life: 0, duration: 1, start: 0.1, end: 1, opacity: 0.3 });
    }
  }
  setBudget(count: number) {
    this.limit = Math.max(32, Math.min(this.capacity, count));
    this.rippleLimit = this.limit < 80 ? 2 : this.limit < 160 ? 4 : 8;
    for (let i = this.rippleLimit; i < this.ripples.length; i++) { this.ripples[i].life = 0; this.ripples[i].mesh.visible = false; }
    for (let i = this.limit; i < this.capacity; i++) this.particles[i].life = 0;
  }
  private emit(
    position: THREE.Vector3,
    color: number,
    size: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    gravity: number,
  ) {
    const p = this.particles[this.cursor++ % this.limit];
    p.position.copy(position);
    p.velocity.set(vx, vy, vz);
    p.color.setHex(color);
    p.size = size;
    p.life = life;
    p.duration = life;
    p.gravity = gravity;
  }
  burst(position: THREE.Vector3, color = 0xe6c47a, count = 18) {
    for (let i = 0; i < Math.min(count, this.limit); i++) {
      const a = i * 2.39996,
        s = 1.2 + (i % 3) * 0.6;
      this.emit(
        position,
        color,
        0.18,
        Math.cos(a) * s,
        0.7 + (i % 4) * 0.5,
        Math.sin(a) * s,
        0.5 + (i % 4) * 0.12,
        4,
      );
    }
  }
  /** Real impacts reuse the fixed particle and eight-ripple pools; no hit-time meshes. */
  strike(position: THREE.Vector3, kind: StrikeKind = "light") {
    const blocked = kind === "blocked", broken = kind === "guardBreak";
    const critical = kind === "critical", heavy = kind === "heavy";
    const count = broken ? 34 : critical ? 28 : heavy ? 24 : blocked ? 16 : 10;
    const color = broken ? 0xedba73 : critical ? 0xf0d18b : blocked ? 0xc9d9d9 : heavy ? 0xd5b58b : 0xb8ccb0;
    const power = broken ? 2.7 : heavy || critical ? 2.25 : blocked ? 2.05 : 1.35;
    for (let i = 0; i < Math.min(count, this.limit); i++) {
      const angle = i * 2.3999632;
      const spread = 0.55 + i % 4 * 0.18;
      this.emit(position, color, blocked ? 0.1 : critical ? 0.15 : 0.13,
        Math.cos(angle) * power * spread,
        0.35 + (i % 5) * (blocked ? 0.22 : 0.32),
        Math.sin(angle) * power * spread,
        blocked ? 0.24 + i % 3 * 0.055 : 0.35 + i % 4 * 0.07,
        blocked ? 6 : 4.5);
    }
    if (kind === "light") return;
    const ripple = this.ripples[this.rippleCursor++ % this.rippleLimit];
    ripple.life = ripple.duration = broken ? 0.44 : critical ? 0.35 : blocked ? 0.18 : 0.28;
    ripple.start = blocked ? 0.08 : 0.12;
    ripple.end = broken ? 1.45 : critical ? 0.9 : blocked ? 0.38 : 0.7;
    ripple.opacity = broken ? 0.32 : blocked ? 0.2 : 0.25;
    ripple.mesh.position.copy(position);
    ripple.mesh.material.color.setHex(color);
    ripple.mesh.material.opacity = ripple.opacity;
    ripple.mesh.scale.setScalar(ripple.start);
    ripple.mesh.visible = true;
  }
  dust(position: THREE.Vector3, intensity = 1) {
    for (let i = 0; i < Math.min(14, Math.ceil(intensity * 6)); i++) {
      const a = i * 2.39996;
      this.emit(
        position,
        0xb9ab86,
        0.25 + intensity * 0.06,
        Math.cos(a) * intensity,
        0.3 + (i % 3) * 0.12,
        Math.sin(a) * intensity,
        0.45 + (i % 3) * 0.12,
        0.3,
      );
    }
  }
  trail(position: THREE.Vector3, color: number) {
    this.emit(position, color, 0.16, 0, 0.1, 0, 0.25, 0);
  }
  heal(position: THREE.Vector3) {
    for (let i = 0; i < 22; i++) {
      const a = i * 2.39996;
      this.emit(
        position,
        0xace7b6,
        0.18,
        Math.cos(a) * 0.6,
        0.8 + (i % 4) * 0.3,
        Math.sin(a) * 0.6,
        1.1,
        0,
      );
    }
  }
  damage(position: THREE.Vector3, text: string, color = "#edd4a0") {
    if (this.labels.length >= 12) {
      const old = this.labels.shift()!;
      this.removeLabel(old);
    }
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 80;
    const ctx = c.getContext("2d")!;
    ctx.font = "600 45px Georgia";
    ctx.textAlign = "center";
    ctx.shadowColor = "#061917";
    ctx.shadowBlur = 5;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 54, 240);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c),
        transparent: true,
        depthTest: false,
      }),
    );
    sprite.position.copy(position);
    sprite.scale.set(2, 0.625, 1);
    this.scene.add(sprite);
    this.labels.push({ sprite, life: 1 });
  }
  private removeLabel(l: Label) {
    this.scene.remove(l.sprite);
    l.sprite.material.map?.dispose();
    l.sprite.material.dispose();
  }
  update(dt: number) {
    for (const ripple of this.ripples) {
      if (ripple.life <= 0) continue;
      ripple.life = Math.max(0, ripple.life - dt);
      const progress = 1 - ripple.life / ripple.duration;
      ripple.mesh.scale.setScalar(THREE.MathUtils.lerp(ripple.start, ripple.end, 1 - (1 - progress) ** 2));
      ripple.mesh.material.opacity = ripple.opacity * (1 - progress) ** 1.5;
      ripple.mesh.visible = ripple.life > 0;
    }
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      p.life = Math.max(0, p.life - dt);
      if (p.life > 0) {
        p.velocity.y -= dt * p.gravity;
        p.position.addScaledVector(p.velocity, dt);
        p.position.toArray(this.positions, i * 3);
        p.color.toArray(this.colors, i * 3);
        this.sizes[i] = p.size * (p.life / p.duration);
      } else this.sizes[i] = 0;
    }
    for (const attr of ["position", "color", "size"])
      (
        this.cloud.geometry.getAttribute(attr) as THREE.BufferAttribute
      ).needsUpdate = true;
    this.labels = this.labels.filter((l) => {
      l.life -= dt;
      if (l.life <= 0) {
        this.removeLabel(l);
        return false;
      }
      l.sprite.position.y += dt * 0.7;
      l.sprite.material.opacity = Math.min(1, l.life * 2);
      return true;
    });
  }
}
