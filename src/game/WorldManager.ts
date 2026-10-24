import * as THREE from "three";
import type { Interactable, WorldObstacle } from "./types";
import { ENEMY_SPAWNS, BOSS_SPAWN, SPAWN } from "./types";

const TAU = Math.PI * 2;
const pathX = (z: number) => Math.sin((z + 8) * 0.045) * 3;
/** Shared by the visible mesh and Rapier heightfield. Keep this deterministic. */
export function terrainHeight(x: number, z: number): number {
  const distance = Math.hypot(x, z + 58);
  const plain =
    Math.sin(x * 0.053) * 0.9 +
    Math.sin(z * 0.047) * 0.65 +
    Math.cos((x + z) * 0.08) * 0.25;
  const farHills =
    Math.max(0, Math.abs(x) - 34) * 0.055 + Math.max(0, -z - 85) * 0.035;
  const lake = Math.exp(-((x + 34) ** 2 / 100 + (z + 7) ** 2 / 600)) * 2.3;
  const arenaBlend = THREE.MathUtils.smoothstep(distance, 10, 18);
  return THREE.MathUtils.lerp(-0.3, plain + farHills - lake, arenaBlend);
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export class WorldManager {
  readonly obstacles: WorldObstacle[] = [];
  readonly interactables: Interactable[] = [];
  private scene: THREE.Scene;
  private random = rng(73041);
  private trees?: THREE.InstancedMesh;
  private grasses?: THREE.InstancedMesh;
  private flowers?: THREE.InstancedMesh;
  private motes: THREE.Points;
  private moteOrigins: Float32Array;
  private water: THREE.Mesh;
  private chestLids = new Map<string, THREE.Group>();
  private rune: THREE.Group;
  private clouds: THREE.Group;
  private dummy = new THREE.Object3D();
  private windTimes: Array<{ value: number }> = [];
  private stone = new THREE.MeshStandardMaterial({
    color: "#7c8376",
    roughness: 0.98,
    flatShading: true,
  });
  private lightStone = new THREE.MeshStandardMaterial({
    color: "#ada893",
    roughness: 0.92,
    flatShading: true,
  });
  private darkStone = new THREE.MeshStandardMaterial({
    color: "#43564e",
    roughness: 1,
    flatShading: true,
  });
  private wood = new THREE.MeshStandardMaterial({
    color: "#43372b",
    roughness: 1,
  });
  private metal = new THREE.MeshStandardMaterial({
    color: "#a28b56",
    metalness: 0.65,
    roughness: 0.45,
  });
  private glow = new THREE.MeshStandardMaterial({
    color: "#b3efe0",
    emissive: "#51d4b8",
    emissiveIntensity: 2.3,
    roughness: 0.4,
  });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createGround();
    this.createPaths();
    this.createForest();
    this.createGrass();
    this.createRocks();
    this.createVillage();
    this.createRuins();
    this.createMountains();
    this.createInteractables();
    this.water = this.createWater();
    this.rune = this.createShrine();
    this.clouds = this.createClouds();
    const count = 120;
    this.moteOrigins = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.moteOrigins[i * 3] = (this.random() - 0.5) * 85;
      this.moteOrigins[i * 3 + 2] = this.random() * 105 - 70;
      this.moteOrigins[i * 3 + 1] =
        terrainHeight(this.moteOrigins[i * 3], this.moteOrigins[i * 3 + 2]) +
        this.random() * 5 +
        0.8;
      color.set(i % 3 ? "#f5d890" : "#92e4ca");
      color.toArray(colors, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.moteOrigins.slice(), 3),
    );
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.105,
        vertexColors: true,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(this.motes);
  }

  private windMaterial(amplitude: number, doubleSided = false) {
    const material = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      flatShading: true,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    const time = { value: 0 };
    this.windTimes.push(time);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.worldWindTime = time;
      shader.vertexShader =
        "uniform float worldWindTime;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float windPhase = worldWindTime * 1.25 + instanceMatrix[3].x * 0.17 + instanceMatrix[3].z * 0.13;
          transformed.x += sin(windPhase + position.y * 1.6) * ${amplitude.toFixed(3)} * max(0.0, position.y + 0.5);
        #endif
      `,
      );
    };
    material.customProgramCacheKey = () => "world-wind-" + amplitude;
    return material;
  }

  private mesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = this.scene,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat = this.stone,
    parent: THREE.Object3D = this.scene,
  ) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  }
  private obstacle(
    x: number,
    z: number,
    hx: number,
    hz: number,
    height: number,
    rotation = 0,
  ) {
    this.obstacles.push({ x, z, hx, hz, height, rotation });
  }
  private instance(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw = 0,
  ) {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, yaw, 0);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }
  private createGround() {
    const geo = new THREE.PlaneGeometry(360, 360, 128, 128);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    const a = new THREE.Color("#64774b"),
      b = new THREE.Color("#495f43"),
      path = new THREE.Color("#9b9672"),
      color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z));
      color.copy(a).lerp(b, (Math.sin(x * 0.3) * Math.cos(z * 0.17) + 1) * 0.5);
      const dist = Math.abs(x - pathX(z));
      if (z < 31 && z > -61)
        color.lerp(path, Math.max(0, 1 - dist / 5.5) * 0.82);
      if (Math.hypot(x, z + 58) < 13) color.lerp(path, 0.7);
      color.toArray(colors, i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
  }
  private createPaths() {
    const verts: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    const base = new THREE.Color("#b4aa82");
    for (let i = 0; i <= 100; i++) {
      const z = 35 - i;
      const width = 2.0 + Math.sin(i * 0.12) * 0.3;
      for (const side of [-1, 1]) {
        const x = pathX(z) + side * width;
        verts.push(x, terrainHeight(x, z) + 0.035, z);
        base
          .clone()
          .multiplyScalar(0.86 + this.random() * 0.16)
          .toArray(colors, colors.length);
      }
      if (i < 100) {
        const j = i * 2;
        indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const path = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    path.receiveShadow = true;
    this.scene.add(path);
    const stones = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      this.lightStone,
      72,
    );
    for (let i = 0; i < 72; i++) {
      const z = 27 - this.random() * 82,
        x = pathX(z) + (this.random() - 0.5) * 2.5;
      this.instance(
        stones,
        i,
        x,
        terrainHeight(x, z) + 0.03,
        z,
        0.24 + this.random() * 0.3,
        0.055,
        0.3 + this.random() * 0.4,
        this.random() * TAU,
      );
    }
    stones.receiveShadow = true;
    this.scene.add(stones);
  }
  private keepClear(x: number, z: number, margin = 0): boolean {
    if (Math.abs(x - pathX(z)) < 7 + margin && z > -73 && z < 36) return true;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 9 + margin) return true;
    if (Math.hypot(x - BOSS_SPAWN.x, z - BOSS_SPAWN.z) < 16 + margin)
      return true;
    if (ENEMY_SPAWNS.some((p) => Math.hypot(x - p.x, z - p.z) < 6 + margin))
      return true;
    if (
      Math.hypot(x - 17, z - 20) < 11 + margin ||
      Math.hypot(x + 17, z - 23) < 9 + margin
    )
      return true;
    return x < -24 && x > -44 && z < 25 && z > -36;
  }
  private createForest() {
    const positions: Array<{ x: number; z: number; s: number; pine: boolean }> =
      [];
    for (let tries = 0; tries < 1600 && positions.length < 210; tries++) {
      const x = (this.random() - 0.5) * 155,
        z = this.random() * 175 - 104;
      if (this.keepClear(x, z, 1)) continue;
      if (positions.some((p) => Math.hypot(p.x - x, p.z - z) < 4.0)) continue;
      positions.push({
        x,
        z,
        s: 0.75 + this.random() * 0.8,
        pine: this.random() < 0.73,
      });
    }
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.27, 0.5, 1, 7),
      this.wood,
      positions.length,
    );
    const pine = positions.filter((p) => p.pine),
      broad = positions.filter((p) => !p.pine);
    const foliage = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 7),
      this.windMaterial(0.035),
      pine.length * 3,
    );
    this.trees = foliage;
    const broadLeaves = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      this.windMaterial(0.045),
      broad.length * 4,
    );
    let pIndex = 0,
      bIndex = 0;
    const color = new THREE.Color();
    positions.forEach((p, i) => {
      const y = terrainHeight(p.x, p.z),
        h = (p.pine ? 10 : 8) * p.s;
      this.instance(
        trunks,
        i,
        p.x,
        y + h * 0.4,
        p.z,
        p.s,
        h * 0.8,
        p.s,
        this.random() * TAU,
      );
      if (Math.abs(p.x) < 66 && p.z < 65 && p.z > -85)
        this.obstacle(p.x, p.z, 0.42 * p.s, 0.42 * p.s, h * 0.65);
      if (p.pine) {
        for (let tier = 0; tier < 3; tier++) {
          this.instance(
            foliage,
            pIndex,
            p.x,
            y + h * (0.43 + tier * 0.19),
            p.z,
            (3.4 - tier * 0.67) * p.s,
            h * 0.5,
            (3.4 - tier * 0.67) * p.s,
            this.random() * TAU,
          );
          color.setHSL(
            0.29 + this.random() * 0.055,
            0.25 + this.random() * 0.12,
            0.17 + tier * 0.025 + this.random() * 0.06,
          );
          foliage.setColorAt(pIndex++, color);
        }
      } else {
        for (let j = 0; j < 4; j++) {
          const angle = (j * TAU) / 3;
          this.instance(
            broadLeaves,
            bIndex,
            p.x + Math.sin(angle) * p.s * 1.3,
            y + h * 0.83 + (j === 3 ? 1.3 : 0),
            p.z + Math.cos(angle) * p.s * 1.3,
            3 * p.s,
            2.5 * p.s,
            2.5 * p.s,
            this.random() * TAU,
          );
          color.setHSL(
            0.19 + this.random() * 0.12,
            0.32,
            0.29 + this.random() * 0.11,
          );
          broadLeaves.setColorAt(bIndex++, color);
        }
      }
    });
    [trunks, foliage, broadLeaves].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    });
  }
  private createGrass() {
    const verts = [
      -0.25, 0, 0, 0.25, 0, 0, 0.035, 1, 0, 0, 0, -0.25, 0, 0, 0.25, 0, 1,
      0.035,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const grass = new THREE.InstancedMesh(
      geo,
      this.windMaterial(0.16, true),
      9500,
    );
    const color = new THREE.Color();
    let index = 0;
    for (let tries = 0; tries < 22000 && index < 9500; tries++) {
      const x = (this.random() - 0.5) * 120,
        z = this.random() * 145 - 85;
      if (Math.abs(x - pathX(z)) < 2.6 && z > -67 && z < 35) continue;
      if (Math.hypot(x, z + 58) < 13.5) continue;
      if (x > -43 && x < -26 && z > -34 && z < 22) continue;
      const s = 0.3 + this.random() * 0.6;
      this.instance(
        grass,
        index,
        x,
        terrainHeight(x, z) - 0.04,
        z,
        s,
        0.3 + this.random() * 0.55,
        s,
        this.random() * TAU,
      );
      color.setHSL(
        0.19 + this.random() * 0.13,
        0.25 + this.random() * 0.18,
        0.27 + this.random() * 0.18,
      );
      grass.setColorAt(index++, color);
    }
    grass.count = index;
    grass.receiveShadow = true;
    this.grasses = grass;
    this.scene.add(grass);
    const flowers = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.09, 0),
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.8,
        emissive: "#a37e33",
        emissiveIntensity: 0.12,
      }),
      600,
    );
    for (let i = 0; i < 600; i++) {
      const x = (this.random() - 0.5) * 70,
        z = this.random() * 95 - 63;
      this.instance(flowers, i, x, terrainHeight(x, z) + 0.3, z, 1, 1, 1);
      color.set(i % 4 === 0 ? "#c8b1d8" : i % 3 === 0 ? "#e9d9af" : "#cab85d");
      flowers.setColorAt(i, color);
    }
    this.flowers = flowers;
    this.scene.add(flowers);
  }
  private createRocks() {
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        flatShading: true,
        roughness: 1,
      }),
      110,
    );
    const color = new THREE.Color();
    let count = 0;
    for (let i = 0; i < 700 && count < 110; i++) {
      const x = (this.random() - 0.5) * 125,
        z = this.random() * 145 - 85;
      if (this.keepClear(x, z, 0)) continue;
      const s = 0.5 + this.random() * 1.7;
      this.instance(
        rocks,
        count,
        x,
        terrainHeight(x, z) + s * 0.35,
        z,
        s,
        s * 0.7,
        s * 0.8,
        this.random() * TAU,
      );
      color.setHSL(
        0.1 + this.random() * 0.06,
        0.06 + this.random() * 0.09,
        0.37 + this.random() * 0.16,
      );
      rocks.setColorAt(count++, color);
      this.obstacle(x, z, s * 0.72, s * 0.58, s * 0.9);
    }
    rocks.count = count;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.scene.add(rocks);
  }
  private house(
    x: number,
    z: number,
    width: number,
    depth: number,
    yaw: number,
  ) {
    const group = new THREE.Group();
    group.position.set(x, terrainHeight(x, z), z);
    group.rotation.y = yaw;
    this.scene.add(group);
    const plaster = new THREE.MeshStandardMaterial({
      color: "#b2a48b",
      roughness: 1,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: "#655751",
      roughness: 1,
      flatShading: true,
    });
    this.box(width, 3.8, depth, 0, 1.9, 0, plaster, group);
    this.box(width + 0.3, 0.35, depth + 0.3, 0, 0.2, 0, this.darkStone, group);
    for (const px of [-width / 2, width / 2])
      for (const pz of [-depth / 2, depth / 2])
        this.box(0.22, 4.1, 0.22, px, 2, pz, this.wood, group);
    this.box(width, 0.18, 0.2, 0, 2.7, depth / 2 + 0.02, this.wood, group);
    this.box(width, 0.18, 0.2, 0, 3.8, depth / 2 + 0.02, this.wood, group);
    const roof = new THREE.ConeGeometry(1, 2.8, 4);
    roof.rotateY(Math.PI / 4);
    const roofMesh = this.mesh(roof, roofMat, 0, 5.1, 0, group);
    roofMesh.scale.set(width * 0.85, 1, depth * 0.85);
    this.box(1, 1.9, 0.16, 0, 1.15, depth / 2 + 0.08, this.wood, group);
    for (const px of [-width * 0.3, width * 0.3]) {
      this.box(0.8, 0.95, 0.18, px, 2.1, depth / 2 + 0.1, this.wood, group);
      this.box(
        0.55,
        0.7,
        0.19,
        px,
        2.1,
        depth / 2 + 0.13,
        new THREE.MeshStandardMaterial({
          color: "#e9bf79",
          emissive: "#d28a35",
          emissiveIntensity: 0.7,
        }),
        group,
      );
      this.box(0.07, 0.76, 0.2, px, 2.1, depth / 2 + 0.15, this.wood, group);
    }
    this.box(0.7, 2, 0.7, width * 0.25, 5, 0, this.darkStone, group);
    this.obstacle(x, z, width * 0.52, depth * 0.52, 4.5, yaw);
  }
  private lantern(x: number, z: number) {
    const y = terrainHeight(x, z);
    this.box(0.12, 3.0, 0.12, x, y + 1.5, z, this.wood);
    this.box(0.7, 0.1, 0.12, x + 0.27, y + 2.95, z, this.wood);
    this.box(0.42, 0.6, 0.4, x + 0.53, y + 2.5, z, this.metal);
    this.box(
      0.3,
      0.42,
      0.3,
      x + 0.53,
      y + 2.5,
      z,
      new THREE.MeshStandardMaterial({
        color: "#ffdc95",
        emissive: "#ffab48",
        emissiveIntensity: 1.8,
      }),
    );
    const light = new THREE.PointLight("#ffc06e", 1.3, 7, 2);
    light.position.set(x + 0.53, y + 2.4, z);
    this.scene.add(light);
  }
  private createVillage() {
    this.house(17, 22, 6, 5, -0.55);
    this.house(-17, 27, 6, 6, 0.4);
    this.house(24, 9, 5, 5, -0.4);
    for (const x of [-8, 8]) this.lantern(x, 18);
    this.lantern(8, -27);
    this.lantern(-8, -38);
    const well = new THREE.Group();
    well.position.set(11, terrainHeight(11, 24), 24);
    this.scene.add(well);
    this.mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 1, 12, 1, true),
      this.stone,
      0,
      0.5,
      0,
      well,
    );
    this.mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.05, 12),
      new THREE.MeshStandardMaterial({
        color: "#2b4b49",
        metalness: 0.5,
        roughness: 0.15,
      }),
      0,
      0.4,
      0,
      well,
    );
    for (const x of [-1.1, 1.1])
      this.box(0.15, 3, 0.15, x, 1.6, 0, this.wood, well);
    this.box(3, 0.15, 1.4, 0, 3.15, 0, this.wood, well);
    this.obstacle(11, 24, 1.2, 1.2, 3.2);
    const fence = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.wood,
      50,
    );
    let index = 0;
    for (let i = 0; i < 10; i++) {
      const x = 9 + i * 1.5,
        z = 30;
      this.instance(
        fence,
        index++,
        x,
        terrainHeight(x, z) + 0.65,
        z,
        0.13,
        1.3,
        0.13,
      );
      if (i < 9)
        for (const h of [0.4, 0.95])
          this.instance(
            fence,
            index++,
            x + 0.75,
            terrainHeight(x, z) + h,
            z,
            1.5,
            0.1,
            0.1,
          );
    }
    fence.count = index;
    fence.castShadow = true;
    this.scene.add(fence);
    // A small campfire marks the first safe clearing.
    const ash = new THREE.MeshStandardMaterial({
      color: "#34342c",
      roughness: 1,
    });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      this.mesh(
        new THREE.DodecahedronGeometry(0.3, 0),
        ash,
        -6 + Math.cos(a) * 0.8,
        terrainHeight(-6, 11) + 0.2,
        11 + Math.sin(a) * 0.8,
      );
    }
    const flame = this.mesh(
      new THREE.ConeGeometry(0.3, 0.9, 6),
      new THREE.MeshStandardMaterial({
        color: "#ffc66a",
        emissive: "#ff7c24",
        emissiveIntensity: 2,
      }),
      -6,
      terrainHeight(-6, 11) + 0.45,
      11,
    );
    flame.castShadow = false;
    const fire = new THREE.PointLight("#ffaf5f", 3.5, 9, 2);
    fire.position.set(-6, terrainHeight(-6, 11) + 1, 11);
    this.scene.add(fire);
    // Quest giver: a cloaked traveller with a luminous staff.
    const npc = new THREE.Group();
    npc.position.set(5, terrainHeight(5, 15), 15);
    npc.rotation.y = -0.6;
    this.scene.add(npc);
    const cloak = new THREE.MeshStandardMaterial({
      color: "#677e77",
      roughness: 1,
      flatShading: true,
    });
    this.mesh(new THREE.ConeGeometry(0.43, 1.35, 8), cloak, 0, 0.76, 0, npc);
    this.mesh(
      new THREE.IcosahedronGeometry(0.24, 1),
      new THREE.MeshStandardMaterial({ color: "#c5aa86", roughness: 1 }),
      0,
      1.65,
      0.03,
      npc,
    );
    this.mesh(
      new THREE.ConeGeometry(0.34, 0.55, 7),
      cloak,
      0,
      1.87,
      -0.04,
      npc,
    );
    this.box(0.12, 1.1, 0.12, 0.44, 0.8, 0, this.wood, npc);
    this.mesh(new THREE.OctahedronGeometry(0.14), this.glow, 0.44, 1.5, 0, npc);
    this.interactables.push({
      id: "elder",
      type: "npc",
      x: 5,
      z: 15,
      label: "Speak to the Waykeeper",
      used: false,
    });
    // Roadside sign, readable through the interaction UI.
    this.box(0.14, 2.1, 0.14, -4, terrainHeight(-4, 21) + 1.05, 21, this.wood);
    this.box(
      1.7,
      0.42,
      0.12,
      -4,
      terrainHeight(-4, 21) + 1.8,
      21,
      this.wood,
    ).rotation.z = 0.07;
  }
  private createRuins() {
    // An ancient gateway straddles the open road. Pillars are solid; the arch is safely overhead.
    const gateZ = -27;
    for (const side of [-1, 1]) {
      const x = side * 6.5,
        y = terrainHeight(x, gateZ);
      this.box(2.2, 0.5, 2.5, x, y + 0.25, gateZ, this.darkStone);
      this.box(1.6, 7.3, 1.8, x, y + 4, gateZ, this.stone);
      this.box(2, 0.4, 2.2, x, y + 7.7, gateZ, this.lightStone);
      this.box(0.35, 3, 0.2, x, y + 4, gateZ + 1, this.darkStone);
      this.obstacle(x, gateZ, 1, 1.1, 8);
      this.mesh(
        new THREE.OctahedronGeometry(0.3, 0),
        this.glow,
        x,
        y + 6.4,
        gateZ + 1.1,
      );
    }
    // Open semicircular stone arch using individual voussoirs.
    for (let i = 0; i <= 12; i++) {
      const a = (Math.PI * i) / 12,
        x = Math.cos(a) * 6.4,
        y = 4.9 + Math.sin(a) * 4.2;
      const block = this.box(1.55, 0.9, 1.7, x, y, gateZ, this.stone);
      block.rotation.z = a - Math.PI / 2;
    }
    // Broken buttress and a large silhouette beside the gateway.
    for (const side of [-1, 1]) {
      const x = side * 12.4,
        z = -30,
        y = terrainHeight(x, z);
      this.box(3.4, 2.5, 1.6, x, y + 1.25, z, this.darkStone);
      this.obstacle(x, z, 1.7, 0.8, 2.5);
      this.box(1.2, 5, 1.3, x + side * 1.2, y + 2.5, z, this.stone);
    }
    // Guardian arena: weathered radial paving, shattered pillars, a broken altar.
    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(12.5, 48),
      new THREE.MeshStandardMaterial({ color: "#777f6e", roughness: 1 }),
    );
    arena.rotation.x = -Math.PI / 2;
    arena.position.set(0, -0.267, -58);
    arena.receiveShadow = true;
    this.scene.add(arena);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(10.7, 10.85, 64),
      this.lightStone,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, -0.25, -58);
    this.scene.add(ring);
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(4.8, 4.9, 48),
      this.darkStone,
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.set(0, -0.247, -58);
    this.scene.add(innerRing);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU,
        x = Math.cos(a) * 14,
        z = -58 + Math.sin(a) * 14,
        y = terrainHeight(x, z),
        h = i % 3 === 0 ? 2.2 : 5.8;
      this.box(2.2, 0.5, 2.2, x, y + 0.25, z, this.darkStone);
      this.mesh(
        new THREE.CylinderGeometry(0.65, 0.85, h, 7),
        this.stone,
        x,
        y + h / 2 + 0.5,
        z,
      );
      this.box(1.8, 0.45, 1.8, x, y + h + 0.6, z, this.lightStone);
      this.obstacle(x, z, 0.9, 0.9, h + 0.6);
    }
    // Collapsed stones at one side, away from the combat floor.
    for (let i = 0; i < 12; i++) {
      const x = -19 + this.random() * 5,
        z = -57 + this.random() * 12,
        y = terrainHeight(x, z);
      const m = this.box(
        0.8 + this.random(),
        0.6 + this.random(),
        1.3,
        x,
        y + 0.3,
        z,
        i % 2 ? this.stone : this.lightStone,
      );
      m.rotation.set(
        this.random() * 0.5,
        this.random() * TAU,
        this.random() * 0.3,
      );
    }
    // A ruined watchtower visible from the opening vista.
    const towerX = -24,
      towerZ = -13,
      y = terrainHeight(towerX, towerZ);
    const tower = this.mesh(
      new THREE.CylinderGeometry(2.9, 3.3, 14, 9),
      this.darkStone,
      towerX,
      y + 7,
      towerZ,
    );
    const cap = this.mesh(
      new THREE.CylinderGeometry(3.4, 3.1, 0.7, 9),
      this.stone,
      towerX,
      y + 14,
      towerZ,
    );
    tower.castShadow = true;
    cap.castShadow = true;
    for (let i = 0; i < 7; i++) {
      const a = (i / 9) * TAU;
      this.box(
        0.9,
        1.5,
        0.9,
        towerX + Math.cos(a) * 2.8,
        y + 14.8,
        towerZ + Math.sin(a) * 2.8,
        this.stone,
      );
    }
    this.obstacle(towerX, towerZ, 3, 3, 15);
  }
  private createMountains() {
    const material = new THREE.MeshStandardMaterial({
      color: "#5d7976",
      flatShading: true,
      roughness: 1,
    });
    const farMaterial = new THREE.MeshStandardMaterial({
      color: "#78918b",
      flatShading: true,
      roughness: 1,
    });
    const snowy = new THREE.MeshStandardMaterial({
      color: "#b8c6b6",
      flatShading: true,
      roughness: 1,
    });
    for (let i = 0; i < 23; i++) {
      const a = (i / 23) * TAU,
        r = 135 + this.random() * 65,
        x = Math.sin(a) * r,
        z = Math.cos(a) * r - 35,
        h = 22 + this.random() * 50;
      const mountain = this.mesh(
        new THREE.ConeGeometry(
          24 + this.random() * 20,
          h,
          5 + Math.floor(this.random() * 3),
        ),
        i % 2 ? material : farMaterial,
        x,
        h * 0.35 - 9,
        z,
      );
      mountain.rotation.y = this.random() * TAU;
      mountain.castShadow = false;
      if (h > 52) {
        const snow = this.mesh(
          new THREE.ConeGeometry(7, h * 0.23, 5),
          snowy,
          x,
          h * 0.78 - 9,
          z,
        );
        snow.castShadow = false;
      }
    }
    // The distant keep anchors the horizon without increasing playable-world scope.
    const castle = new THREE.Group();
    castle.position.set(23, 7, -105);
    this.scene.add(castle);
    const mat = new THREE.MeshStandardMaterial({
      color: "#6a7973",
      roughness: 1,
      flatShading: true,
    });
    this.box(21, 10, 8, 0, 5, 0, mat, castle);
    for (const x of [-11, 11])
      for (const z of [-4.5, 4.5]) {
        this.mesh(
          new THREE.CylinderGeometry(2.3, 2.7, 17, 8),
          mat,
          x,
          8.5,
          z,
          castle,
        );
        this.mesh(
          new THREE.ConeGeometry(3, 7, 8),
          this.darkStone,
          x,
          20,
          z,
          castle,
        );
      }
    this.box(6, 19, 7, 0, 12, -2, mat, castle);
    this.mesh(
      new THREE.ConeGeometry(5, 8, 4),
      this.darkStone,
      0,
      25,
      -2,
      castle,
    ).rotation.y = Math.PI / 4;
    for (let i = 0; i < 12; i++)
      this.box(0.8, 1.2, 1, -9.5 + i * 1.7, 10.5, 4, mat, castle);
    for (let i = 0; i < 4; i++)
      this.box(0.7, 1.7, 0.15, -4.5 + i * 3, 7, 4.1, this.darkStone, castle);
  }
  private createInteractables() {
    const locations = [
      { id: "chest-clearing", x: 10, z: 3 },
      { id: "chest-ruin", x: -16, z: -23 },
      { id: "chest-altar", x: 12, z: -45 },
    ];
    for (const p of locations) {
      const root = new THREE.Group();
      root.position.set(p.x, terrainHeight(p.x, p.z), p.z);
      root.rotation.y = -0.35;
      this.scene.add(root);
      this.box(1.1, 0.65, 0.7, 0, 0.35, 0, this.wood, root);
      for (const x of [-0.4, 0.4])
        this.box(0.08, 0.68, 0.73, x, 0.35, 0, this.metal, root);
      const lid = new THREE.Group();
      lid.position.set(0, 0.65, -0.35);
      root.add(lid);
      this.box(1.15, 0.22, 0.75, 0, 0.08, 0.35, this.wood, lid);
      for (const x of [-0.4, 0.4])
        this.box(0.09, 0.24, 0.78, x, 0.08, 0.35, this.metal, lid);
      this.box(0.16, 0.25, 0.1, 0, 0.58, 0.4, this.metal, root);
      this.chestLids.set(p.id, lid);
      this.interactables.push({
        ...p,
        type: "chest",
        label: "Open forgotten chest",
        used: false,
      });
    }
  }
  private createWater() {
    const geo = new THREE.CircleGeometry(1, 64);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: "#648f83",
        metalness: 0.45,
        roughness: 0.23,
        transparent: true,
        opacity: 0.85,
      }),
    );
    water.position.set(-34, -1.18, -6);
    water.scale.set(8.0, 1, 28);
    water.receiveShadow = true;
    this.scene.add(water);
    // Low, rippled banks and reeds keep the lake a distinct side destination.
    const reeds = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.13, 1.3, 4),
      new THREE.MeshStandardMaterial({ color: "#8d9962", roughness: 1 }),
      160,
    );
    for (let i = 0; i < 160; i++) {
      const a = this.random() * TAU,
        x = -34 + Math.cos(a) * (7.5 + this.random()),
        z = -6 + Math.sin(a) * (25 + this.random() * 3);
      this.instance(
        reeds,
        i,
        x,
        terrainHeight(x, z) + 0.4,
        z,
        1,
        0.7 + this.random(),
        1,
        this.random() * TAU,
      );
    }
    this.scene.add(reeds);
    return water;
  }
  private createShrine() {
    const x = 0,
      z = -68,
      y = terrainHeight(x, z);
    this.mesh(
      new THREE.CylinderGeometry(1.5, 1.8, 0.4, 8),
      this.darkStone,
      x,
      y + 0.2,
      z,
    );
    this.mesh(
      new THREE.CylinderGeometry(0.55, 0.85, 1.4, 6),
      this.stone,
      x,
      y + 1.1,
      z,
    );
    const group = new THREE.Group();
    group.position.set(x, y + 2.4, z);
    this.scene.add(group);
    const crystal = this.mesh(
      new THREE.OctahedronGeometry(0.6, 0),
      this.glow,
      0,
      0,
      0,
      group,
    );
    crystal.scale.y = 1.6;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.035, 6, 32),
      this.metal,
    );
    ring.rotation.x = Math.PI / 3;
    group.add(ring);
    const light = new THREE.PointLight("#6de8cf", 3, 12, 2);
    light.position.set(x, y + 3, z);
    this.scene.add(light);
    this.interactables.push({
      id: "ancient-shrine",
      type: "shrine",
      x,
      z,
      label: "Touch the Ancient Flame",
      used: false,
    });
    return group;
  }
  private createClouds() {
    const root = new THREE.Group();
    this.scene.add(root);
    const geo = new THREE.IcosahedronGeometry(1, 1),
      mat = new THREE.MeshStandardMaterial({
        color: "#d8d5b7",
        roughness: 1,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      });
    for (let i = 0; i < 18; i++) {
      const x = (this.random() - 0.5) * 280,
        z = (this.random() - 0.5) * 250,
        y = 44 + this.random() * 22;
      const cloud = this.mesh(geo, mat, x, y, z, root);
      cloud.scale.set(
        12 + this.random() * 12,
        1.5 + this.random() * 2,
        4 + this.random() * 6,
      );
      cloud.castShadow = false;
    }
    return root;
  }
  resetInteractables() {
    for (const item of this.interactables) item.used = false;
    for (const lid of this.chestLids.values()) lid.rotation.x = 0;
  }
  openChest(id: string) {
    const item = this.interactables.find((i) => i.id === id);
    if (item) item.used = true;
    const lid = this.chestLids.get(id);
    if (lid) lid.rotation.x = -Math.PI * 0.68;
  }
  setQuality(high: boolean) {
    if (this.grasses) this.grasses.visible = high;
    if (this.flowers) this.flowers.visible = high;
    this.motes.visible = high;
  }
  update(_dt: number, time: number) {
    for (const uniform of this.windTimes) uniform.value = time;
    this.rune.rotation.y = time * 0.35;
    this.rune.position.y =
      terrainHeight(0, -68) + 2.4 + Math.sin(time * 1.5) * 0.15;
    this.clouds.position.x = Math.sin(time * 0.006) * 8;
    this.water.position.y = -1.18 + Math.sin(time * 0.7) * 0.015;
    const positions = this.motes.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      positions.setXYZ(
        i,
        this.moteOrigins[i * 3] + Math.sin(time * 0.3 + i) * 0.6,
        this.moteOrigins[i * 3 + 1] + Math.sin(time * 0.6 + i * 2) * 0.25,
        this.moteOrigins[i * 3 + 2] + Math.cos(time * 0.2 + i) * 0.3,
      );
    }
    positions.needsUpdate = true;
  }
}
