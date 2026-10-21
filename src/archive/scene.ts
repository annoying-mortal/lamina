import * as THREE from "three";
import { ArchiveVisibility } from "./archive-visibility";
import { ArchiveDrawCoverage, ArchiveShadowCoverage } from "./archive-draw-coverage";
import { InstanceUpdates } from "./instance-updates";
import { RenderState } from "./render-state";
import { SharedDepthAO, SharedDepthBokeh } from "./shared-depth";
import { disposeThreeTree } from "./three-resources";
import { ThemeWave } from "./theme-motion";
import { themeMaterial, themeEnvironment } from "./theme-material";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createArchiveLighting } from "./archive-lighting";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { archiveQuality } from "./render-quality";
import { resizeQuality } from "./quality-renderer";
import { CardAppearance } from "./appearance";
import { configureInternalOptics } from "./internal-optics";
import { archiveColumns, archiveBranding, rowRebasePeriod, fileAtSlot, fileLocation } from "./data";
import {
  cellKey,
  sameCell,
  selectionCell,
  fileAtCell,
  poolCell,
  LOOP_COLUMNS,
  LOOP_ROWS,
  COLUMN_SPACING,
  ROW_SPACING,
  type ArchiveCell,
  type ArchiveNavigation,
} from "./archive-loop";
import { labelMarkSvg } from "./brand";
import { archiveFraming } from "./viewport-layout";
import { ArchiveDrag, ArchivePlaneMomentum, type DragAxis, type DragProjection, type DragPosition } from "./archive-drag";
import { fullMotion, type MotionPreferences } from "./motion-preferences";
import {
  baselineSelectionWave,
  settlingWave,
  damp,
  columnStrength,
  idleWave,
  INSPECTION_LIFT,
  returnStep,
} from "./motion";

const ease = (t: number) => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export class ArchiveScene {
  private inputEvents = new AbortController();
  private disposed = false;
  private inputEnabled = true;
  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.cancelPointer();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.inputEvents.abort();
    this.cancelPointer();
    disposeThreeTree(this.scene);
    this.appearance.disposeSources();
    this.model.clear();
    this.outgoing = [];
    this.instances = [];
    this.light.shadow.map?.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.loaded = false;
  }
  private theme = new ThemeWave();
  private subduedIndex = { value: 0 };
  private themeAttribute?: THREE.InstancedBufferAttribute;
  private get themeAmount() { return this.theme.background(performance.now() / 1000); }
  setTheme(dark: boolean, immediate = false) { this.theme.set(dark, performance.now() / 1000, this.selectedCell, immediate); }
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  // The reference uses a long lens 72–140 units from the cassette. A 0.1 near
  // plane quantizes adjacent optical layers to the same depth (visible shimmer).
  // All visible foreground geometry is beyond 5; retain the framing and lens.
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 5, 300);
  private composer: EffectComposer;
  private ao: SharedDepthAO;
  private bokeh: BokehPass;
  private instances: THREE.InstancedMesh[] = [];
  private matrixUpdates?: InstanceUpdates;
  private themeUpdates?: InstanceUpdates;
  private renderState = new RenderState();
  private shadowState = new RenderState();
  private visibility = new ArchiveVisibility();
  private drawCoverage = new ArchiveDrawCoverage();
  private shadowCoverage?: ArchiveShadowCoverage;
  private instanceCapacity = LOOP_COLUMNS * LOOP_ROWS;
  private drawnCells: ArchiveCell[] = [];
  private model = new THREE.Group();
  private appearance = new CardAppearance();
  private cursor = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private dummy = new THREE.Object3D();
  private selectedCell: ArchiveCell = { lane: 2, row: 12 };
  private looping = false;
  private coordinateOrigin: ArchiveCell = { lane: 0, row: 0 };
  private lift = { value: 0, velocity: 0 };
  private rail = { value: 0, velocity: 0 };
  private shoulder = { value: 12, velocity: 0 };
  private laneFocus = { value: 2, velocity: 0 };
  private columnCamera = { value: 0, velocity: 0 };
  private returnY: number | null = null;
  private canInspect = false;
  private clearance = 0;
  private pulseGain = 1;
  private idleGain = 0;
  private lastInteraction = 0;
  private cameraAim = new THREE.Vector3();
  private outgoing: {
    group: THREE.Group;
    cell: ArchiveCell;
    lift: { value: number; velocity: number };
    returnY: number | null;
  }[] = [];
  private pulses: { row: number; lane: number; time: number }[] = [];
  private selectedSlot = 0;
  private detail = 0;
  private targetDetail = 0;
  private reveal = 0;
  private targetReveal = 0;
  private last = 0;
  private pointer = new THREE.Vector2();
  private dragging = false;
  private hoverCell: ArchiveCell | null = null;
  private hoverLifts = new Map<string, number>();
  private archiveDrag = new ArchiveDrag();
  private dragTrack: DragPosition | null = null;
  private navigatingDrag = false;
  private archiveMomentum: { motion: ArchivePlaneMomentum; time: number } | null = null;
  private holdingArchive = false;
  private cancelPointer = () => {};
  private pendingHover: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType'> | null = null;
  private flushHover = () => {};
  private rotation = 0;
  private targetRotation = 0;
  private light: THREE.DirectionalLight;
  private clock = 0;
  private loaded = false;
  private labelCanvas = document.createElement("canvas");
  private labelTexture?: THREE.CanvasTexture;
  private labelMark = new Image();
  private motion: MotionPreferences = fullMotion();
  private readonly quality = archiveQuality;
  onSelect?: (index: number, cell?: ArchiveCell) => void;
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, 1.5) *
        Math.min(innerWidth / 1920, innerHeight / 1080),
    );
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    // All composer passes see the same geometry within one application frame.
    // Generate the shadow map in the beauty pass and reuse it in depth/normal passes.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D archive. Drag or use arrow keys to select. Press Enter to preview.",
    );
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.renderState.invalidate();
      this.shadowState.invalidate();
    }, { signal: this.inputEvents.signal });
    this.scene.background = new THREE.Color("#eae5e1");
    // The frame updates world matrices once after simulation; subsequent
    // beauty, normal, depth and transmission renders reuse those same matrices.
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.fog = new THREE.Fog("#eae5e1", 22, 47);
    this.light = createArchiveLighting(this.renderer, this.scene);
    this.light.castShadow = true;
    Object.assign(this.light.shadow.camera, {
      left: -16,
      right: 16,
      top: 15,
      bottom: -15,
      near: 0.1,
      far: 45,
    });
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.normalBias = 0.035;
    this.light.shadow.bias = -0.0003;
    this.light.shadow.radius = 4;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: "#d8c9b9", roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.name = "archive-floor";
    floor.position.y = -4.63;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.camera.position.set(-62.26, 35.98, 43.28);
    this.cameraAim.set(-0.5, 1.1, 0.4);
    this.camera.fov = 6.15;
    this.camera.lookAt(this.cameraAim);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new SharedDepthAO(
      this.scene,
      this.camera,
      container.clientWidth,
      container.clientHeight,
    );
    this.ao.kernelRadius = 0.38;
    this.ao.minDistance = 0.001;
    this.ao.maxDistance = 0.09;
    this.composer.addPass(this.ao);
    this.bokeh = new SharedDepthBokeh(this.scene, this.camera, {
      focus: 25,
      aperture: 0.0018,
      maxblur: 0.011,
    }, () => this.ao);
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());
    this.bindPointer();
  }
  async load() {
    // Canvas text does not repaint itself when a webfont finishes loading.
    // Load only the label's glyph ranges and refresh the same texture in place.
    if (document.fonts) {
      void Promise.allSettled([
        document.fonts.load(`400 32px ${this.labelFontFamily()}`, archiveBranding.subtitle + ' FN / 01'),
        document.fonts.load(`700 81px ${this.labelFontFamily()}`, archiveBranding.title + ' NO.0123456789 INFO'),
      ]).then(() => {
        if (this.disposed) return;
        this.drawLabel(fileAtSlot(this.selectedSlot));
        this.renderState.invalidate();
      });
    }
    this.labelMark.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelMarkSvg)}`;
    await this.labelMark.decode();
    const gltf = await new GLTFLoader().loadAsync(
      "/assets/archive-cassette.glb",
    );
    if (this.disposed) {
      disposeThreeTree(gltf.scene);
      throw new DOMException("Archive scene was disposed", "AbortError");
    }
    gltf.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    const count = LOOP_COLUMNS * LOOP_ROWS;
    for (const mesh of meshes) {
      const geom = mesh.geometry
        .clone()
        .applyMatrix4(mesh.matrixWorld)
        .scale(1, 1, 1);
      const source = mesh.material as THREE.MeshStandardMaterial;
      const name = source.name.replace(/\.\d+$/, "");
      const mat = source.clone() as THREE.MeshPhysicalMaterial;
      mat.envMapIntensity = 0.6;
      if (name === "Frosted_Polymer") {
        mat.color.set("#fffdfa");
        mat.transmission = 0.9;
        mat.thickness = 0.12;
        mat.roughness = 0.21;
        mat.ior = 1.46;
        mat.attenuationColor = new THREE.Color("#eee6df");
        mat.attenuationDistance = 2;
      }
      if (name === "Internal_Ceramic") {
        mat.color.set("#c7beb6");
        mat.roughness = 0.6;
      }
      if (name === "Printed_Label") mat.color.set("#eae5dc");
      if (name === "Ivory_Edges") {
        mat.color.set("#f0e7df");
        mat.roughness = 0.31;
        mat.transmission = 0.65;
        mat.thickness = 0.04;
      }
      if (name === "Optical_Diffuser") {
        mat.color.set("#e2dad4");
        mat.transmission = 0;
        mat.roughness = 0.7;
      }
      if (name === "Subsurface_Optics") {
        mat.color.set("#b9aba1");
        mat.roughness = 0.48;
        mat.metalness = 0.05;
      }
      if (name === "Optical_Edges") {
        // Internal refractive shoulders must be in the opaque capture: WebGL's
        // screen-space transmission cannot recursively sample another glass mesh.
        mat.transmission = 0;
        mat.color.set("#d4c7be");
        mat.roughness = 0.26;
        mat.metalness = 0.08;
      }
      configureInternalOptics(name, mat);
      if (name === "Carbon_Ink") { geom.dispose(); mat.dispose(); continue; }
      const selectedMesh = new THREE.Mesh(geom, mat);
      selectedMesh.userData.surface = name;
      selectedMesh.castShadow = name === "Optical_Diffuser";
      selectedMesh.receiveShadow = true;
      this.model.add(selectedMesh);
      // Only the shell, edge and fasteners remain visible within tightly packed rows.
      // Keep sub-millimetre optical/typographic geometry on the extracted cassette.
      if (
        ![
          "Frosted_Polymer",
          "Ivory_Edges",
          "Titanium_Fasteners",
          "Index_Inlay",
          "Optical_Diffuser",
        ].includes(name)
      ) {
        this.appearance.register(name, mat);
        continue;
      }
      const arrayMat = mat.clone();
      if (name === "Frosted_Polymer") {
        arrayMat.transmission = 0.78;
        arrayMat.transparent = false;
        arrayMat.color.set("#fff7ed");
        arrayMat.onBeforeCompile = (shader) => {
          shader.vertexShader =
            "varying float vPanelHeight;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvPanelHeight = position.y / 3.7;",
          );
          shader.fragmentShader =
            "varying float vPanelHeight;\n" + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <color_fragment>",
            "#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(0.40, 0.30, 0.20), vec3(1.0, 0.98, 0.94), smoothstep(0.1, 1.0, vPanelHeight));",
          );
        };
        arrayMat.roughness = 0.28;
        arrayMat.clearcoat = 0.3;
        arrayMat.clearcoatRoughness = 0.25;
      }
      if (name === "Optical_Diffuser") arrayMat.color.set("#806447");
      if (name === "Ivory_Edges") {
        arrayMat.transmission = 0;
        arrayMat.color.set("#fff5e9");
        arrayMat.roughness = 0.38;
      }
      if (name === "Index_Inlay") {
        arrayMat.color.set("#e4d6c5");
        arrayMat.metalness = 0.05;
      }
      this.appearance.register(name, mat, arrayMat);
      this.themeAttribute ??= new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute("archiveTheme", this.themeAttribute);
      themeMaterial(arrayMat, name, true, this.subduedIndex);
      const inst = new THREE.InstancedMesh(geom, arrayMat, count);
      // All surfaces move rigidly together; share the transform buffer on the GPU.
      inst.instanceMatrix = this.instances[0]?.instanceMatrix ?? inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = name === "Optical_Diffuser";
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.instances.push(inst);
      this.scene.add(inst);
    }
    this.shadowCoverage = new ArchiveShadowCoverage(this.instances.find(mesh => mesh.castShadow)!);
    this.scene.add(this.shadowCoverage.mesh);
    this.labelCanvas.width = 1024;
    this.labelCanvas.height = 440;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    this.labelTexture.anisotropy =
      this.renderer.capabilities.getMaxAnisotropy();
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.99, 0.46),
      new THREE.MeshBasicMaterial({
        map: this.labelTexture,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      }),
    );
    label.position.set(-1.36, 3.04, 0.255);
    this.model.add(label);
    this.appearance.prepare(this.model);
    this.appearance.apply(this.model, 0);
    this.drawLabel(0);
    this.scene.add(this.model);
    this.model.position.copy(this.cellPosition(fileLocation(this.selectedSlot)));
    disposeThreeTree(gltf.scene);
    this.loaded = true;
  }

  /** Start on the restored article without replaying the reference opening. */
  prepareSelection(index: number) {
    this.select(index);
    this.columnCamera.value = (this.selectedCell.lane - 2) * COLUMN_SPACING;
    this.columnCamera.velocity = 0;
    this.rail.value = -2.17 - (this.selectedCell.row - 15.5) * ROW_SPACING;
    this.rail.velocity = 0;
    this.shoulder.value = this.selectedCell.row;
    this.laneFocus.value = this.selectedCell.lane;
    this.lift.value = .4;
    this.lift.velocity = 0;
    this.setMode("archive");
    this.reveal = this.targetReveal;
  }
  setMode(mode: "archive" | "detail") {
    this.cancelPointer();
    this.setHover(null);
    this.lastInteraction = this.clock;
    this.looping = true;
    this.targetReveal = 1;
    this.targetDetail = mode === "detail" ? 1 : 0;
    this.dragging = false;
    if (mode !== "detail") {
      this.targetRotation = 0;
      if (this.rotation !== 0) this.returnY = this.model.position.y;
    } else this.returnY = null;
  }
  setMotion(value: MotionPreferences) {
    if ((!value.pointerParallax || !value.dragMomentum) && (this.motion.pointerParallax || this.motion.dragMomentum)) this.cancelPointer();
    if (!value.dragMomentum) {
      this.archiveMomentum = null;
      this.columnCamera.velocity = 0;
      this.rail.velocity = 0;
    }
    if (!value.pointerParallax) this.pointer.set(0, 0);
    if (!value.selectionWave) this.pulses = [];
    if (!value.idleWave) this.idleGain = 0;
    this.motion = { ...value };
    this.appearance.setClarity(this.model, this.targetDetail);
    for (const old of this.outgoing) this.appearance.setClarity(old.group, 0);
  }
  private cellPosition(cell: ArchiveCell) {
    return new THREE.Vector3(
      (cell.lane - 2) * COLUMN_SPACING,
      -4.6,
      (cell.row - 15.5) * ROW_SPACING,
    );
  }
  private rebaseCoordinates() {
    // Periodically reduce the logical coordinates while preserving every
    // relative position, spring velocity, ripple and idle phase.
    const shift = {
      lane:
        Math.abs(this.selectedCell.lane) > 2048
          ? Math.round((this.selectedCell.lane - 2) / archiveColumns.length) * archiveColumns.length
          : 0,
      row:
        rowRebasePeriod > 0 && Math.abs(this.selectedCell.row) > Math.max(2048, rowRebasePeriod * 2)
          ? Math.floor((this.selectedCell.row - 12) / rowRebasePeriod) * rowRebasePeriod
          : 0,
    };
    if (!shift.lane && !shift.row) return;
    this.setHover(null);
    this.hoverLifts.clear();
    this.selectedCell.lane -= shift.lane;
    this.selectedCell.row -= shift.row;
    this.coordinateOrigin.lane += shift.lane;
    this.coordinateOrigin.row += shift.row;
    this.laneFocus.value -= shift.lane;
    this.shoulder.value -= shift.row;
    this.columnCamera.value -= shift.lane * COLUMN_SPACING;
    this.rail.value += shift.row * ROW_SPACING;
    for (const old of this.outgoing) {
      old.cell.lane -= shift.lane;
      old.cell.row -= shift.row;
    }
    for (const pulse of this.pulses) {
      pulse.lane -= shift.lane;
      pulse.row -= shift.row;
    }
  }
  select(index: number, navigation?: ArchiveNavigation) {
    if (!this.navigatingDrag) this.cancelPointer();
    this.setHover(null);
    this.lastInteraction = this.clock;
    const next = fileLocation(index).slot;
    const canonical = fileLocation(index);
    const cell = this.looping
      ? selectionCell(index, this.selectedCell, navigation)
      : { lane: canonical.lane, row: canonical.row };
    const changed = !sameCell(cell, this.selectedCell);
    if (this.looping && changed && this.loaded && this.lift.value > 0.0001) {
      const group = this.model.clone(true);
      const label = group.children[group.children.length - 1] as THREE.Mesh;
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 440;
      canvas.getContext("2d")!.drawImage(this.labelCanvas, 0, 0);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      label.material = new THREE.MeshBasicMaterial({
        map,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      });
      // Clone carries the selected label material by reference. Replace it
      // before installing appearance shaders, so theme hooks are not appended
      // to the original label a second time on every selection.
      this.appearance.prepare(group);
      this.appearance.apply(group, ease(this.lift.value / 0.4));
      this.appearance.setClarity(group, this.targetDetail);
      this.scene.add(group);
      this.outgoing.push({
        group,
        cell: { ...this.selectedCell },
        lift: { ...this.lift },
        returnY: group.rotation.y !== 0 ? group.position.y : null,
      });
      this.lift.value = 0;
      this.lift.velocity = 0;
    }
    this.selectedSlot = next;
    this.selectedCell = cell;
    if (changed) {
      this.rotation = 0;
      this.returnY = null;
    }
    const returning = this.outgoing.findIndex((o) => sameCell(o.cell, cell));
    if (returning >= 0) {
      const o = this.outgoing[returning];
      this.lift = { ...o.lift };
      this.rotation = o.group.rotation.y;
      this.returnY = o.returnY;
      this.scene.remove(o.group);
      this.appearance.dispose(o.group);
      this.outgoing.splice(returning, 1);
    }
    this.emitPulse(cell);
    this.targetRotation = 0;
    this.drawLabel(index);
  }
  private emitPulse(cell: ArchiveCell) {
    this.pulses.push({ ...cell, time: this.clock });
    this.pulses = this.pulses.slice(-6);
  }
  private labelFontFamily() {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-rhine").trim() || '"MiSans", "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  }
  private drawLabel(index: number) {
    if (!this.labelTexture) return;
    const c = this.labelCanvas.getContext("2d")!;
    c.fillStyle = "#e6e2d9";
    c.fillRect(0, 0, 1024, 440);
    c.fillStyle = "#171713";
    c.fillRect(12, 12, 1000, 6);
    c.fillRect(12, 419, 1000, 3);
    c.font = `700 81px ${this.labelFontFamily()}`;
    c.fillText(archiveBranding.title, 22, 116, 730);
    c.font = `400 32px ${this.labelFontFamily()}`;
    c.fillStyle = "#878476";
    c.fillText(archiveBranding.subtitle, 25, 174, 730);
    c.fillStyle = "#171713";
    c.font = `700 130px ${this.labelFontFamily()}`;
    c.fillText("NO." + String(index + 1).padStart(3, "0"), 22, 360);
    c.fillRect(782, 32, 221, 39);
    c.fillStyle = "#eee9de";
    c.font = `400 24px ${this.labelFontFamily()}`;
    const initials = archiveBranding.title.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join(' ');
    c.fillText(`${initials} / 01`, 809, 61, 175);
    c.fillStyle = "#171713";
    c.font = `700 64px ${this.labelFontFamily()}`;
    c.fillText("INFO", 830, 143);
    c.drawImage(this.labelMark, 790, 242, 210, 98);
    this.labelTexture.needsUpdate = true;
  }
  private ensureInstanceCapacity(required: number) {
    if (required <= this.instanceCapacity) return;
    const capacity = Math.max(required, this.instanceCapacity * 2);
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16).setUsage(THREE.DynamicDrawUsage);
    matrix.array.set(this.instances[0].instanceMatrix.array);
    for (const inst of this.instances) {
      inst.dispose();
      inst.instanceMatrix = matrix;
    }
    const previousTheme = this.themeAttribute;
    this.themeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    if (previousTheme) this.themeAttribute.array.set(previousTheme.array);
    for (const inst of this.instances) inst.geometry.setAttribute("archiveTheme", this.themeAttribute);
    this.matrixUpdates = new InstanceUpdates(matrix);
    this.themeUpdates = new InstanceUpdates(this.themeAttribute);
    this.instanceCapacity = capacity;
  }
  resize() {
    this.renderState.invalidate();
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    const dimensions = resizeQuality(
      this.renderer,
      this.composer,
      this.container,
      this.quality,
    );
    this.ao.setSize(
      Math.max(1, Math.floor(dimensions.width * this.quality.aoResolution)),
      Math.max(1, Math.floor(dimensions.height * this.quality.aoResolution)),
    );
    this.ao.setSharing(this.ao.enabled && this.bokeh.enabled && this.quality.aoResolution === 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  private canBrowse() {
    return (
      this.inputEnabled &&
      this.looping &&
      !this.targetDetail &&
      this.detail < 0.2 &&
      this.reveal >= 0.8 &&
      this.loaded &&
      !this.container.closest("[inert]")
    );
  }
  private setHover(cell: ArchiveCell | null) {
    if (
      (!cell && !this.hoverCell) ||
      (cell && this.hoverCell && sameCell(cell, this.hoverCell))
    )
      return;
    this.hoverCell = cell ? { ...cell } : null;
  }
  private pickCell(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.cursor.set(
      ((x - r.left) / r.width) * 2 - 1,
      (-(y - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.cursor, this.camera);
    const hit = this.raycaster.intersectObjects(
      [this.instances[0], this.model, ...this.outgoing.map((o) => o.group)],
      true,
    )[0];
    if (!hit) return null;
    if (hit.instanceId !== undefined) return { ...this.drawnCells[hit.instanceId] };
    let object: THREE.Object3D | null = hit.object;
    while (object) {
      const copy = this.outgoing.find((o) => o.group === object);
      if (copy) return { ...copy.cell };
      object = object.parent;
    }
    return { ...this.selectedCell };
  }
  private trackCoordinate(axis: DragAxis, value: number) {
    return axis === "lane"
      ? value / COLUMN_SPACING + 2
      : (-value - 2.17) / ROW_SPACING + 15.5;
  }
  private dragProjection(): DragProjection {
    this.model.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const center = this.model.localToWorld(new THREE.Vector3(0, 1.85, 0));
    const rect = this.renderer.domElement.getBoundingClientRect();
    const project = (motion: THREE.Vector3) => {
      const from = center
        .clone()
        .addScaledVector(motion, -0.5)
        .project(this.camera);
      const to = center
        .clone()
        .addScaledVector(motion, 0.5)
        .project(this.camera);
      return {
        x: ((to.x - from.x) * rect.width) / 2,
        y: (-(to.y - from.y) * rect.height) / 2,
      };
    };
    // Positive navigation moves the array along -X for columns and -Z for rows.
    return {
      lane: project(new THREE.Vector3(-COLUMN_SPACING, 0, 0)),
      row: project(new THREE.Vector3(0, 0, -ROW_SPACING)),
    };
  }
  private trackPosition(axis: DragAxis, coordinate: number) {
    return axis === "lane"
      ? (coordinate - 2) * COLUMN_SPACING
      : -2.17 - (coordinate - 15.5) * ROW_SPACING;
  }
  private navigatePlane(coordinate: DragPosition) {
    const goal = { lane: Math.round(coordinate.lane), row: Math.round(coordinate.row) };
    if (sameCell(goal, this.selectedCell)) return;
    const from = { ...this.selectedCell };
    const steps = Math.min(64, Math.max(Math.abs(goal.lane - from.lane), Math.abs(goal.row - from.row)));
    this.navigatingDrag = true;
    try {
      // Select physical cells along the travelled segment in one update per cell.
      // Column memory is updated by onSelect, but never pulls a held plane away.
      for (let i = 1; i <= steps; i++) {
        const cell = {
          lane: Math.round(from.lane + (goal.lane - from.lane) * i / steps),
          row: Math.round(from.row + (goal.row - from.row) * i / steps),
        };
        if (!sameCell(cell, this.selectedCell)) this.onSelect?.(fileAtCell(cell), cell);
      }
    } finally {
      this.navigatingDrag = false;
    }
  }
  private stopMomentum() {
    if (this.archiveMomentum) {
      this.columnCamera.velocity = 0;
      this.rail.velocity = 0;
    }
    this.archiveMomentum = null;
  }
  private bindPointer() {
    const canvas = this.renderer.domElement;
    let activePointer: number | null = null;
    let previousX = 0,
      startX = 0,
      startY = 0,
      moved = false;
    let browse = false,
      cancelled = false;
    let startTrack = { lane: 0, row: 0 };
    const pointers = new Set<number>();
    const hover = (e: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType'>) => {
      if (
        e.pointerType !== "mouse" ||
        !this.canBrowse() ||
        this.archiveMomentum
      )
        return;
      const r = canvas.getBoundingClientRect();
      this.pointer.set(
        (e.clientX - r.left) / r.width - 0.5,
        (e.clientY - r.top) / r.height - 0.5,
      );
      const cell = this.pickCell(e.clientX, e.clientY);
      this.setHover(cell);
      canvas.style.cursor = cell ? "pointer" : "grab";
    };
    this.flushHover = () => {
      const sample = this.pendingHover;
      this.pendingHover = null;
      if (sample) hover(sample);
    };
    const reset = () => {
      this.pendingHover = null;
      const id = activePointer;
      activePointer = null;
      this.dragging = false;
      this.dragTrack = null;
      this.holdingArchive = false;
      browse = false;
      this.setHover(null);
      canvas.style.cursor = this.canBrowse() ? "grab" : "default";
      if (id !== null && canvas.hasPointerCapture(id))
        canvas.releasePointerCapture(id);
    };
    this.cancelPointer = () => {
      cancelled = true;
      this.stopMomentum();
      pointers.clear();
      reset();
    };
    const moveArchive = (e: PointerEvent) => {
      const pending = !this.archiveDrag.active;
      for (const sample of e.getCoalescedEvents?.() ?? []) {
        this.archiveDrag.move(sample.clientX, sample.clientY, sample.timeStamp);
      }
      this.archiveDrag.move(e.clientX, e.clientY, e.timeStamp);
      moved ||= this.archiveDrag.moved;
      if (!this.archiveDrag.active) return;
      if (pending) {
        startTrack = { lane: this.columnCamera.value, row: this.rail.value };
      }
      this.setHover(null);
      this.lastInteraction = this.clock;
      canvas.style.cursor = "grabbing";
      this.dragTrack = {
        lane: startTrack.lane + this.archiveDrag.value.lane * COLUMN_SPACING,
        row: startTrack.row - this.archiveDrag.value.row * ROW_SPACING,
      };
      this.columnCamera.value = this.dragTrack.lane;
      this.rail.value = this.dragTrack.row;
      this.columnCamera.velocity = this.rail.velocity = 0;
      this.navigatePlane({
        lane: this.trackCoordinate("lane", this.columnCamera.value),
        row: this.trackCoordinate("row", this.rail.value),
      });
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.inputEnabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!this.canBrowse() && !this.canInspect) return;
      this.pendingHover = null;
      pointers.add(e.pointerId);
      if (pointers.size > 1) {
        cancelled = true;
        reset();
        return;
      }
      activePointer = e.pointerId;
      cancelled = false;
      moved = this.archiveMomentum !== null;
      startX = previousX = e.clientX;
      startY = e.clientY;
      browse = this.canBrowse();
      this.stopMomentum();
      if (browse) {
        this.columnCamera.velocity = 0;
        this.rail.velocity = 0;
      }
      this.holdingArchive = browse;
      this.dragging = !browse && this.canInspect;
      startTrack = { lane: this.columnCamera.value, row: this.rail.value };
      this.archiveDrag.start(e.clientX, e.clientY, this.dragProjection(), e.timeStamp);
      this.setHover(null);
      canvas.setPointerCapture(e.pointerId);
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("pointermove", (e) => {
      if (activePointer !== null && e.pointerId !== activePointer) return;
      if (activePointer === null) {
        // Coalesce uncaptured hover only; dragging and release velocity stay immediate.
        this.pendingHover = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
        return;
      }
      if (cancelled) return;
      moved ||= Math.hypot(e.clientX - startX, e.clientY - startY) > 7;
      if (browse) {
        if (!this.canBrowse()) {
          this.cancelPointer();
          return;
        }
        moveArchive(e);
        return;
      }
      if (this.dragging && this.canInspect) {
        this.targetRotation = THREE.MathUtils.clamp(
          this.targetRotation + (e.clientX - previousX) * 0.004,
          -0.8,
          0.8,
        );
        previousX = e.clientX;
      }
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("pointerup", (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId !== activePointer) return;
      if (!cancelled && browse && this.canBrowse()) {
        moveArchive(e);
        if (this.archiveDrag.active) {
          if (this.motion.dragMomentum) {
            this.archiveMomentum = {
              time: performance.now() / 1000,
              motion: new ArchivePlaneMomentum(
                { lane: this.trackCoordinate("lane", this.columnCamera.value), row: this.trackCoordinate("row", this.rail.value) },
                this.archiveDrag.releaseVelocity(e.timeStamp, false),
              ),
            };
          }
        } else if (!moved) {
          const cell = this.pickCell(e.clientX, e.clientY);
          if (cell) this.onSelect?.(fileAtCell(cell), cell);
        }
      }
      reset();
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("pointercancel", (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId === activePointer) {
        cancelled = true;
        reset();
      }
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("lostpointercapture", (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId === activePointer) {
        cancelled = true;
        reset();
      }
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("pointerleave", () => {
      this.pendingHover = null;
      this.pointer.set(0, 0);
      this.setHover(null);
    }, { signal: this.inputEvents.signal });
    window.addEventListener("blur", () => this.cancelPointer(), { signal: this.inputEvents.signal });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.cancelPointer();
    }, { signal: this.inputEvents.signal });
    window.addEventListener("resize", () => this.cancelPointer(), { signal: this.inputEvents.signal });
    // After multi-touch cancels capture, a finger can finish outside the canvas.
    window.addEventListener("pointerup", (e) => pointers.delete(e.pointerId), { signal: this.inputEvents.signal });
    window.addEventListener("pointercancel", (e) =>
      pointers.delete(e.pointerId), { signal: this.inputEvents.signal }
    );
  }
  update(time: number) {
    const elapsed = Math.max(0, time - this.last || 0.016);
    const dt = Math.min(elapsed, 0.05);
    this.last = time;
    this.clock = time;
    if (!this.loaded) return;
    this.flushHover();
    this.theme.beginFrame();
    themeEnvironment(this.scene, this.renderer, this.themeAmount);
    const blend = 1 - Math.exp(-dt * (this.motion.selectionTransition ? 2.8 : 35));
    const detailBlend = 1 - Math.exp(-dt * (this.motion.detailTransition ? 2.8 : 35));
    this.reveal = THREE.MathUtils.lerp(this.reveal, this.targetReveal, blend);
    this.rotation = this.targetDetail
      ? THREE.MathUtils.lerp(this.rotation, this.targetRotation, detailBlend)
      : returnStep(this.rotation, dt, !this.motion.detailTransition);
    if (!this.canBrowse()) {
      this.setHover(null);
      if (this.holdingArchive || this.archiveMomentum) this.cancelPointer();
    }
    if (this.looping && !this.holdingArchive && !this.archiveMomentum) this.rebaseCoordinates();
    const momentum = this.archiveMomentum;
    if (momentum) {
      momentum.motion.step(Math.min(Math.max(time - momentum.time, 0), 0.25));
      momentum.time = time;
      this.navigatePlane(momentum.motion.value);
      this.lastInteraction = time;
    }
    const hoverKey = this.hoverCell ? cellKey(this.hoverCell) : null;
    if (hoverKey && !this.hoverLifts.has(hoverKey)) this.hoverLifts.set(hoverKey, 0);
    for (const [key, value] of this.hoverLifts) {
      const target = key === hoverKey ? 0.28 : 0;
      const next = !this.motion.selectionTransition ? target : THREE.MathUtils.lerp(value, target, 1 - Math.exp(-dt * 14));
      if (target === 0 && next < 0.0001) this.hoverLifts.delete(key);
      else this.hoverLifts.set(key, next);
    }
    const hoverLift = (cell: ArchiveCell) => this.hoverLifts.get(cellKey(cell)) ?? 0;
    const chosen = this.cellPosition(this.selectedCell);
    const selectedRow = this.selectedCell.row;
    const selectedLane = this.selectedCell.lane;
    damp(this.shoulder, selectedRow, this.motion.selectionTransition ? 5 : 35, dt);
    damp(this.laneFocus, selectedLane, this.motion.selectionTransition ? 4 : 35, dt);
    // A held or freely coasting plane owns both tracks; selection cannot pull it.
    if (!this.holdingArchive && !momentum) {
      damp(this.columnCamera, chosen.x, this.motion.selectionTransition ? 3.7 : 35, dt);
      damp(this.rail, -2.17 - chosen.z, this.motion.selectionTransition ? 3.7 : 35, dt);
    }
    if (momentum) {
      this.columnCamera.value = this.trackPosition("lane", momentum.motion.lane.value);
      this.rail.value = this.trackPosition("row", momentum.motion.row.value);
      this.columnCamera.velocity = momentum.motion.lane.velocity * COLUMN_SPACING;
      this.rail.velocity = -momentum.motion.row.velocity * ROW_SPACING;
      if (momentum.motion.phase === "idle") this.archiveMomentum = null;
    }
    if (this.dragTrack) {
      this.columnCamera.value = this.dragTrack.lane;
      this.rail.value = this.dragTrack.row;
      this.columnCamera.velocity = this.rail.velocity = 0;
    }
    // Keep the illuminated set near the origin. Lateral navigation is a track
    // movement of the whole array, just like the existing front/back rail.
    const trackX = this.columnCamera.value;
    this.pulses = this.pulses.filter((p) => time - p.time < 3.2);
    const aligningCopy = this.outgoing.some((o) => o.returnY !== null);
    const idle =
      this.motion.idleWave &&
      this.targetReveal > 0 &&
      !this.targetDetail &&
      this.detail < 0.01 &&
      this.returnY === null &&
      !aligningCopy &&
      time - this.lastInteraction > 2.5;
    this.idleGain = THREE.MathUtils.lerp(
      this.idleGain,
      idle ? 1 : 0,
      1 - Math.exp(-dt * (idle ? 0.8 : 4)),
    );
    this.pulseGain = THREE.MathUtils.lerp(
      this.pulseGain,
      this.targetDetail || this.returnY !== null || aligningCopy ? 0 : 1,
      1 - Math.exp(-dt * 8),
    );
    const fieldCache = new Map<number, Map<number, number>>();
    const calculateField = (row: number, lane: number) => {
      const breathing = idleWave(
          row + this.coordinateOrigin.row,
          lane + this.coordinateOrigin.lane,
          time,
        ) *
          this.idleGain;
      let pulseHeight = 0;
      if (this.motion.selectionWave) {
        let ripple = 0;
        for (const p of this.pulses) {
          const distance = Math.hypot(row - p.row, (lane - p.lane) * 2.2);
          const age = time - p.time;
          ripple += baselineSelectionWave(distance, age);
        }
        pulseHeight = THREE.MathUtils.clamp(ripple, -0.6, 0.6) * this.pulseGain;
      }
      const distance = row - this.shoulder.value;
      return (
        settlingWave(distance, 26.56) *
          columnStrength(lane, this.laneFocus.value) + breathing + pulseHeight
      );
    };
    const field = (row: number, lane: number): number => {
      let values = fieldCache.get(lane);
      if (!values) { values = new Map(); fieldCache.set(lane, values); }
      const previous = values.get(row);
      if (previous !== undefined) return previous;
      const value = calculateField(row, lane);
      values.set(row, value);
      return value;
    };
    const selectedBase = chosen.y + field(selectedRow, selectedLane);
    if (this.returnY !== null && this.rotation !== 0) {
      this.lift.value = this.returnY - selectedBase;
      this.lift.velocity = 0;
    } else {
      this.returnY = null;
      damp(
        this.lift,
        this.targetDetail
          ? INSPECTION_LIFT
          : this.outgoing.some(
                (o) =>
                  o.returnY !== null &&
                  o.cell.lane === selectedLane &&
                  Math.abs(o.cell.row - selectedRow) < 5,
              )
            ? 0
            : 0.4 * this.targetReveal,
        this.motion.detailTransition ? 4.2 : 35,
        dt,
      );
    }
    const cameraTarget = this.targetDetail
      ? ease((this.lift.value - 0.8) / 2.4)
      : this.returnY !== null
        ? this.detail
        : ease((this.lift.value - 0.4) / (INSPECTION_LIFT - 0.4));
    this.detail = THREE.MathUtils.lerp(this.detail, cameraTarget, detailBlend);
    const detail = this.detail;
    this.appearance.apply(this.model, ease(this.lift.value / 0.4));
    this.appearance.setClarity(this.model, this.targetDetail);
    const entryZ = -28 * (1 - this.reveal);
    for (let i = this.outgoing.length - 1; i >= 0; i--) {
      const o = this.outgoing[i];
      const p = this.cellPosition(o.cell);
      const baseY = p.y + field(o.cell.row, o.cell.lane);
      o.group.rotation.y = returnStep(o.group.rotation.y, dt, !this.motion.detailTransition);
      if (o.returnY !== null) {
        o.lift.value = o.returnY - baseY;
        o.lift.velocity = 0;
        if (o.group.rotation.y === 0) o.returnY = null;
      } else damp(o.lift, 0, this.motion.detailTransition ? 4.5 : 35, dt);
      o.group.position.set(
        p.x - trackX,
        baseY + o.lift.value + hoverLift(o.cell),
        p.z + entryZ + this.rail.value,
      );
      const quality = ease(o.lift.value / 0.4);
      this.appearance.apply(o.group, quality);
      this.appearance.setTheme(o.group, this.theme.sample(o.cell, time));
      this.appearance.setClarity(o.group, 0);
      const { row, lane } = o.cell;
      o.group.rotation.x =
        (field(row + 0.5, lane) - field(row - 0.5, lane)) *
        0.024 *
        (1 - detail) *
        (1 - quality);
      if (o.lift.value < 0.0001 && Math.abs(o.group.rotation.y) < 0.0001) {
        this.scene.remove(o.group);
        this.appearance.dispose(o.group);
        this.outgoing.splice(i, 1);
      }
    }
    this.appearance.setTheme(this.model, this.theme.sample(this.selectedCell, time));
    this.model.position.set(
      chosen.x - trackX,
      chosen.y + field(selectedRow, selectedLane) + this.lift.value + hoverLift(this.selectedCell),
      chosen.z + entryZ + this.rail.value,
    );
    // Extraction only changes elevation. Reframing belongs to the camera.
    this.model.rotation.set(
      (field(selectedRow + 0.5, selectedLane) -
        field(selectedRow - 0.5, selectedLane)) *
        0.024 *
        (1 - detail) *
        (1 - ease(this.lift.value / 0.4)),
      this.rotation,
      0,
    );
    // Measured from frame 787: X edge (382,-204), adjacent row (78,38).
    // The label vertical edge constrains height; the file base is occluded.
    // Do not calibrate field of view from the visible fragment of a file.
    const yaw = THREE.MathUtils.degToRad(59);
    const elevation = THREE.MathUtils.degToRad(19);
    const span = 7.33;
    const distance = THREE.MathUtils.lerp(140, 72, detail);
    const cameraAim = new THREE.Vector3(-1.091, -0.045, 0.481);
    const viewDirection = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation),
    );
    viewDirection
      .lerp(new THREE.Vector3(-0.277, 0.238, 0.931), detail)
      .normalize();
    const framing = archiveFraming(this.container.clientWidth, this.container.clientHeight, span, detail);
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
      .normalize();
    const up = new THREE.Vector3()
      .crossVectors(viewDirection, right)
      .normalize();
    const width = this.container.clientWidth, height = this.container.clientHeight;
    const pixelScale = height / framing.span;
    if (framing.portrait) {
      // Keep the preview camera independent of the live lift, wave and rail.
      // Following model.position here would visually cancel those motions.
      const previewAim = new THREE.Vector3(0, -4.6 + settlingWave(0, 26.56) + 0.4 + 1.85, -2.17);
      previewAim.addScaledVector(up, (framing.previewY - 0.5) * height / pixelScale);
      cameraAim.copy(previewAim);
    }
    const detailAim = this.model.position
      .clone()
      .add(new THREE.Vector3(0, 1.85, 0));
    detailAim.addScaledVector(right, (0.5 - framing.detailX) * width / pixelScale);
    detailAim.addScaledVector(up, (framing.detailY - 0.5) * height / pixelScale);
    cameraAim.lerp(detailAim, detail);
    const cameraPosition = cameraAim
      .clone()
      .addScaledVector(viewDirection, distance);
    if (this.motion.pointerParallax) {
      cameraPosition.x += this.pointer.x * 0.12;
      cameraPosition.y -= this.pointer.y * 0.12;
    }
    const cameraTransition = this.targetDetail || this.detail > 0.01
      ? this.motion.detailTransition
      : this.motion.selectionTransition;
    const cameraBlend = cameraTransition ? 1 - Math.exp(-dt * 5) : 1;
    this.camera.position.lerp(cameraPosition, cameraBlend);
    this.cameraAim.lerp(cameraAim, cameraBlend);
    this.camera.lookAt(this.cameraAim);
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      THREE.MathUtils.radToDeg(
        2 * Math.atan(framing.span / (2 * distance)),
      ),
      cameraBlend,
    );
    const fog = this.scene.fog as THREE.Fog;
    // The camera position is damped after its target distance changes. Anchor
    // fog to the rendered camera, or entry puts the array behind the far plane
    // until the camera catches up (a brief white wash that exit never showed).
    const renderedDistance = this.camera.position.distanceTo(this.cameraAim);
    const fogTheme = this.themeAmount;
    fog.near = renderedDistance + THREE.MathUtils.lerp(5 - 4 * fogTheme, -1, detail);
    fog.far = renderedDistance + THREE.MathUtils.lerp(25 - 9 * fogTheme, 12, detail);

    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // Build and compact the instance set only after the actual damped camera
    // is final for this frame. Picking uses the same packed index-to-cell map.
    const fixed = !this.looping;
    const cells = fixed ? Array.from({ length: 160 }, (_, i) => poolCell(i))
      : this.visibility.update(this.camera, fog.far, trackX, entryZ + this.rail.value);
    const hidden = new Set(this.outgoing.map(o => cellKey(o.cell)));
    hidden.add(cellKey(this.selectedCell));
    this.drawnCells = [];
    this.drawCoverage.update(this.camera);
    this.shadowCoverage?.begin();
    this.matrixUpdates ??= new InstanceUpdates(this.instances[0].instanceMatrix);
    if (this.themeAttribute) this.themeUpdates ??= new InstanceUpdates(this.themeAttribute);
    for (const cell of cells) {
      const { row, lane } = cell;
      if (hidden.has(cellKey(cell))) continue;
      const x = (lane - 2) * COLUMN_SPACING - trackX;
      const y = -4.6 + field(row, lane) + hoverLift(cell);
      const z = (row - 15.5) * ROW_SPACING + entryZ + this.rail.value;
      if (!fixed && !this.visibility.intersects(x, y, z)) continue;

      const slope = field(row + .5, lane) - field(row - .5, lane);
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(slope * .024 * (1 - detail), 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.shadowCoverage?.add(this.dummy.matrix);
      if (!this.drawCoverage.contains(x, y, z)) continue;
      const i = this.drawnCells.length;
      this.ensureInstanceCapacity(i + 1);
      this.drawnCells.push(cell);
      this.themeUpdates?.scalar(i, this.theme.sample(cell, time));
      this.matrixUpdates!.set(i * 16, this.dummy.matrix.elements);
    }
    const countChanged = this.instances[0].count !== this.drawnCells.length;
    const visibleMatricesChanged = this.matrixUpdates!.commit();
    const shadowMatricesChanged = this.shadowCoverage?.commit() ?? false;
    const matricesChanged = visibleMatricesChanged || shadowMatricesChanged;
    for (const inst of this.instances) {
      inst.count = this.drawnCells.length;
    }
    // Picking uses only the first instanced surface. The other batches disable
    // renderer culling and do not need an O(n) bound recomputation each frame.
    if (matricesChanged || countChanged || !this.instances[0].boundingSphere) this.instances[0].computeBoundingSphere();
    this.themeUpdates?.commit();
    let neighborTop = -Infinity;
    const lane = selectedLane,
      row = selectedRow;
    for (let r = row - 5; r <= row + 5; r++) {
      if (r !== row)
        neighborTop = Math.max(neighborTop, -4.6 + field(r, lane) + 3.76);
    }
    for (const o of this.outgoing) {
      if (o.cell.lane === lane && Math.abs(o.cell.row - row) <= 5) {
        neighborTop = Math.max(neighborTop, o.group.position.y + 3.76);
      }
    }
    this.clearance = this.model.position.y - neighborTop;
    this.canInspect =
      Boolean(this.targetDetail) &&
      detail > 0.9 &&
      this.pulseGain < 0.01 &&
      this.clearance > 0.3;
    const focalPoint = this.model.position
      .clone()
      .add(new THREE.Vector3(0, 2, 0))
      .applyMatrix4(this.camera.matrixWorldInverse);
    const bokehUniforms = this.bokeh.uniforms as Record<
      string,
      { value: number }
    >;
    bokehUniforms.focus.value = -focalPoint.z;
    bokehUniforms.aperture.value =
      (THREE.MathUtils.lerp(0.0003, 0.0008, detail) *
        this.quality.depthOfField) /
      100;
    this.renderer.info.reset();
    // Keep all simulation and picking current. Reuse the composited canvas only
    // when its actual inputs are identical, including late textures and materials.
    const state = this.renderState;
    this.scene.updateMatrixWorld();
    // A changed instance buffer already proves the image changed. Avoid a
    // material/matrix snapshot on those busy frames; capture when it settles.
    if (matricesChanged) {
      state.invalidate();
    } else {
      state.begin();
      state.floats(...this.camera.projectionMatrix.elements, ...this.camera.matrixWorldInverse.elements,
        ...this.camera.position.toArray(),
        fog.near, fog.far, this.themeAmount, this.subduedIndex.value,
        bokehUniforms.focus.value, bokehUniforms.aperture.value);
      this.scene.traverse(object => {
        state.add(object.id, Number(object.visible));
        if (!(object instanceof THREE.Mesh)) return;
        object.modelViewMatrix.multiplyMatrices(this.camera.matrixWorldInverse, object.matrixWorld);
        object.normalMatrix.getNormalMatrix(object.modelViewMatrix);
        state.floats(...object.modelViewMatrix.elements, ...object.normalMatrix.elements, ...object.matrixWorld.elements);
        const mat = object.material as THREE.MeshPhysicalMaterial;
        // Three increments material.version for its own double-sided transmission
        // passes. Track application-controlled inputs, not that render-side counter.
        state.add(object.geometry.id, mat.uuid, mat.map?.uuid, mat.map?.version ?? 0);
        state.floats(
          mat.opacity, mat.roughness, mat.metalness, mat.transmission, mat.thickness,
          mat.attenuationDistance, mat.clearcoat, mat.clearcoatRoughness,
          mat.color.r, mat.color.g, mat.color.b,
          mat.attenuationColor?.r ?? 0, mat.attenuationColor?.g ?? 0, mat.attenuationColor?.b ?? 0);
        for (const name of ['appearance', 'glassClarity', 'themeAmount', 'subduedIndex'])
          state.floats(object.userData[name]?.value ?? 0);
        if (object instanceof THREE.InstancedMesh)
          state.add(object.count, object.instanceMatrix.version, this.themeAttribute?.version ?? 0);
      });
      if (!state.end()) return;
    }
    const shadow = this.shadowState;
    shadow.begin();
    shadow.add(this.light.shadow.mapSize.x, Number(this.renderer.shadowMap.enabled));
    shadow.floats(...this.light.matrixWorld.elements, ...this.light.target.matrixWorld.elements);
    this.scene.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || !object.castShadow) return;
      shadow.add(object.id, object.geometry.id);
      shadow.floats(...object.matrixWorld.elements);
      if (object instanceof THREE.InstancedMesh) shadow.add(object.count, object.instanceMatrix.version);
    });
    this.renderer.shadowMap.needsUpdate = shadow.end() || this.light.shadow.needsUpdate;
    this.composer.render();
  }
  get detailVisibility() {
    return ease((this.detail - 0.25) / 0.55);
  }

}
