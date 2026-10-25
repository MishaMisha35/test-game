import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { PRESETS, type GameSettings } from "./SettingsSystem";

/** Bloom and optional camera-motion blur; Low/Medium bypass all targets by default. */
export class RenderPipeline {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private enabled = false;
  private blur = false;
  private size = new THREE.Vector2();
  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.22,
      0.45,
      1.15,
    );
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        motion: { value: new THREE.Vector2() },
        strength: { value: 0 },
      },
      vertexShader:
        "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `uniform sampler2D tDiffuse;uniform vec2 motion;uniform float strength;varying vec2 vUv;
      void main(){vec2 d=(vec2(motion.x,0.)+(vUv-.5)*motion.y)*strength;vec4 c=texture2D(tDiffuse,vUv)*.4;
      c+=texture2D(tDiffuse,clamp(vUv+d*.5,.001,.999))*.2;c+=texture2D(tDiffuse,clamp(vUv-d*.5,.001,.999))*.2;
      c+=texture2D(tDiffuse,clamp(vUv+d,.001,.999))*.1;c+=texture2D(tDiffuse,clamp(vUv-d,.001,.999))*.1;
      c.rgb*=mix(1.,.94,smoothstep(.25,.8,length(vUv-.5)));gl_FragColor=c;}`,
    });
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }
  configure(settings: GameSettings) {
    this.enabled = PRESETS[settings.quality].bloom || settings.motionBlur;
    this.bloom.enabled = PRESETS[settings.quality].bloom;
    this.blur = settings.motionBlur;
    this.resize();
  }
  resize() {
    this.renderer.getSize(this.size);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.size.x, this.size.y);
  }
  render(dt: number, motion: number, sprinting: boolean) {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.grade.uniforms.strength.value = this.blur ? 1 : 0;
    (this.grade.uniforms.motion.value as THREE.Vector2).set(
      THREE.MathUtils.clamp(motion, -0.015, 0.015),
      sprinting ? 0.008 : 0,
    );
    this.composer.render(dt);
  }
}
