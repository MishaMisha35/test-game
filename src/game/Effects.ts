import * as THREE from "three";
interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}
interface Label {
  sprite: THREE.Sprite;
  life: number;
}
export class Effects {
  private particles: Particle[] = [];
  private labels: Label[] = [];
  private geo = new THREE.IcosahedronGeometry(0.06, 0);
  constructor(private scene: THREE.Scene) {}
  burst(position: THREE.Vector3, color = 0xe6c47a, count = 18) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        this.geo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          depthWrite: false,
        }),
      );
      mesh.position.copy(position);
      this.scene.add(mesh);
      const angle = i * 2.39996,
        up = 0.8 + (i % 4) * 0.5,
        speed = 1.4 + (i % 3) * 0.8;
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          up,
          Math.sin(angle) * speed,
        ),
        life: 0.6 + (i % 4) * 0.15,
        maxLife: 1.1,
      });
    }
  }
  damage(position: THREE.Vector3, text: string, color = "#edd4a0") {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 80;
    const ctx = c.getContext("2d")!;
    ctx.font = "600 45px Georgia";
    ctx.textAlign = "center";
    ctx.shadowColor = "#061917";
    ctx.shadowBlur = 5;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 54);
    const texture = new THREE.CanvasTexture(c),
      sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
        }),
      );
    sprite.position.copy(position);
    sprite.scale.set(2, 0.625, 1);
    this.scene.add(sprite);
    this.labels.push({ sprite, life: 1 });
  }
  update(dt: number) {
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        return false;
      }
      p.velocity.y -= dt * 4;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.scale.setScalar(p.life / p.maxLife);
      return true;
    });
    this.labels = this.labels.filter((l) => {
      l.life -= dt;
      if (l.life <= 0) {
        this.scene.remove(l.sprite);
        l.sprite.material.map?.dispose();
        l.sprite.material.dispose();
        return false;
      }
      l.sprite.position.y += dt * 0.7;
      l.sprite.material.opacity = Math.min(1, l.life * 2);
      return true;
    });
  }
}
