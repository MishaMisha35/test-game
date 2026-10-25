import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface LocomotionState {
  grounded: boolean;
  verticalVelocity: number;
  turn: number;
  acceleration: number;
  landing: number;
  dodge: number;
  combo: number;
  speed: number;
}

export interface CombatPose {
  phase: "idle" | "windup" | "active" | "recovery" | "charging";
  heavy: boolean;
  charge: number;
  counter: boolean;
  stagger: number;
  guardBroken: boolean;
}

type Kind = "hero" | "wraith" | "guardian" | "warden" | "npc";

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
  private readonly emissionLevels = new Map<
    THREE.MeshStandardMaterial,
    number
  >();
  private hitTime = 0;
  private deathAmount = 0;
  private gait = 0;
  private readonly upperBody = new THREE.Group();
  private sword?: THREE.Group;
  private shield?: THREE.Group;
  private bladeLength = 0.72;
  private smoothSpeed = 0;
  private movementWeight = 0;
  private blockWeight = 0;
  private airWeight = 0;
  private landWeight = 0;
  private lean = 0;
  private bank = 0;
  private wasDead = false;
  private readonly hitColor = new THREE.Color(0xd8c4a0);
  private trail?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly trailPositions = new Float32Array(60);
  private readonly trailHistory = new Float32Array(60);
  private readonly trailTip = new THREE.Vector3();
  private readonly trailHilt = new THREE.Vector3();
  private readonly trailWork = new THREE.Vector3();
  private readonly trailInverse = new THREE.Matrix4();
  private trailSamples = 0;
  private trailFade = 0;
  private trailSampleTime = 0;
  private trailActive = false;
  private hasCombatPose = false;
  private readonly combatPose: CombatPose = { phase: "idle", heavy: false, charge: 0, counter: false, stagger: 0, guardBroken: false };
  private recoilTime = 0;
  private recoilStrength = 0;
  private enraged = false;
  private rageAmount = 0;
  private rageMaterial?: THREE.MeshStandardMaterial;
  private readonly rageColor = new THREE.Color(0xe8a853);
  private hasLocomotion = false;
  private locomotion: LocomotionState = {
    grounded: true,
    verticalVelocity: 0,
    turn: 0,
    acceleration: 0,
    landing: 0,
    dodge: 0,
    combo: 0,
    speed: 0,
  };

  setLocomotion(state: LocomotionState): void {
    Object.assign(this.locomotion, state);
    this.hasLocomotion = true;
  }

  setCombatPose(pose: Partial<CombatPose>): void {
    Object.assign(this.combatPose, pose);
    this.hasCombatPose = true;
  }

  reactToHit(strength = 0.7): void {
    const power = Number.isFinite(strength) ? THREE.MathUtils.clamp(strength, 0, 1) : 0.7;
    this.recoilStrength = Math.max(this.recoilStrength * this.recoilTime / 0.24, power);
    this.recoilTime = 0.24;
    this.flash();
  }

  setEnraged(enabled: boolean): void { this.enraged = enabled; }

  constructor(private readonly kind: Kind) {
    this.group.name = `${kind}-character`;
    this.group.add(this.rig);
    const warden = kind === "warden";
    const enemy = kind === "wraith" || kind === "guardian" || warden;
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
      this.emissionLevels.set(m, m.emissiveIntensity);
      return m;
    };
    const cloth = material(warden ? 0x344b39 : npc ? 0x80654a : enemy ? 0x202d35 : 0x4d6251);
    const leather = material(warden ? 0x514831 : enemy ? 0x253437 : 0x49392b);
    const steel = material(warden ? 0x526342 : enemy ? 0x42616a : 0x9ba7a0, warden ? 0.16 : 0.67, warden ? 0.82 : 0.39);
    const darkSteel = material(warden ? 0x3b4935 : enemy ? 0x25343c : 0x4b5d58, warden ? 0.12 : 0.6, warden ? 0.9 : 0.49);
    const trim = material(warden ? 0xb59854 : enemy ? 0x668c82 : 0xc6a46b, 0.66, 0.42);
    const skin = material(npc ? 0xbd9472 : enemy ? 0x17272c : 0xba987c);
    const glow = material(
      warden ? 0x7fbf7a : enemy ? 0x83ddd3 : 0xe5ca8c,
      0.2,
      0.3,
      warden ? 0x75c284 : enemy ? 0x5fffea : 0xc39f4b,
      warden ? 1.25 : enemy ? 2.2 : 0.3,
    );
    const blade = material(
      warden ? 0x8b9c66 : enemy ? 0x749da1 : 0xc3ceca,
      warden ? 0.23 : 0.83,
      0.22,
      enemy ? 0x173a3a : 0,
      enemy ? 0.7 : 0,
    );
    if (warden) this.rageMaterial = glow;
    const bark = warden ? material(0x594b33, 0.03, 0.97) : leather;
    const moss = warden ? material(0x648348, 0.02, 0.95) : cloth;
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
    const capeMat = material(warden ? 0x344d31 : npc ? 0x705140 : enemy ? 0x182b31 : 0x597b63);
    capeMat.side = THREE.DoubleSide;
    mesh(capeGeometry, capeMat, this.cape);
    sphere(0.04, trim, this.rig, -0.18, 1.44, -0.12);

    if (!npc) {
      // Blade tapers to a real point; its local tip is below the hand at rest.
      const sword = new THREE.Group();
      this.sword = sword;
      sword.position.set(0, -0.53, -0.01);
      this.rightArm.add(sword);
      tube(0.028, 0.028, 0.17, leather, sword, 0, -0.035, 0);
      const guard = tube(0.018, 0.018, 0.24, trim, sword, 0, -0.12, 0);
      guard.rotation.z = Math.PI / 2;
      const swordGeometry = new THREE.BufferGeometry();
      const w = boss ? 0.07 : 0.045;
      const l = boss ? 0.96 : 0.72;
      this.bladeLength = l;
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
      this.emissionLevels.set(swordMat, swordMat.emissiveIntensity);
      mesh(swordGeometry, swordMat, sword);
      sphere(0.045, trim, sword, 0, 0.065, 0);
      if (!enemy || boss || warden) {
        const shield = new THREE.Group();
        this.shield = shield;
        shield.position.set(-0.05, -0.32, -0.09);
        this.leftArm.add(shield);
        const s = mesh(
          new THREE.CylinderGeometry(0.24, 0.24, 0.055, 8),
          warden ? bark : darkSteel,
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
    if (warden) {
      // Branches, moss and crystals are original geometry, batched under each joint.
      const branch = (parent: THREE.Object3D, ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number) => {
        const direction = new THREE.Vector3(bx - ax, by - ay, bz - az);
        const limb = mesh(new THREE.CylinderGeometry(radius * 0.48, radius, direction.length(), 5), bark, parent, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
        limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      };
      for (const side of [-1, 1]) {
        branch(this.head, side * 0.13, 0.23, 0.02, side * 0.31, 0.53, 0.035, 0.044);
        branch(this.head, side * 0.31, 0.53, 0.035, side * 0.29, 0.68, 0, 0.029);
        branch(this.head, side * 0.23, 0.4, 0.025, side * 0.43, 0.48, -0.015, 0.029);
        branch(this.head, side * 0.29, 0.52, 0.03, side * 0.4, 0.63, 0.055, 0.025);
      }
      for (const arm of [this.leftArm, this.rightArm]) {
        sphere(0.13, moss, arm, 0, 0.055, 0.02, 1.22, 0.43, 1.05);
        const crystal = mesh(new THREE.OctahedronGeometry(0.07), glow, arm, 0.07, 0.09, -0.065);
        crystal.scale.set(0.65, 1.5, 0.6);
      }
      for (const side of [-1, 1]) {
        sphere(0.15, moss, this.rig, side * 0.17, 0.93, 0.07, 0.85, 0.45, 0.68);
        const crystal = mesh(new THREE.OctahedronGeometry(0.075), glow, this.rig, side * 0.14, 1.27, -0.16);
        crystal.scale.set(0.75, 1.65, 0.6);
        crystal.rotation.z = side * -0.18;
      }
      if (this.sword) for (let i = 0; i < 4; i++) {
        const side = i % 2 ? -1 : 1;
        const thorn = mesh(new THREE.ConeGeometry(0.033, 0.14, 5), bark, this.sword, side * 0.07, -0.29 - i * 0.13, 0);
        thorn.rotation.z = side * -Math.PI / 2;
      }
      if (this.shield) for (let i = -1; i <= 1; i++) tube(0.019, 0.023, 0.36, bark, this.shield, i * 0.105, 0, -0.053);
    }
    if (boss || warden) this.rig.scale.setScalar(warden ? 1.45 : 1.8);
    // Waist pivot lets the chest breathe and lean without sliding either foot.
    const upperParts = this.rig.children.filter(
      (part) => part !== this.leftLeg && part !== this.rightLeg,
    );
    this.upperBody.position.y = 1.02;
    this.rig.add(this.upperBody);
    this.rig.updateMatrixWorld(true);
    for (const part of upperParts) this.upperBody.attach(part);
    this.mergeStaticParts(this.rig);
    if (this.sword) this.createTrail(enemy);
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh)
        object.frustumCulled = object !== this.trail;
    });
  }

  /** Merge only immutable geometry sharing a material under the SAME pivot. */
  private mergeStaticParts(parent: THREE.Object3D): void {
    for (const child of [...parent.children]) {
      if (!(child instanceof THREE.Mesh)) this.mergeStaticParts(child);
    }
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of parent.children) {
      if (!(child instanceof THREE.Mesh) || Array.isArray(child.material))
        continue;
      const bucket = batches.get(child.material) ?? [];
      bucket.push(child);
      batches.set(child.material, bucket);
    }
    for (const [material, meshes] of batches) {
      if (meshes.length < 2) continue;
      const parts = meshes.map((mesh) => {
        mesh.updateMatrix();
        const copy = mesh.geometry.clone();
        const geometry = copy.index ? copy.toNonIndexed() : copy;
        if (geometry !== copy) copy.dispose();
        geometry.applyMatrix4(mesh.matrix);
        // All source normals are retained; UV-less ornaments get neutral UVs.
        if (!geometry.getAttribute("uv"))
          geometry.setAttribute(
            "uv",
            new THREE.BufferAttribute(
              new Float32Array(geometry.getAttribute("position").count * 2),
              2,
            ),
          );
        for (const name of Object.keys(geometry.attributes)) {
          if (name !== "position" && name !== "normal" && name !== "uv")
            geometry.deleteAttribute(name);
        }
        return geometry;
      });
      const geometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!geometry) continue;
      geometry.computeBoundingSphere();
      const combined = new THREE.Mesh(geometry, material);
      combined.castShadow = true;
      combined.receiveShadow = true;
      for (const mesh of meshes) {
        parent.remove(mesh);
        mesh.geometry.dispose();
      }
      parent.add(combined);
    }
  }

  /** A pooled ribbon records the blade's actual world-space sweep. */
  private createTrail(enemy: boolean): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.trailPositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const colors = new Float32Array(80);
    const tint = new THREE.Color(enemy ? 0x86d9ce : 0xe6c58a);
    const indices: number[] = [];
    for (let i = 0; i < 10; i++) {
      const fade = Math.pow(1 - i / 10, 1.5);
      for (let side = 0; side < 2; side++) {
        const c = (i * 2 + side) * 4;
        colors[c] = tint.r;
        colors[c + 1] = tint.g;
        colors[c + 2] = tint.b;
        colors[c + 3] = fade * (side ? 0.75 : 0.06);
      }
      if (i < 9) {
        const v = i * 2;
        indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.trail = new THREE.Mesh(geometry, material);
    this.trail.name = "blade-motion-ribbon";
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.trail.renderOrder = 2;
    this.group.add(this.trail);
  }

  private updateTrail(dt: number, active: boolean): void {
    const trail = this.trail,
      sword = this.sword;
    if (!trail || !sword) return;
    if (active) {
      sword.updateWorldMatrix(true, false);
      this.trailTip
        .set(0, -0.14 - this.bladeLength, 0)
        .applyMatrix4(sword.matrixWorld);
      this.trailHilt.set(0, -0.23, 0).applyMatrix4(sword.matrixWorld);
      if (!this.trailActive) {
        this.trailSamples = 1;
        this.trailSampleTime = 0;
        for (let i = 0; i < 10; i++) {
          this.trailHilt.toArray(this.trailHistory, i * 6);
          this.trailTip.toArray(this.trailHistory, i * 6 + 3);
        }
      }
      this.trailSampleTime += dt;
      if (this.trailSampleTime >= 1 / 90) {
        this.trailHistory.copyWithin(6, 0, 54);
        this.trailHilt.toArray(this.trailHistory, 0);
        this.trailTip.toArray(this.trailHistory, 3);
        this.trailSamples = Math.min(10, this.trailSamples + 1);
        this.trailSampleTime = 0;
      }
      this.trailFade = 1;
    } else this.trailFade = Math.max(0, this.trailFade - dt * 9);
    this.trailActive = active;
    trail.visible = this.trailFade > 0 && this.trailSamples > 1;
    if (!trail.visible) return;
    this.group.updateWorldMatrix(true, false);
    this.trailInverse.copy(this.group.matrixWorld).invert();
    for (let i = 0; i < 60; i += 3) {
      this.trailWork
        .fromArray(this.trailHistory, i)
        .applyMatrix4(this.trailInverse)
        .toArray(this.trailPositions, i);
    }
    (
      trail.geometry.getAttribute("position") as THREE.BufferAttribute
    ).needsUpdate = true;
    trail.material.opacity = this.trailFade * 0.34;
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
    dt = Math.max(0, Math.min(dt, 0.1));
    const state = this.locomotion;
    const external = this.hasLocomotion;
    this.hasLocomotion = false;
    const actualSpeed = Math.max(0, external ? state.speed : motion * 5);
    const grounded = !external || state.grounded;
    const vertical = external ? state.verticalVelocity : 0;
    const dodge =
      !dead && external ? THREE.MathUtils.clamp(state.dodge, 0, 1) : 0;
    const combo = external ? Math.round(state.combo) % 3 : 0;
    const combat = this.combatPose;
    const combatPhase = this.hasCombatPose ? combat.phase : "idle";
    const charging = combatPhase === "charging" && !dead && dodge === 0;
    const charge = this.hasCombatPose ? THREE.MathUtils.clamp(combat.charge, 0, 1) : 0;
    const guardBroken = this.hasCombatPose && combat.guardBroken;
    const stagger = this.hasCombatPose && !dead ? THREE.MathUtils.clamp(combat.stagger + (guardBroken ? 0.65 : 0), 0, 1) : 0;
    this.recoilTime = Math.max(0, this.recoilTime - dt);
    const recoil = Math.sin(this.recoilTime / 0.24 * Math.PI) * this.recoilStrength * (dead ? 0 : 1);
    const smooth = (current: number, target: number, rate: number) =>
      THREE.MathUtils.lerp(current, target, 1 - Math.exp(-dt * rate));
    if (this.wasDead && !dead) {
      this.deathAmount = 0;
      this.movementWeight = 0;
      this.trailFade = 0;
      this.trailActive = false;
      this.airWeight = 0;
      this.landWeight = 0;
      this.recoilTime = 0; this.recoilStrength = 0;
    }
    this.wasDead = dead;
    this.deathAmount = smooth(this.deathAmount, dead ? 1 : 0, 5.8);
    const aliveWeight = 1 - this.deathAmount;
    this.rageAmount = smooth(this.rageAmount, this.enraged && !dead ? 1 : 0, 3);
    this.smoothSpeed = smooth(this.smoothSpeed, actualSpeed, 10);
    const run = THREE.MathUtils.smoothstep(this.smoothSpeed, 4.5, 7.9);
    this.movementWeight = smooth(
      this.movementWeight,
      grounded && !dead && dodge === 0 ? Math.min(1, actualSpeed / 1.2) : 0,
      13,
    );
    this.blockWeight = smooth(
      this.blockWeight,
      blocking && !dead && !guardBroken && stagger < 0.25 ? 1 : 0,
      blocking ? 24 : 13,
    );
    this.airWeight = smooth(this.airWeight, !grounded && !dead ? 1 : 0, 14);
    this.landWeight = smooth(
      this.landWeight,
      external ? THREE.MathUtils.clamp(state.landing, 0, 1) : 0,
      24,
    );
    this.lean = smooth(
      this.lean,
      external ? THREE.MathUtils.clamp(state.acceleration / 28, -1, 1) : 0,
      9,
    );
    this.bank = smooth(
      this.bank,
      external ? THREE.MathUtils.clamp(state.turn / 6, -1, 1) : 0,
      11,
    );

    // Distance-driven phase stops advancing at idle or in the air.
    if (grounded && actualSpeed > 0.03 && dodge === 0 && !dead) {
      const strideLength = THREE.MathUtils.lerp(2.25, 3.15, run);
      this.gait += ((actualSpeed * dt) / strideLength) * Math.PI * 2;
    }
    const stride = Math.sin(this.gait) * this.movementWeight;
    const legAmplitude = THREE.MathUtils.lerp(0.5, 0.77, run);
    const rising = THREE.MathUtils.clamp(vertical / 8, 0, 1);
    const falling = THREE.MathUtils.clamp(-vertical / 10, 0, 1);
    const rollWeight =
      dodge > 0
        ? THREE.MathUtils.smoothstep(dodge, 0, 0.13) *
          (1 - THREE.MathUtils.smoothstep(dodge, 0.83, 1))
        : 0;
    const jumpTuck = this.airWeight * (0.15 + rising * 0.5);
    const leftLegTarget = stride * legAmplitude + jumpTuck + rollWeight * 0.75;
    const rightLegTarget =
      -stride * legAmplitude -
      this.airWeight * (0.05 + falling * 0.18) +
      rollWeight * 0.48;
    this.leftLeg.rotation.x = smooth(
      this.leftLeg.rotation.x,
      leftLegTarget * aliveWeight,
      18,
    );
    this.rightLeg.rotation.x = smooth(
      this.rightLeg.rotation.x,
      rightLegTarget * aliveWeight,
      18,
    );
    this.leftLeg.rotation.z = smooth(
      this.leftLeg.rotation.z,
      this.airWeight * 0.05,
      13,
    );
    this.rightLeg.rotation.z = smooth(
      this.rightLeg.rotation.z,
      -this.airWeight * 0.05,
      13,
    );
    const legCompression = 1 - this.landWeight * 0.13;
    this.leftLeg.scale.y = legCompression;
    this.rightLeg.scale.y = legCompression;

    let rightX = 0.23 - stride * (0.24 + run * 0.1);
    let rightZ = -0.065 - run * 0.04;
    let rightY = 0;
    let leftX = 0.08 + stride * (0.28 + run * 0.12);
    let leftZ = 0.075;
    let twist = 0;
    let attackProgress = THREE.MathUtils.clamp(attack, 0, 1);
    if (this.hasCombatPose && combatPhase === "windup") attackProgress = Math.min(0.23, attackProgress);
    if (this.hasCombatPose && combatPhase === "active") attackProgress = Math.max(0.25, Math.min(0.68, attackProgress));
    if (this.hasCombatPose && combatPhase === "recovery") attackProgress = Math.max(0.68, attackProgress);
    const attacking = attackProgress > 0 && !charging && !dead && dodge === 0 && stagger < 0.6;
    if (attacking) {
      const windup = THREE.MathUtils.smoothstep(attackProgress, 0, 0.24);
      const strike = THREE.MathUtils.smoothstep(attackProgress, 0.24, 0.61);
      const recovery = THREE.MathUtils.smoothstep(attackProgress, 0.72, 1);
      const direction = combo === 1 ? -1 : 1;
      if (this.hasCombatPose && combat.counter) {
        // Counter thrust points the blade forward instead of reusing the slash.
        const extension = Math.sin(strike * Math.PI * 0.85) * (1 - recovery);
        rightX = THREE.MathUtils.lerp(0.65, 1.62, windup) - recovery * 0.9;
        rightZ = -0.13; rightY = -0.04;
        twist = -0.12 + extension * 0.24;
      } else if ((this.hasCombatPose && combat.heavy) || combo === 2) {
        rightX =
          THREE.MathUtils.lerp(2.62, 0.87, strike) * (1 - recovery * 0.75);
        rightZ = -0.18 + Math.sin(strike * Math.PI) * 0.24;
        rightY = -0.14;
        twist = Math.sin(strike * Math.PI) * 0.1;
      } else {
        rightX = THREE.MathUtils.lerp(0.38, 1.7, windup) - recovery * 1.25;
        rightZ =
          direction * THREE.MathUtils.lerp(-1.15, 1.3, strike) * (1 - recovery);
        rightY = direction * (strike - 0.5) * 0.32;
        twist =
          direction * Math.sin(strike * Math.PI * 1.35) * 0.19 * (1 - recovery);
      }
      leftX = 0.35;
      leftZ = 0.22;
    }
    if (charging) {
      const tremor = Math.sin(time * 19) * 0.007 * charge;
      rightX = 2.35 + charge * 0.23 + tremor;
      rightZ = -0.26; rightY = 0.1;
      leftX = 0.58; leftZ = 0.13;
      twist = -0.055 - charge * 0.055;
    }
    if (stagger > 0.05) {
      rightX = THREE.MathUtils.lerp(rightX, 0.45, stagger);
      rightZ = THREE.MathUtils.lerp(rightZ, -0.46, stagger);
      leftX = THREE.MathUtils.lerp(leftX, 0.18, stagger);
      leftZ = THREE.MathUtils.lerp(leftZ, 0.66, stagger);
      twist -= stagger * 0.12;
    }
    const counterExtension = attacking && this.hasCombatPose && combat.counter ? Math.sin(THREE.MathUtils.smoothstep(attackProgress, 0.24, 0.61) * Math.PI * 0.85) * 0.18 : 0;
    this.rightArm.position.z = smooth(this.rightArm.position.z, -counterExtension, 24);
    leftX = THREE.MathUtils.lerp(
      leftX,
      1.28 + this.hitTime * 0.45,
      this.blockWeight,
    );
    leftZ = THREE.MathUtils.lerp(leftZ, -0.65, this.blockWeight);
    rightX = THREE.MathUtils.lerp(rightX, 0.5, this.blockWeight);
    rightX += this.airWeight * 0.2 + rollWeight * 0.8;
    leftX += this.airWeight * 0.18 + rollWeight * 0.6;
    const armRate = attacking ? 30 : charging ? 22 : 16;
    this.rightArm.rotation.x = smooth(
      this.rightArm.rotation.x,
      rightX * aliveWeight,
      armRate,
    );
    this.rightArm.rotation.z = smooth(
      this.rightArm.rotation.z,
      rightZ * aliveWeight,
      armRate,
    );
    this.rightArm.rotation.y = smooth(
      this.rightArm.rotation.y,
      rightY * aliveWeight,
      armRate,
    );
    this.leftArm.rotation.x = smooth(
      this.leftArm.rotation.x,
      leftX * aliveWeight,
      21,
    );
    this.leftArm.rotation.z = smooth(
      this.leftArm.rotation.z,
      leftZ * aliveWeight,
      21,
    );
    if (this.shield) {
      this.shield.rotation.x = -this.blockWeight * 1.05;
      this.shield.rotation.y = -this.blockWeight * 0.18;
      this.shield.rotation.z = this.blockWeight * 0.12;
    }

    const breathing =
      Math.sin(time * (2.1 + this.rageAmount * 0.35)) * (1 - this.movementWeight * 0.7) * aliveWeight;
    this.upperBody.scale.y = 1 + breathing * 0.007;
    this.upperBody.scale.x = 1 + breathing * 0.003 + this.rageAmount * 0.015;
    this.upperBody.position.z = smooth(this.upperBody.position.z, recoil * 0.065 + stagger * 0.035, 20);
    this.upperBody.rotation.x = smooth(
      this.upperBody.rotation.x,
      (-this.movementWeight * (0.035 + run * 0.08) -
        this.lean * 0.055 +
        this.blockWeight * 0.045 +
        this.landWeight * 0.12 + recoil * 0.19 + stagger * 0.2 - (charging ? charge * 0.04 : 0)) *
        aliveWeight,
      12,
    );
    this.upperBody.rotation.y = smooth(
      this.upperBody.rotation.y,
      twist - this.bank * 0.045,
      18,
    );
    this.upperBody.rotation.z = smooth(
      this.upperBody.rotation.z,
      -this.bank * this.movementWeight * 0.055,
      12,
    );
    this.head.rotation.y =
      this.kind === "npc" ? Math.sin(time * 0.4) * 0.12 : -this.bank * 0.06;
    this.head.rotation.x = this.airWeight * -rising * 0.045 - recoil * 0.08 + stagger * 0.14;
    this.cape.rotation.x = smooth(
      this.cape.rotation.x,
      0.025 +
        this.movementWeight * (0.11 + run * 0.14) +
        this.airWeight * 0.17 +
        Math.sin(time * 3.1) * 0.018,
      8,
    );
    this.cape.rotation.z = -this.bank * 0.1 + Math.sin(time * 2.2) * 0.012;

    const rollAngle =
      dodge > 0 ? -Math.PI * 2 * (dodge * dodge * (3 - 2 * dodge)) : 0;
    this.rig.rotation.x = rollAngle * aliveWeight - this.deathAmount * 1.5;
    this.rig.rotation.y = 0;
    this.rig.rotation.z = -this.bank * this.movementWeight * 0.025;
    this.rig.position.y =
      0.78 * (1 - Math.cos(rollAngle)) * aliveWeight -
      this.landWeight * 0.085 +
      this.deathAmount * 0.16 +
      Math.abs(stride) * 0.018;
    this.rig.position.z = -0.78 * Math.sin(rollAngle) * aliveWeight;
    const baseScale = this.kind === "guardian" ? 1.8 : this.kind === "warden" ? 1.45 : 1;
    this.rig.scale.set(
      baseScale,
      baseScale * (1 - rollWeight * 0.27),
      baseScale,
    );
    this.hitTime = Math.max(0, this.hitTime - dt);
    const flash = (this.hitTime / 0.17) * 0.24;
    for (const material of this.materials) {
      material.emissive.copy(this.bases.get(material)!);
      const enragedMaterial = material === this.rageMaterial;
      if (enragedMaterial) material.emissive.lerp(this.rageColor, this.rageAmount * 0.7);
      const intensity = (this.emissionLevels.get(material) ?? 0) + (enragedMaterial ? this.rageAmount * 1.2 : 0);
      material.emissiveIntensity =
        flash > 0 ? Math.max(1, intensity) : intensity;
      if (flash > 0) material.emissive.lerp(this.hitColor, flash);
    }
    this.updateTrail(
      dt,
      attacking && combatPhase !== "windup" && attackProgress > 0.24 && attackProgress < 0.72,
    );
  }
}
