import * as THREE from "three";

type Kind = "hero" | "wraith" | "guardian" | "npc";

/** Original low-poly, articulated characters. All actors face local -Z. */
export class CharacterModel {
  readonly group = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly cape = new THREE.Group();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly bases = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  private hitTime = 0;
  private deathAmount = 0;
  private gait = 0;

  constructor(private readonly kind: Kind) {
    this.group.name = `${kind}-character`;
    this.group.add(this.rig);
    const enemy = kind === "wraith" || kind === "guardian";
    const boss = kind === "guardian";
    const npc = kind === "npc";
    const material = (
      color: number,
      metalness = 0,
      roughness = 0.8,
      emissive = 0,
      intensity = 0,
    ) => {
      const m = new THREE.MeshStandardMaterial({
        color,
        metalness,
        roughness,
        emissive,
        emissiveIntensity: intensity,
        flatShading: true,
      });
      this.materials.push(m);
      this.bases.set(m, m.emissive.clone());
      return m;
    };
    const cloth = material(npc ? 0x80654a : enemy ? 0x202d35 : 0x344941);
    const leather = material(enemy ? 0x253437 : 0x49392b);
    const steel = material(enemy ? 0x42616a : 0x9ba7a0, 0.67, 0.39);
    const darkSteel = material(enemy ? 0x25343c : 0x4b5d58, 0.6, 0.49);
    const trim = material(enemy ? 0x668c82 : 0xc6a46b, 0.66, 0.42);
    const skin = material(npc ? 0xbd9472 : enemy ? 0x17272c : 0xba987c);
    const glow = material(
      enemy ? 0x83ddd3 : 0xe5ca8c,
      0.2,
      0.3,
      enemy ? 0x5fffea : 0xc39f4b,
      enemy ? 2.2 : 0.3,
    );
    const blade = material(
      enemy ? 0x749da1 : 0xc3ceca,
      0.83,
      0.22,
      enemy ? 0x173a3a : 0,
      enemy ? 0.7 : 0,
    );
    const shadow = material(0x152427);
    const mesh = (
      geometry: THREE.BufferGeometry,
      mat: THREE.Material,
      parent: THREE.Object3D,
      x = 0,
      y = 0,
      z = 0,
    ) => {
      const m = new THREE.Mesh(geometry, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const sphere = (
      radius: number,
      mat: THREE.Material,
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
      sx = 1,
      sy = 1,
      sz = 1,
    ) => {
      const m = mesh(
        new THREE.SphereGeometry(radius, 8, 6),
        mat,
        parent,
        x,
        y,
        z,
      );
      m.scale.set(sx, sy, sz);
      return m;
    };
    const tube = (
      rt: number,
      rb: number,
      height: number,
      mat: THREE.Material,
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
    ) =>
      mesh(new THREE.CylinderGeometry(rt, rb, height, 7), mat, parent, x, y, z);

    // Feet remain on y=0, hip at .88, shoulder at 1.48, crown at 1.94.
    this.leftLeg.position.set(-0.145, 0.89, 0);
    this.rightLeg.position.set(0.145, 0.89, 0);
    this.rig.add(this.leftLeg, this.rightLeg);
    for (const leg of [this.leftLeg, this.rightLeg]) {
      tube(0.105, 0.08, 0.39, cloth, leg, 0, -0.17, 0);
      sphere(0.09, darkSteel, leg, 0, -0.38, -0.025, 1.08, 0.85, 0.9);
      tube(0.085, 0.075, 0.34, leather, leg, 0, -0.59, 0.015);
      sphere(0.1, darkSteel, leg, 0, -0.79, -0.055, 1.05, 0.7, 1.65);
      // Rounded greaves and rolled boot cuff rather than block-shaped legs.
      tube(0.097, 0.088, 0.15, steel, leg, 0, -0.48, -0.015);
    }

    const chestPoints = [
      new THREE.Vector2(0.19, 0),
      new THREE.Vector2(0.24, 0.12),
      new THREE.Vector2(0.285, 0.37),
      new THREE.Vector2(0.22, 0.49),
    ];
    const torso = mesh(
      new THREE.LatheGeometry(chestPoints, 10),
      npc ? cloth : darkSteel,
      this.rig,
      0,
      0.98,
      0,
    );
    torso.scale.z = 0.67;
    tube(0.22, 0.225, 0.095, leather, this.rig, 0, 0.99, 0);
    sphere(0.065, trim, this.rig, 0, 0.985, -0.162, 0.8, 0.8, 0.25);
    // A small articulated cloth skirt; the legs remain visible while moving.
    const skirt = tube(0.2, 0.27, 0.3, cloth, this.rig, 0, 0.87, 0);
    skirt.scale.z = 0.73;
    if (!npc) {
      const breast = sphere(
        0.245,
        steel,
        this.rig,
        0,
        1.28,
        -0.05,
        1,
        0.75,
        0.5,
      );
      breast.rotation.x = -0.12;
      const sigil = mesh(
        new THREE.OctahedronGeometry(0.067),
        trim,
        this.rig,
        0,
        1.32,
        -0.18,
      );
      sigil.scale.set(0.8, 1.45, 0.3);
    }

    this.leftArm.position.set(-0.31, 1.43, 0);
    this.rightArm.position.set(0.31, 1.43, 0);
    this.rig.add(this.leftArm, this.rightArm);
    for (const arm of [this.leftArm, this.rightArm]) {
      sphere(0.15, npc ? cloth : steel, arm, 0, -0.015, 0, 1.06, 0.8, 0.9);
      tube(0.087, 0.07, 0.27, cloth, arm, 0, -0.19, 0);
      tube(0.075, 0.06, 0.22, leather, arm, 0, -0.41, 0);
      if (!npc) tube(0.082, 0.067, 0.14, darkSteel, arm, 0, -0.39, -0.008);
      sphere(0.066, npc ? skin : leather, arm, 0, -0.535, 0);
    }

    this.head.position.set(0, 1.56, 0);
    this.rig.add(this.head);
    tube(0.07, 0.08, 0.13, skin, this.head, 0, -0.025, 0);
    sphere(0.175, skin, this.head, 0, 0.14, -0.005, 0.84, 1.07, 0.88);
    if (npc || enemy) {
      // Hood encloses the skull with a visible recessed face, no imported assets.
      const hood = sphere(
        0.202,
        cloth,
        this.head,
        0,
        0.17,
        0.045,
        1.04,
        1.13,
        1,
      );
      hood.geometry = new THREE.SphereGeometry(
        0.202,
        10,
        8,
        0.43,
        Math.PI * 1.72,
      );
      hood.rotation.y = Math.PI / 2;
      const face = sphere(
        0.142,
        enemy ? shadow : skin,
        this.head,
        0,
        0.13,
        -0.112,
        0.88,
        1.04,
        0.28,
      );
      face.rotation.x = -0.06;
      if (npc) {
        const beard = mesh(
          new THREE.ConeGeometry(0.1, 0.19, 6),
          material(0xb5b0a0),
          this.head,
          0,
          0.035,
          -0.125,
        );
        beard.rotation.z = Math.PI;
      }
    } else {
      const helm = sphere(
        0.185,
        darkSteel,
        this.head,
        0,
        0.18,
        0.018,
        1,
        1.05,
        0.97,
      );
      helm.geometry = new THREE.SphereGeometry(
        0.185,
        10,
        7,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.63,
      );
      tube(0.18, 0.18, 0.035, trim, this.head, 0, 0.16, 0.018);
      const nose = mesh(
        new THREE.CylinderGeometry(0.018, 0.025, 0.16, 4),
        steel,
        this.head,
        0,
        0.085,
        -0.154,
      );
      nose.rotation.x = -0.11;
    }
    for (const side of [-1, 1]) {
      const eye = sphere(
        enemy ? 0.024 : 0.014,
        enemy ? glow : shadow,
        this.head,
        side * 0.056,
        0.135,
        -0.151,
        1.2,
        0.45,
        0.6,
      );
      eye.rotation.z = side * -0.17;
    }
    if (boss) {
      for (const side of [-1, 1]) {
        const horn = mesh(
          new THREE.ConeGeometry(0.06, 0.3, 5),
          trim,
          this.head,
          side * 0.17,
          0.31,
          0.025,
        );
        horn.rotation.z = side * -0.48;
      }
      sphere(0.072, glow, this.rig, 0, 1.34, -0.184, 0.7, 1.1, 0.4);
    }

    // The broad cloak drapes behind the armor, with a slightly folded silhouette.
    this.cape.position.set(0, 1.43, 0.12);
    this.rig.add(this.cape);
    const capeGeometry = new THREE.BufferGeometry();
    capeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          -0.24, 0, 0, 0.24, 0, 0, -0.34, -0.95, 0.19, 0.24, 0, 0, 0.34, -0.95,
          0.19, -0.34, -0.95, 0.19, -0.34, -0.95, 0.19, 0, -1.04, 0.24, 0.34,
          -0.95, 0.19,
        ],
        3,
      ),
    );
    capeGeometry.computeVertexNormals();
    const capeMat = material(npc ? 0x705140 : enemy ? 0x182b31 : 0x2c493d);
    capeMat.side = THREE.DoubleSide;
    mesh(capeGeometry, capeMat, this.cape);
    sphere(0.04, trim, this.rig, -0.18, 1.44, -0.12);

    if (!npc) {
      // Blade tapers to a real point; its local tip is below the hand at rest.
      const sword = new THREE.Group();
      sword.position.set(0, -0.53, -0.01);
      this.rightArm.add(sword);
      tube(0.028, 0.028, 0.17, leather, sword, 0, -0.035, 0);
      const guard = tube(0.018, 0.018, 0.24, trim, sword, 0, -0.12, 0);
      guard.rotation.z = Math.PI / 2;
      const swordGeometry = new THREE.BufferGeometry();
      const w = boss ? 0.07 : 0.045;
      const l = boss ? 0.96 : 0.72;
      swordGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [
            -w,
            -0.14,
            0,
            w,
            -0.14,
            0,
            0,
            -0.14 - l,
            0,
            -w,
            -0.14,
            0,
            0,
            -0.14 - l,
            0,
            0,
            -0.17,
            0.025,
            w,
            -0.14,
            0,
            0,
            -0.17,
            0.025,
            0,
            -0.14 - l,
            0,
          ],
          3,
        ),
      );
      swordGeometry.computeVertexNormals();
      const swordMat = blade.clone();
      swordMat.side = THREE.DoubleSide;
      this.materials.push(swordMat);
      this.bases.set(swordMat, swordMat.emissive.clone());
      mesh(swordGeometry, swordMat, sword);
      sphere(0.045, trim, sword, 0, 0.065, 0);
      if (!enemy || boss) {
        const shield = new THREE.Group();
        shield.position.set(-0.05, -0.32, -0.09);
        this.leftArm.add(shield);
        const s = mesh(
          new THREE.CylinderGeometry(0.24, 0.24, 0.055, 8),
          darkSteel,
          shield,
        );
        s.rotation.x = Math.PI / 2;
        s.scale.y = 1.15;
        const rim = mesh(
          new THREE.TorusGeometry(0.225, 0.018, 4, 8),
          trim,
          shield,
          0,
          0,
          -0.04,
        );
        rim.scale.y = 1.12;
        const crest = mesh(
          new THREE.OctahedronGeometry(0.105),
          enemy ? glow : trim,
          shield,
          0,
          0,
          -0.05,
        );
        crest.scale.set(0.6, 1.5, 0.45);
      }
    } else {
      const staff = tube(
        0.027,
        0.035,
        1.42,
        leather,
        this.rightArm,
        0,
        -0.37,
        -0.06,
      );
      staff.rotation.x = 0.05;
      sphere(0.07, trim, this.rightArm, 0, 0.35, -0.025);
    }
    if (boss) this.rig.scale.setScalar(1.8);
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.frustumCulled = true;
    });
  }

  flash(): void {
    this.hitTime = 0.17;
  }

  update(
    dt: number,
    motion: number,
    attack: number,
    blocking: boolean,
    dead: boolean,
    time: number,
  ): void {
    const speed = Math.min(1, Math.max(0, motion));
    this.gait += dt * (speed > 0.01 ? 9 + speed * 3 : 1.8);
    const stride = Math.sin(this.gait) * speed;
    const blend = 1 - Math.exp(-dt * 15);
    this.leftLeg.rotation.x = THREE.MathUtils.lerp(
      this.leftLeg.rotation.x,
      stride * 0.65,
      blend,
    );
    this.rightLeg.rotation.x = THREE.MathUtils.lerp(
      this.rightLeg.rotation.x,
      -stride * 0.65,
      blend,
    );
    let rightX = 0.25 - stride * 0.3;
    let rightZ = -0.07;
    let leftX = -stride * -0.35 + 0.07;
    let leftZ = 0.08;
    if (attack > 0 && !dead) {
      rightX = 1.15 + Math.sin(attack * Math.PI) * 0.8;
      rightZ = -1.15 + attack * 2.5;
      this.rig.rotation.y = Math.sin(attack * Math.PI * 2) * 0.28;
    } else this.rig.rotation.y *= Math.exp(-dt * 9);
    if (blocking && !dead) {
      leftX = 1.2;
      leftZ = -0.7;
      rightX = 0.45;
    }
    this.rightArm.rotation.x = THREE.MathUtils.lerp(
      this.rightArm.rotation.x,
      rightX,
      blend,
    );
    this.rightArm.rotation.z = THREE.MathUtils.lerp(
      this.rightArm.rotation.z,
      rightZ,
      blend,
    );
    this.leftArm.rotation.x = THREE.MathUtils.lerp(
      this.leftArm.rotation.x,
      leftX,
      blend,
    );
    this.leftArm.rotation.z = THREE.MathUtils.lerp(
      this.leftArm.rotation.z,
      leftZ,
      blend,
    );
    this.head.rotation.y =
      this.kind === "npc"
        ? Math.sin(time * 0.4) * 0.12
        : Math.sin(time * 0.45) * 0.025;
    this.cape.rotation.x = 0.03 + speed * 0.2 + Math.sin(time * 3.4) * 0.025;
    this.cape.rotation.z = Math.sin(time * 2) * 0.025;
    this.deathAmount = THREE.MathUtils.lerp(
      this.deathAmount,
      dead ? 1 : 0,
      1 - Math.exp(-dt * 4.5),
    );
    this.rig.rotation.x = this.deathAmount * -1.5;
    this.rig.position.y =
      Math.sin(time * 2.2) * 0.008 +
      Math.abs(stride) * 0.022 +
      this.deathAmount * 0.16;
    this.hitTime = Math.max(0, this.hitTime - dt);
    for (const m of this.materials) {
      const base = this.bases.get(m)!;
      m.emissive.copy(base);
      if (this.hitTime > 0)
        m.emissive.lerp(
          new THREE.Color(0xe8dac1),
          (this.hitTime / 0.17) * 0.75,
        );
    }
  }
}
