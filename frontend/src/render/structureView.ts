/**
 * Three.js view of a `StructureModel` (context.md M5, M6).
 *
 * - One `InstancedMesh` of spheres per element, with per-instance colour; one instanced cylinder
 *   mesh for the bonds (each bond is two half-sticks so it can be coloured by its end atoms).
 * - Orthographic camera by default, perspective on request; trackball rotation (no gimbal lock).
 * - Picking is an exact ray-sphere test over the atom arrays (core/structure/pick.ts).
 * - Instance buffers are rebuilt only in `setStructure`. `setAppearance` applies resolved radii,
 *   colours and visibility (core/structure/styles.ts) in place; a colour-only change rewrites
 *   just the colour buffers. The frame loop allocates nothing and renders only when something
 *   changed.
 * - Coordination polyhedra are one translucent mesh plus one line mesh (`setPolyhedra`).
 *
 * Scene coordinates are Cartesian angstrom with the origin moved to the centre of the atoms, so
 * float32 stays accurate however far the range extends.
 */
import {
  AmbientLight,
  ArrowHelper,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshStandardMaterial,
  MeshToonMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import type { Lattice } from '../core/lattice';
import type { Vec3 } from '../core/math/vec3';
import { pickSphere } from '../core/structure/pick';
import type { StructureModel } from '../core/structure/model';
import type { PolyhedraGeometry } from '../core/structure/polyhedra';
import { MANUAL_RULE } from '../core/structure/bonds';
import { rgbToHex, type Appearance, type Colours } from '../core/structure/styles';
import type { LegendEntry } from '../core/structure/legend';
import type { SvgAxis, SvgScene, SvgSegment, SvgTriangle } from '../export/svg3d';

export type Projection = 'ortho' | 'persp';

export interface ViewCallbacks {
  /** The atom under the pointer changed (null: none). Coordinates are client pixels. */
  onHover?: (atom: number | null, clientX: number, clientY: number) => void;
  /** The selection changed (ordered by click). */
  onSelect?: (selection: readonly number[]) => void;
  /** Called after each rendered frame, for overlays that follow the structure. */
  onRender?: () => void;
  /** A mouse drag or wheel gesture ended; `rotated` says whether the line of sight changed. */
  onGestureEnd?: (rotated: boolean) => void;
}

export interface ViewStats {
  fps: number;
  frames: number;
  renders: number;
}

const FOV = 30;
const TRIAD_SIZE = 120;
const HIGHLIGHT = new Color(0xffd23f);
const SELECT_SCALE = 1.18;

/** sRGB byte to linear light, the space three.js blends colours in. */
const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

/** Where the camera is, in the crystal's Cartesian frame (angstrom). */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  /** Height of the orthographic view in angstrom. */
  worldPerPixel: number;
}

export class StructureView {
  readonly stats: ViewStats = { fps: 0, frames: 0, renders: 0 };

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private readonly persp = new PerspectiveCamera(FOV, 1, 0.1, 1000);
  private camera: OrthographicCamera | PerspectiveCamera = this.ortho;
  private controls!: TrackballControls;
  private readonly hemi = new HemisphereLight(0xffffff, 0x5a5f70, 1.5);
  private readonly sun = new DirectionalLight(0xffffff, 2.2);

  private readonly triadScene = new Scene();
  private readonly triadCamera = new OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 50);
  private triadGroup: { dispose(): void } | null = null;

  // structure state
  private model: StructureModel | null = null;
  private lattice: Lattice | null = null;
  private origin: Vec3 = [0, 0, 0];
  private pos = new Float32Array(0);
  private app: Appearance | null = null;
  private pickRadius = new Float32Array(0);
  private selected = new Uint8Array(0);
  private slot = new Uint32Array(0);
  private atomColourArrays: Float32Array[] = [];
  private polyMesh: Mesh | null = null;
  private polyEdges: LineSegments | null = null;
  /** What `setPolyhedra` was given, kept for the SVG export. */
  private polyInfo: { geometry: PolyhedraGeometry; opacity: number; edges: boolean } | null = null;
  private atomMeshes: InstancedMesh[] = [];
  private atomMembers: Uint32Array[] = [];
  private bondMesh: InstancedMesh | null = null;
  private cellLines: LineSegments | null = null;
  private readonly measureLines: LineSegments;
  private selection: number[] = [];
  private selectionLimit = 0;
  /** False: no hover picking and no click selection (the electron-diffraction tab's view). */
  private picking = true;
  private gestureDir: Vec3 = [0, 0, -1];

  private sphereCache: SphereGeometry | null = null;
  private cylinderCache: CylinderGeometry | null = null;
  private material: Material = new MeshStandardMaterial({ roughness: 0.42, metalness: 0.04 });
  private toon = false;

  // camera state
  private radius = 1;
  private distance = 10;
  private showAxes = true;
  private showCell = true;

  // loop state
  private needsRender = true;
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private fpsStart = 0;
  private fpsFrames = 0;

  // pointer state
  private hoverAtom: number | null = null;
  private hoverDirty = false;
  private pointerX = 0;
  private pointerY = 0;
  private downX = 0;
  private downY = 0;
  private downButton = -1;

  // scratch objects, reused so the frame loop never allocates
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly q1 = new Quaternion();
  private readonly colour = new Color();
  private readonly yAxis = new Vector3(0, 1, 0);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: ViewCallbacks = {},
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xffffff, 0);

    this.scene.add(this.hemi, this.sun, this.sun.target, new AmbientLight(0xffffff, 0.15));

    const lineMaterial = new LineBasicMaterial({
      color: HIGHLIGHT,
      depthTest: false,
      transparent: true,
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(3 * 6), 3));
    g.setDrawRange(0, 0);
    this.measureLines = new LineSegments(g, lineMaterial);
    this.measureLines.renderOrder = 10;
    this.measureLines.frustumCulled = false;
    this.scene.add(this.measureLines);

    this.controls = this.makeControls();
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    this.resize();
    this.fpsStart = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---- public API ------------------------------------------------------------------------------

  /**
   * The camera in the crystal's Cartesian frame (independent of the structure's centring): pass it
   * to `setStructure` later to come back to this orientation, pan and magnification.
   */
  cameraState(): CameraState | null {
    if (!this.model) return null;
    const o = this.origin;
    const p = this.camera.position;
    const t = this.controls.target;
    return {
      position: [p.x + o[0], p.y + o[1], p.z + o[2]],
      target: [t.x + o[0], t.y + o[1], t.z + o[2]],
      up: [this.camera.up.x, this.camera.up.y, this.camera.up.z],
      worldPerPixel: this.viewHeight() / this.ortho.zoom,
    };
  }

  /**
   * Replace the structure. Rebuilds every instance buffer. The camera is reset to the default
   * view, unless `keepView` is set (same crystal, different range): then the orientation, pan and
   * magnification stay where the user left them. A `CameraState` (from `cameraState`) puts the
   * camera back where it was when that state was taken.
   */
  setStructure(
    model: StructureModel,
    lattice: Lattice,
    keepView: boolean | CameraState = false,
  ): void {
    let saved: {
      position: Vector3;
      target: Vector3;
      up: Vector3;
      worldPerPixel: number;
    } | null = null;
    const state = typeof keepView === 'object' ? keepView : keepView ? this.cameraState() : null;
    if (state) {
      saved = {
        position: new Vector3(...state.position),
        target: new Vector3(...state.target),
        up: new Vector3(...state.up),
        worldPerPixel: state.worldPerPixel,
      };
    }
    this.clearStructure();
    this.model = model;
    this.lattice = lattice;
    const n = model.count;
    const { min, max } = model.bounds;
    this.origin = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

    this.pos = new Float32Array(3 * n);
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 3; k++) this.pos[3 * i + k] = model.cart[3 * i + k] - this.origin[k];
    this.app = null;
    this.selected = new Uint8Array(n);
    this.slot = new Uint32Array(n);
    this.pickRadius = new Float32Array(n);
    this.selection = [];

    // Level of detail: a sphere is 640 triangles at full quality, 96 for large structures and 48
    // beyond 60000 atoms, where each one covers only a few pixels anyway.
    // em_sim_ui: coarser spheres once a view holds thousands of atoms: a fine sphere is hundreds of
    // triangles, and wheel-zoom then repaints too slowly to follow the pointer.
    const [w, h] = n <= 1500 ? [32, 20] : n <= 6000 ? [12, 8] : n <= 20000 ? [8, 5] : [6, 4];
    this.sphereCache = new SphereGeometry(1, w, h);
    this.cylinderCache = new CylinderGeometry(
      1,
      1,
      1,
      n <= 25000 ? 12 : n <= 60000 ? 6 : 4,
      1,
      true,
    );

    const counts = new Uint32Array(model.elements.length);
    for (let i = 0; i < n; i++) counts[model.species[i]]++;
    this.atomMembers = Array.from(counts, (c) => new Uint32Array(c));
    const fill = new Uint32Array(model.elements.length);
    for (let i = 0; i < n; i++) {
      const s = model.species[i];
      this.slot[i] = fill[s];
      this.atomMembers[s][fill[s]++] = i;
    }
    this.atomMeshes = model.elements.map((_, s) => {
      const mesh = new InstancedMesh(this.sphereCache!, this.material, counts[s]);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(3 * counts[s]), 3);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    });

    const nBonds = model.bonds.length / 2;
    if (nBonds > 0) {
      this.bondMesh = new InstancedMesh(this.cylinderCache, this.material, 2 * nBonds);
      this.bondMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(6 * nBonds), 3);
      this.bondMesh.frustumCulled = false;
      this.scene.add(this.bondMesh);
    }

    this.buildCellLines();
    this.buildTriad();
    this.buildOverlay();
    this.atomColourArrays = this.atomMeshes.map((m) => m.instanceColor!.array as Float32Array);
    if (saved) this.restoreView(saved);
    else this.fitCamera();
    this.requestRender();
  }

  /**
   * Extra line segments drawn over the structure (em_sim_ui M3: the specimen box and the beam).
   * `segments` holds pairs of points, Cartesian angstrom in the structure's own frame; null
   * removes them. They follow `setStructure` (which moves the scene origin).
   */
  setOverlayLines(segments: Float32Array | null, colour = 0xe5484d): void {
    this.overlaySegments = segments;
    this.overlayColour = colour;
    this.buildOverlay();
    this.requestRender();
  }

  /** Number of overlay line segments currently in the scene (test hook). */
  get overlayCount(): number {
    return this.overlayLines ? this.overlayLines.geometry.getAttribute('position').count / 2 : 0;
  }

  private overlaySegments: Float32Array | null = null;
  private overlayColour = 0xe5484d;
  private overlayLines: LineSegments | null = null;

  private buildOverlay(): void {
    if (this.overlayLines) {
      this.scene.remove(this.overlayLines);
      this.overlayLines.geometry.dispose();
      (this.overlayLines.material as Material).dispose();
      this.overlayLines = null;
    }
    const s = this.overlaySegments;
    if (!s || s.length < 6) return;
    const p = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) p[i] = s[i] - this.origin[i % 3];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p, 3));
    this.overlayLines = new LineSegments(
      g,
      new LineBasicMaterial({ color: this.overlayColour, depthTest: false, transparent: true }),
    );
    this.overlayLines.renderOrder = 5;
    this.overlayLines.frustumCulled = false;
    this.scene.add(this.overlayLines);
  }

  setProjection(projection: Projection): void {
    const wanted = projection === 'ortho' ? this.ortho : this.persp;
    if (wanted === this.camera) return;
    const old = this.camera;
    const target = this.controls.target;
    // The height of the world visible at the target, preserved across the switch.
    const direction = this.v1.copy(old.position).sub(target);
    const visible =
      old === this.ortho
        ? this.viewHeight() / this.ortho.zoom
        : 2 * direction.length() * Math.tan((FOV * Math.PI) / 360);
    direction.normalize();
    this.controls.dispose();
    this.camera = wanted;
    wanted.up.copy(old.up);
    if (wanted === this.ortho) {
      this.ortho.zoom = this.viewHeight() / visible;
      wanted.position.copy(target).addScaledVector(direction, this.distance);
    } else {
      wanted.position
        .copy(target)
        .addScaledVector(direction, visible / 2 / Math.tan((FOV * Math.PI) / 360));
    }
    this.controls = this.makeControls();
    this.updateProjection();
    this.controls.update();
    this.requestRender();
  }

  get projection(): Projection {
    return this.camera === this.ortho ? 'ortho' : 'persp';
  }

  setShowCell(show: boolean): void {
    this.showCell = show;
    if (this.cellLines) this.cellLines.visible = show;
    this.requestRender();
  }

  setShowAxes(show: boolean): void {
    this.showAxes = show;
    this.requestRender();
  }

  /** Toon shading, for flat print-style figures. */
  setToon(on: boolean): void {
    this.toon = on;
    const old = this.material;
    this.material = on
      ? new MeshToonMaterial()
      : new MeshStandardMaterial({ roughness: 0.42, metalness: 0.04 });
    for (const m of this.atomMeshes) m.material = this.material;
    if (this.bondMesh) this.bondMesh.material = this.material;
    old.dispose();
    this.requestRender();
  }

  get isToon(): boolean {
    return this.toon;
  }

  /**
   * Apply resolved radii, colours and visibility (see `resolveAppearance`). With `shape` false only
   * the colours are rewritten, which is what a colour-picker drag needs.
   */
  setAppearance(app: Appearance, shape = true): void {
    const model = this.model;
    if (!model) return;
    this.app = app;
    const n = model.count;
    if (shape) {
      for (let i = 0; i < n; i++) this.writeAtom(i);
      for (const m of this.atomMeshes) m.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < n; i++) this.writeAtomColour(i);
    for (const m of this.atomMeshes) m.instanceColor!.needsUpdate = true;
    this.writeBonds(shape);
    if (this.bondMesh) this.bondMesh.visible = app.bondsDrawn;
    this.requestRender();
  }

  /** Rewrite only the colours (a colour-picker drag); radii and visibility stay. */
  setColours(c: Colours): void {
    const model = this.model;
    if (!model || !this.app) return;
    this.app = { ...this.app, ...c };
    const n = model.count;
    for (let i = 0; i < n; i++) this.writeAtomColour(i);
    for (const m of this.atomMeshes) m.instanceColor!.needsUpdate = true;
    this.writeBondColours();
    this.requestRender();
  }

  /** Draw the bond sticks or not, without touching their buffers. */
  setBondsDrawn(on: boolean): void {
    if (this.app) this.app = { ...this.app, bondsDrawn: on };
    if (this.bondMesh) this.bondMesh.visible = on;
    this.requestRender();
  }

  /** Whether the bond sticks are drawn at all. */
  get bondsDrawn(): boolean {
    return this.bondMesh?.visible ?? false;
  }

  /**
   * Draw translucent coordination polyhedra (null for none). Positions are Cartesian angstrom.
   */
  setPolyhedra(geometry: PolyhedraGeometry | null, opacity: number, edges: boolean): void {
    this.clearPolyhedra();
    if (!geometry || geometry.count === 0) {
      this.requestRender();
      return;
    }
    const tri = new BufferGeometry();
    const pos = new Float32Array(geometry.triangles.length);
    const col = new Float32Array(geometry.triangleColor.length);
    for (let i = 0; i < pos.length; i++) pos[i] = geometry.triangles[i] - this.origin[i % 3];
    for (let i = 0; i < col.length; i++) col[i] = SRGB_TO_LINEAR[geometry.triangleColor[i]];
    tri.setAttribute('position', new BufferAttribute(pos, 3));
    tri.setAttribute('color', new BufferAttribute(col, 3));
    tri.computeVertexNormals(); // not indexed, so every triangle gets its own flat normal
    this.polyMesh = new Mesh(
      tri,
      new MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity,
        side: DoubleSide,
        depthWrite: false,
        roughness: 0.6,
        metalness: 0,
      }),
    );
    this.polyMesh.renderOrder = 5;
    this.polyMesh.frustumCulled = false;
    this.scene.add(this.polyMesh);
    this.polyInfo = { geometry, opacity, edges };
    if (edges && geometry.edges.length > 0) {
      const eg = new BufferGeometry();
      const ep = new Float32Array(geometry.edges.length);
      const ec = new Float32Array(geometry.edgeColor.length);
      for (let i = 0; i < ep.length; i++) ep[i] = geometry.edges[i] - this.origin[i % 3];
      for (let i = 0; i < ec.length; i++) ec[i] = SRGB_TO_LINEAR[Math.round(geometry.edgeColor[i])];
      eg.setAttribute('position', new BufferAttribute(ep, 3));
      eg.setAttribute('color', new BufferAttribute(ec, 3));
      this.polyEdges = new LineSegments(eg, new LineBasicMaterial({ vertexColors: true }));
      this.polyEdges.renderOrder = 6;
      this.polyEdges.frustumCulled = false;
      this.scene.add(this.polyEdges);
    }
    this.requestRender();
  }

  private clearPolyhedra(): void {
    for (const o of [this.polyMesh, this.polyEdges]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
      (o.material as Material).dispose();
    }
    this.polyMesh = null;
    this.polyEdges = null;
    this.polyInfo = null;
  }

  /** 0 allows any number of selected atoms; otherwise the oldest is dropped past the limit. */
  /** Turn atom hover and click selection on or off. */
  setPicking(on: boolean): void {
    this.picking = on;
    if (!on) {
      this.hoverDirty = false;
      if (this.selection.length > 0) this.setSelection([]);
    }
  }

  setSelectionLimit(limit: number): void {
    this.selectionLimit = limit;
    if (limit > 0 && this.selection.length > limit) this.setSelection(this.selection.slice(-limit));
  }

  getSelection(): readonly number[] {
    return this.selection;
  }

  setSelection(indices: readonly number[]): void {
    for (const i of this.selection) {
      this.selected[i] = 0;
      this.writeAtomAndMark(i);
    }
    this.selection = [...indices];
    for (const i of this.selection) {
      this.selected[i] = 1;
      this.writeAtomAndMark(i);
    }
    this.writeMeasureLines();
    this.callbacks.onSelect?.(this.selection);
    this.requestRender();
  }

  /** Look along `direction` (Cartesian) with `up` pointing up the screen, keeping the zoom. */
  lookAlong(direction: Vec3, up: Vec3 = [0, 1, 0]): void {
    const d = this.v1.set(direction[0], direction[1], direction[2]);
    if (d.lengthSq() === 0) return;
    d.normalize();
    const u = this.v2.set(up[0], up[1], up[2]);
    if (u.lengthSq() === 0 || Math.abs(u.normalize().dot(d)) > 0.999) {
      u.set(0, 1, 0);
      if (Math.abs(u.dot(d)) > 0.999) u.set(0, 0, 1);
    }
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.camera.up.copy(u);
    this.camera.position.copy(this.controls.target).addScaledVector(d, -dist);
    this.controls.update();
    this.requestRender();
  }

  /**
   * Back to the default orientation (looking mostly along c, slightly tilted) and re-centred; the
   * magnification stays as it is.
   */
  resetOrientation(): void {
    if (!this.model) return;
    const keep =
      this.camera === this.ortho
        ? this.distance
        : this.camera.position.distanceTo(this.controls.target);
    this.controls.target.set(0, 0, 0);
    this.camera.up.set(0, 1, 0);
    this.v1.set(0.28, 0.2, 1).normalize();
    this.camera.position.copy(this.v1).multiplyScalar(keep);
    this.updateProjection();
    this.controls.update();
    this.requestRender();
  }

  /** Magnification back to "whole structure fits"; orientation and pan stay as they are. */
  resetZoom(): void {
    if (!this.model) return;
    if (this.camera === this.ortho) {
      this.ortho.zoom = 1;
    } else {
      this.v1.copy(this.camera.position).sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(this.v1, this.distance);
    }
    this.updateProjection();
    this.controls.update();
    this.requestRender();
  }

  /** Line of sight, screen-up direction and the height in angstrom visible at the target. */
  viewState(): { direction: Vec3; up: Vec3; visibleHeight: number } {
    const dist = this.camera.position.distanceTo(this.controls.target);
    return {
      direction: this.viewDirection(),
      up: [this.camera.up.x, this.camera.up.y, this.camera.up.z],
      visibleHeight:
        this.camera === this.ortho
          ? this.viewHeight() / this.ortho.zoom
          : 2 * dist * Math.tan((FOV * Math.PI) / 360),
    };
  }

  /** Cartesian direction of the line of sight (from the camera into the scene). */
  viewDirection(): Vec3 {
    this.v1.copy(this.controls.target).sub(this.camera.position).normalize();
    return [this.v1.x, this.v1.y, this.v1.z];
  }

  /** Screen position in CSS pixels of a Cartesian point; `visible` is false behind the camera. */
  project(p: Vec3, out: { x: number; y: number; visible: boolean }): void {
    this.v1.set(p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]);
    this.camera.updateMatrixWorld();
    this.v1.project(this.camera);
    out.x = (this.v1.x * 0.5 + 0.5) * this.width;
    out.y = (-this.v1.y * 0.5 + 0.5) * this.height;
    out.visible = this.v1.z > -1 && this.v1.z < 1;
  }

  /** Screen position in CSS pixels of an atom's centre. */
  atomScreen(i: number, out: { x: number; y: number; visible: boolean }): void {
    this.v1.set(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]);
    this.camera.updateMatrixWorld();
    this.v1.project(this.camera);
    out.x = (this.v1.x * 0.5 + 0.5) * this.width;
    out.y = (-this.v1.y * 0.5 + 0.5) * this.height;
    out.visible = this.v1.z > -1 && this.v1.z < 1;
  }

  /** Atom under a client-pixel position, or null. */
  pickAt(clientX: number, clientY: number): number | null {
    if (!this.model || this.model.count === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const hit = pickSphere(
      origin.x,
      origin.y,
      origin.z,
      direction.x,
      direction.y,
      direction.z,
      this.pos,
      this.pickRadius,
      this.model.count,
    );
    return hit ? hit.index : null;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const h = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.updateProjection();
    this.controls.handleResize();
    this.requestRender();
  }

  /** An arrow function, because it is also the controls' 'change' listener. */
  readonly requestRender = (): void => {
    this.needsRender = true;
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    this.clearStructure();
    this.triadGroup?.dispose();
    this.measureLines.geometry.dispose();
    (this.measureLines.material as Material).dispose();
    this.material.dispose();
    this.renderer.dispose();
  }

  // ---- building --------------------------------------------------------------------------------

  private makeControls(): TrackballControls {
    const keep = this.controls?.target.clone();
    const controls = new TrackballControls(this.camera, this.canvas);
    controls.rotateSpeed = 3;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 1;
    // No inertia: the crystal stops where the pointer is released, so it can be placed precisely.
    controls.staticMoving = true;
    // Its default A/S/D shortcuts would fire while typing in the page's text fields.
    controls.keys = ['', '', ''];
    if (keep) controls.target.copy(keep);
    controls.addEventListener('change', this.requestRender);
    controls.addEventListener('start', this.onGestureStart);
    controls.addEventListener('end', this.onGestureEnd);
    return controls;
  }

  private readonly onGestureStart = (): void => {
    this.gestureDir = this.viewDirection();
  };

  private readonly onGestureEnd = (): void => {
    // The controls apply a drag's last movement in update(); do it now, so the direction is final
    // and nothing is left pending to undo a snap.
    this.controls.update();
    const d = this.viewDirection();
    const rotated =
      Math.hypot(d[0] - this.gestureDir[0], d[1] - this.gestureDir[1], d[2] - this.gestureDir[2]) >
      1e-6;
    this.gestureDir = d;
    this.callbacks.onGestureEnd?.(rotated);
  };

  private clearStructure(): void {
    for (const m of this.atomMeshes) {
      this.scene.remove(m);
      m.dispose();
    }
    this.atomMeshes = [];
    this.atomMembers = [];
    if (this.bondMesh) {
      this.scene.remove(this.bondMesh);
      this.bondMesh.dispose();
      this.bondMesh = null;
    }
    if (this.cellLines) {
      this.scene.remove(this.cellLines);
      this.cellLines.geometry.dispose();
      (this.cellLines.material as Material).dispose();
      this.cellLines = null;
    }
    this.sphereCache?.dispose();
    this.cylinderCache?.dispose();
    this.sphereCache = null;
    this.cylinderCache = null;
    this.clearPolyhedra();
    this.selection = [];
    this.hoverAtom = null;
    this.measureLines.geometry.setDrawRange(0, 0);
  }

  /** Write the matrix of atom i into its mesh, without flagging an upload. */
  private writeAtom(i: number): void {
    const m = this.model!;
    const app = this.app;
    const shown = app !== null && app.atomVisible[i] === 1;
    const base = shown ? app.atomRadius[i] : 0;
    const r = base * (this.selected[i] ? SELECT_SCALE : 1);
    this.pickRadius[i] = base;
    const a = this.atomMeshes[m.species[i]].instanceMatrix.array as Float32Array;
    const o = this.slot[i] * 16;
    a[o] = r;
    a[o + 1] = 0;
    a[o + 2] = 0;
    a[o + 3] = 0;
    a[o + 4] = 0;
    a[o + 5] = r;
    a[o + 6] = 0;
    a[o + 7] = 0;
    a[o + 8] = 0;
    a[o + 9] = 0;
    a[o + 10] = r;
    a[o + 11] = 0;
    a[o + 12] = this.pos[3 * i];
    a[o + 13] = this.pos[3 * i + 1];
    a[o + 14] = this.pos[3 * i + 2];
    a[o + 15] = 1;
  }

  private writeAtomColour(i: number): void {
    const app = this.app;
    if (!app) return;
    const arr = this.atomColourArrays[this.model!.species[i]];
    const o = this.slot[i] * 3;
    let r = SRGB_TO_LINEAR[app.atomColor[3 * i]];
    let g = SRGB_TO_LINEAR[app.atomColor[3 * i + 1]];
    let b = SRGB_TO_LINEAR[app.atomColor[3 * i + 2]];
    if (this.selected[i]) {
      r += (HIGHLIGHT.r - r) * 0.55;
      g += (HIGHLIGHT.g - g) * 0.55;
      b += (HIGHLIGHT.b - b) * 0.55;
    }
    arr[o] = r;
    arr[o + 1] = g;
    arr[o + 2] = b;
  }

  private writeAtomAndMark(i: number): void {
    const s = this.model!.species[i];
    this.writeAtom(i);
    this.writeAtomColour(i);
    this.atomMeshes[s].instanceMatrix.needsUpdate = true;
    this.atomMeshes[s].instanceColor!.needsUpdate = true;
  }

  /** Bond matrices (when `shape`) and colours from the appearance arrays. */
  private writeBonds(shape: boolean): void {
    const mesh = this.bondMesh;
    const model = this.model;
    const app = this.app;
    if (!mesh || !model || !app) return;
    const a = mesh.instanceMatrix.array as Float32Array;
    const nb = model.bonds.length / 2;
    for (let b = 0; b < nb; b++) {
      const i = model.bonds[2 * b];
      const j = model.bonds[2 * b + 1];
      if (shape) {
        const on = app.bondVisible[b] === 1;
        for (let half = 0; half < 2; half++) {
          const o = (2 * b + half) * 16;
          if (!on) {
            a.fill(0, o, o + 16);
            a[o + 15] = 1;
          } else if (half === 0) {
            this.writeHalfBond(a, o, i, j, app.bondRadius[b]);
          } else {
            this.writeHalfBond(a, o, j, i, app.bondRadius[b]);
          }
        }
      }
    }
    if (shape) mesh.instanceMatrix.needsUpdate = true;
    this.writeBondColours();
  }

  /** Bond colours straight from the atom colours (or the rule's own), two halves per bond. */
  private writeBondColours(): void {
    const mesh = this.bondMesh;
    const app = this.app;
    const model = this.model;
    if (!mesh || !app || !model) return;
    const out = mesh.instanceColor!.array as Float32Array;
    const { bonds, bondRule } = model;
    const { atomColor, ruleColor, ruleColored } = app;
    const lin = SRGB_TO_LINEAR;
    const nb = bondRule.length;
    for (let b = 0; b < nb; b++) {
      const ri = bondRule[b];
      const o = 6 * b;
      if (ri !== MANUAL_RULE && ruleColored[ri] === 1) {
        const r = lin[ruleColor[3 * ri]];
        const g = lin[ruleColor[3 * ri + 1]];
        const bl = lin[ruleColor[3 * ri + 2]];
        out[o] = out[o + 3] = r;
        out[o + 1] = out[o + 4] = g;
        out[o + 2] = out[o + 5] = bl;
      } else {
        const i = 3 * bonds[2 * b];
        const j = 3 * bonds[2 * b + 1];
        out[o] = lin[atomColor[i]];
        out[o + 1] = lin[atomColor[i + 1]];
        out[o + 2] = lin[atomColor[i + 2]];
        out[o + 3] = lin[atomColor[j]];
        out[o + 4] = lin[atomColor[j + 1]];
        out[o + 5] = lin[atomColor[j + 2]];
      }
    }
    mesh.instanceColor!.needsUpdate = true;
  }

  /** Matrix of the half-stick running from atom `from` to the midpoint of `from` and `to`. */
  private writeHalfBond(a: Float32Array, o: number, from: number, to: number, r: number): void {
    const p = this.pos;
    const dx = p[3 * to] - p[3 * from];
    const dy = p[3 * to + 1] - p[3 * from + 1];
    const dz = p[3 * to + 2] - p[3 * from + 2];
    const len = Math.hypot(dx, dy, dz);
    const half = len / 2;
    this.v1.set(dx / len, dy / len, dz / len);
    this.q1.setFromUnitVectors(this.yAxis, this.v1);
    const { x, y, z, w } = this.q1;
    // Rotation matrix from the quaternion, columns scaled by (r, half, r).
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    a[o] = (1 - 2 * (yy + zz)) * r;
    a[o + 1] = 2 * (xy + wz) * r;
    a[o + 2] = 2 * (xz - wy) * r;
    a[o + 3] = 0;
    a[o + 4] = 2 * (xy - wz) * half;
    a[o + 5] = (1 - 2 * (xx + zz)) * half;
    a[o + 6] = 2 * (yz + wx) * half;
    a[o + 7] = 0;
    a[o + 8] = 2 * (xz + wy) * r;
    a[o + 9] = 2 * (yz - wx) * r;
    a[o + 10] = (1 - 2 * (xx + yy)) * r;
    a[o + 11] = 0;
    a[o + 12] = p[3 * from] + dx / 4;
    a[o + 13] = p[3 * from + 1] + dy / 4;
    a[o + 14] = p[3 * from + 2] + dz / 4;
    a[o + 15] = 1;
  }

  private buildCellLines(): void {
    const M = this.lattice!.M; // columns a, b, c
    const corner = (i: number, j: number, k: number): number[] => [
      i * M[0][0] + j * M[0][1] + k * M[0][2] - this.origin[0],
      i * M[1][0] + j * M[1][1] + k * M[1][2] - this.origin[1],
      i * M[2][0] + j * M[2][1] + k * M[2][2] - this.origin[2],
    ];
    const v: number[] = [];
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++) {
        v.push(...corner(0, a, b), ...corner(1, a, b));
        v.push(...corner(a, 0, b), ...corner(a, 1, b));
        v.push(...corner(a, b, 0), ...corner(a, b, 1));
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
    this.cellLines = new LineSegments(g, new LineBasicMaterial({ color: 0x5b6578 }));
    this.cellLines.visible = this.showCell;
    this.cellLines.frustumCulled = false;
    this.scene.add(this.cellLines);
  }

  /** Lines joining the selected atoms in order (the measurement overlay). */
  private writeMeasureLines(): void {
    const attr = this.measureLines.geometry.getAttribute('position') as BufferAttribute;
    const a = attr.array as Float32Array;
    const n = Math.min(this.selection.length, 4);
    let k = 0;
    for (let s = 0; s + 1 < n; s++) {
      const i = this.selection[s];
      const j = this.selection[s + 1];
      for (let c = 0; c < 3; c++) a[k++] = this.pos[3 * i + c];
      for (let c = 0; c < 3; c++) a[k++] = this.pos[3 * j + c];
    }
    attr.needsUpdate = true;
    this.measureLines.geometry.setDrawRange(0, k / 3);
  }

  private buildTriad(): void {
    this.triadGroup?.dispose();
    this.triadScene.clear();
    const M = this.lattice!.M;
    const disposables: { dispose(): void }[] = [];
    const colours = [0xe5484d, 0x30a46c, 0x3e63dd];
    const names = ['a', 'b', 'c'];
    for (let k = 0; k < 3; k++) {
      const dir = new Vector3(M[0][k], M[1][k], M[2][k]).normalize();
      const arrow = new ArrowHelper(dir, new Vector3(), 1, colours[k], 0.28, 0.14);
      this.triadScene.add(arrow);
      disposables.push({
        dispose: () => {
          arrow.dispose();
        },
      });
      const label = makeLabel(names[k], colours[k]);
      label.position.copy(dir).multiplyScalar(1.28);
      this.triadScene.add(label);
      disposables.push({
        dispose: () => {
          label.material.map?.dispose();
          label.material.dispose();
        },
      });
    }
    this.triadGroup = { dispose: () => disposables.forEach((d) => d.dispose()) };
  }

  // ---- camera ----------------------------------------------------------------------------------

  /** Height of the world visible at zoom 1: the bounding sphere plus a margin. */
  private viewHeight(): number {
    return this.radius * 2.5;
  }

  /** Size of the structure: sets `radius` (bounding sphere) and the default camera distance. */
  private measureExtent(): void {
    const { min, max } = this.model!.bounds;
    // Margin for the atom spheres at the edge; independent of the style so zoom is stable.
    const maxAtom = Math.max(0, ...this.model!.info.map((i) => i.covalent));
    this.radius = Math.max(
      0.5,
      Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 + maxAtom,
    );
    this.distance = this.viewHeight() / 2 / Math.tan((FOV * Math.PI) / 360);
  }

  /** Put the camera back where it was in absolute (Cartesian) coordinates after a rebuild. */
  private restoreView(saved: {
    position: Vector3;
    target: Vector3;
    up: Vector3;
    worldPerPixel: number;
  }): void {
    this.measureExtent();
    const o = new Vector3(this.origin[0], this.origin[1], this.origin[2]);
    this.controls.target.copy(saved.target).sub(o);
    this.camera.up.copy(saved.up);
    if (this.camera === this.ortho) {
      // An orthographic image does not depend on the camera distance; keep the direction, put the
      // camera outside the new structure, and keep the angstrom-per-pixel scale.
      const dir = saved.position.clone().sub(saved.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, this.distance);
      this.ortho.zoom = this.viewHeight() / saved.worldPerPixel;
    } else {
      this.camera.position.copy(saved.position).sub(o);
    }
    this.updateProjection();
    this.controls.update();
  }

  private fitCamera(): void {
    this.measureExtent();
    this.controls.target.set(0, 0, 0);
    this.ortho.zoom = 1;
    this.camera.up.set(0, 1, 0);
    // From above-right-front: c towards the viewer with a slight tilt so depth is visible.
    this.v1.set(0.28, 0.2, 1).normalize();
    this.camera.position.copy(this.v1).multiplyScalar(this.distance);
    this.updateProjection();
    this.controls.update();
  }

  private updateProjection(): void {
    const aspect = this.width / this.height;
    const h = this.viewHeight();
    // Generous: a perspective camera may be zoomed (dollied) far out.
    const far = this.distance * 40 + this.radius * 12;
    this.controls.maxDistance = this.distance * 30;
    this.ortho.left = (-aspect * h) / 2;
    this.ortho.right = (aspect * h) / 2;
    this.ortho.top = h / 2;
    this.ortho.bottom = -h / 2;
    this.ortho.near = 0.05;
    this.ortho.far = far;
    this.ortho.updateProjectionMatrix();
    this.persp.aspect = aspect;
    this.persp.near = 0.05;
    this.persp.far = far;
    this.persp.updateProjectionMatrix();
    this.setPanSpeed();
  }

  /**
   * The trackball's pan factor depends on the camera, so that a drag moves the structure by the
   * distance the pointer moved: the visible width over the canvas width, scaled by the eye distance
   * the controls multiply in.
   */
  private setPanSpeed(): void {
    if (this.camera === this.ortho) {
      this.controls.panSpeed =
        this.width / Math.max(1e-6, this.camera.position.distanceTo(this.controls.target));
    } else {
      this.controls.panSpeed = 2 * Math.tan((FOV * Math.PI) / 360) * (this.width / this.height);
    }
  }

  // ---- pointer ---------------------------------------------------------------------------------

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    if (e.buttons === 0 && this.picking) this.hoverDirty = true;
  };

  private readonly onPointerLeave = (): void => {
    this.hoverDirty = false;
    if (this.hoverAtom !== null) {
      this.hoverAtom = null;
      this.callbacks.onHover?.(null, 0, 0);
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downButton = e.button;
    this.hoverDirty = false;
    if (this.hoverAtom !== null) {
      this.hoverAtom = null;
      this.callbacks.onHover?.(null, 0, 0);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    if (!this.picking || this.downButton !== 0 || e.button !== 0 || moved > 4) return;
    const hit = this.pickAt(e.clientX, e.clientY);
    if (hit === null) {
      if (this.selection.length > 0) this.setSelection([]);
      return;
    }
    const at = this.selection.indexOf(hit);
    if (at >= 0) {
      this.setSelection(this.selection.filter((i) => i !== hit));
    } else if (this.selectionLimit > 0 && this.selection.length >= this.selectionLimit) {
      this.setSelection([hit]);
    } else {
      this.setSelection([...this.selection, hit]);
    }
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  // ---- frame loop ------------------------------------------------------------------------------

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    this.controls.update();
    if (this.hoverDirty) {
      this.hoverDirty = false;
      const hit = this.pickAt(this.pointerX, this.pointerY);
      if (hit !== this.hoverAtom) {
        this.hoverAtom = hit;
        this.callbacks.onHover?.(hit, this.pointerX, this.pointerY);
      }
    }
    if (this.needsRender) {
      this.needsRender = false;
      this.draw();
      this.stats.renders++;
      this.fpsFrames++;
      this.callbacks.onRender?.();
    }
    // `fps` counts frames actually drawn (0 while idle), not animation-loop ticks, so it shows
    // what the GPU delivers while rotating.
    this.stats.frames++;
    if (now - this.fpsStart >= 1000) {
      this.stats.fps = (this.fpsFrames * 1000) / (now - this.fpsStart);
      this.fpsStart = now;
      this.fpsFrames = 0;
    }
  };

  private draw(): void {
    this.positionLight();
    this.drawWith(this.renderer, this.width, this.height, 1);
  }

  /** The key light sits up and to the left of the camera, so shading follows the rotation. */
  private positionLight(): void {
    const camera = this.camera;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const t = this.controls.target;
    const reach = this.distance;
    this.sun.position.set(
      camera.position.x + (-0.55 * e[0] + 0.75 * e[4]) * reach,
      camera.position.y + (-0.55 * e[1] + 0.75 * e[5]) * reach,
      camera.position.z + (-0.55 * e[2] + 0.75 * e[6]) * reach,
    );
    this.sun.target.position.copy(t);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Draw the scene and the axes triad with `r` into a w × h pixel target. `f` is the scale of that
   * target against the screen (the triad keeps its size on the picture).
   */
  private drawWith(r: WebGLRenderer, w: number, h: number, f: number): void {
    const camera = this.camera;
    const t = this.controls.target;
    r.autoClear = true;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.render(this.scene, camera);

    if (this.showAxes && this.triadGroup) {
      const tc = this.triadCamera;
      tc.up.copy(camera.up);
      tc.position.copy(camera.position).sub(t).normalize().multiplyScalar(6);
      tc.lookAt(0, 0, 0);
      const size = Math.min(TRIAD_SIZE, this.width / 2, this.height / 2) * f;
      const off = 8 * f;
      r.autoClear = false;
      r.clearDepth();
      r.setScissorTest(true);
      r.setViewport(off, off, size, size);
      r.setScissor(off, off, size, size);
      r.render(this.triadScene, tc);
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
      r.autoClear = true;
    }
  }

  // ---- export ------------------------------------------------------------------------------------

  /** Size of the view in CSS pixels. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * The picture as it is now, rendered offscreen at `pxW` × `pxH` pixels (same aspect as the view)
   * on a transparent background: a 2D canvas to composite on. Null when WebGL cannot make a target
   * that large.
   */
  renderToCanvas(pxW: number, pxH: number): HTMLCanvasElement | null {
    if (!this.model) return null;
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    let r: WebGLRenderer | null = null;
    try {
      r = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1);
      r.setSize(pxW, pxH, false);
      r.setClearColor(0xffffff, 0);
      this.positionLight();
      this.drawWith(r, pxW, pxH, pxW / this.width);
      const out = document.createElement('canvas');
      out.width = pxW;
      out.height = pxH;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(canvas, 0, 0);
      return out;
    } catch {
      return null;
    } finally {
      r?.dispose();
      r?.forceContextLoss();
    }
  }

  /**
   * What is drawn, as numbers in screen pixels with the distance from the camera, for the vector
   * export. `extras` carries what only the page knows: background colour, atom label texts (by
   * model index) and the legend.
   */
  exportScene(extras: {
    background: string;
    labels: Map<number, string>;
    legend: LegendEntry[];
  }): SvgScene | null {
    const model = this.model;
    const app = this.app;
    if (!model || !app) return null;
    const camera = this.camera;
    camera.updateMatrixWorld();
    const W = this.width;
    const H = this.height;
    const q = this.v2;
    const persp = camera === this.persp;
    const orthoScale = H / (this.viewHeight() / this.ortho.zoom);
    const tanHalf = Math.tan((FOV * Math.PI) / 360);

    // screen x, y and the distance from the camera of a scene point; the scale is pixels per angstrom
    const at = { x: 0, y: 0, depth: 0, scale: 1 };
    const place = (x: number, y: number, z: number): void => {
      q.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      at.depth = -q.z;
      at.scale = persp ? H / (2 * Math.max(1e-6, at.depth) * tanHalf) : orthoScale;
      q.applyMatrix4(camera.projectionMatrix);
      at.x = (q.x * 0.5 + 0.5) * W;
      at.y = (-q.y * 0.5 + 0.5) * H;
    };
    const behind = () => persp && at.depth <= 0;
    const P = this.pos;

    const atoms: SvgScene['atoms'] = [];
    for (let i = 0; i < model.count; i++) {
      if (app.atomVisible[i] !== 1) continue;
      place(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
      if (behind()) continue;
      const r = app.atomRadius[i] * at.scale;
      if (at.x + r < 0 || at.x - r > W || at.y + r < 0 || at.y - r > H) continue;
      atoms.push({
        index: i,
        x: at.x,
        y: at.y,
        r,
        depth: at.depth,
        color: rgbToHex(app.atomColor[3 * i], app.atomColor[3 * i + 1], app.atomColor[3 * i + 2]),
      });
    }

    const bonds: SvgSegment[] = [];
    if (app.bondsDrawn && this.bondMesh?.visible) {
      const nb = model.bonds.length / 2;
      for (let b = 0; b < nb; b++) {
        if (app.bondVisible[b] !== 1) continue;
        const i = model.bonds[2 * b];
        const j = model.bonds[2 * b + 1];
        const ri = model.bondRule[b];
        const ruleOwn = ri !== MANUAL_RULE && app.ruleColored[ri] === 1;
        for (let half = 0; half < 2; half++) {
          const from = half === 0 ? i : j;
          const to = half === 0 ? j : i;
          const rgb = ruleOwn
            ? [app.ruleColor[3 * ri], app.ruleColor[3 * ri + 1], app.ruleColor[3 * ri + 2]]
            : [app.atomColor[3 * from], app.atomColor[3 * from + 1], app.atomColor[3 * from + 2]];
          const ax = P[3 * from];
          const ay = P[3 * from + 1];
          const az = P[3 * from + 2];
          const mx = (ax + P[3 * to]) / 2;
          const my = (ay + P[3 * to + 1]) / 2;
          const mz = (az + P[3 * to + 2]) / 2;
          place(ax, ay, az);
          if (behind()) continue;
          const x1 = at.x;
          const y1 = at.y;
          place(mx, my, mz);
          if (behind()) continue;
          const x2 = at.x;
          const y2 = at.y;
          if ((x1 < 0 && x2 < 0) || (x1 > W && x2 > W) || (y1 < 0 && y2 < 0) || (y1 > H && y2 > H))
            continue;
          // depth of the middle of the half-stick
          place((ax + mx) / 2, (ay + my) / 2, (az + mz) / 2);
          bonds.push({
            x1,
            y1,
            x2,
            y2,
            depth: at.depth,
            color: rgbToHex(rgb[0], rgb[1], rgb[2]),
            width: 2 * app.bondRadius[b] * at.scale,
          });
        }
      }
    }

    const cell: SvgSegment[] = [];
    if (this.showCell && this.cellLines) {
      const a = this.cellLines.geometry.getAttribute('position').array as Float32Array;
      for (let k = 0; k + 5 < a.length; k += 6) {
        place(a[k], a[k + 1], a[k + 2]);
        const x1 = at.x;
        const y1 = at.y;
        place(a[k + 3], a[k + 4], a[k + 5]);
        const x2 = at.x;
        const y2 = at.y;
        place((a[k] + a[k + 3]) / 2, (a[k + 1] + a[k + 4]) / 2, (a[k + 2] + a[k + 5]) / 2);
        cell.push({ x1, y1, x2, y2, depth: at.depth, color: '#5b6578', width: 1 });
      }
    }

    const triangles: SvgTriangle[] = [];
    const polyEdges: SvgSegment[] = [];
    const poly = this.polyInfo;
    if (poly) {
      const g = poly.geometry;
      const o = this.origin;
      const pts = [0, 0, 0, 0, 0, 0] as SvgTriangle['pts'];
      for (let t = 0; t < g.triangles.length / 9; t++) {
        let depth = 0;
        let hidden = false;
        for (let v = 0; v < 3; v++) {
          place(
            g.triangles[9 * t + 3 * v] - o[0],
            g.triangles[9 * t + 3 * v + 1] - o[1],
            g.triangles[9 * t + 3 * v + 2] - o[2],
          );
          if (behind()) hidden = true;
          pts[2 * v] = at.x;
          pts[2 * v + 1] = at.y;
          depth += at.depth / 3;
        }
        if (hidden) continue;
        triangles.push({
          pts: [...pts] as SvgTriangle['pts'],
          depth,
          color: rgbToHex(
            g.triangleColor[9 * t],
            g.triangleColor[9 * t + 1],
            g.triangleColor[9 * t + 2],
          ),
        });
      }
      if (poly.edges) {
        for (let e = 0; e < g.edges.length / 6; e++) {
          place(g.edges[6 * e] - o[0], g.edges[6 * e + 1] - o[1], g.edges[6 * e + 2] - o[2]);
          const x1 = at.x;
          const y1 = at.y;
          const d1 = at.depth;
          place(g.edges[6 * e + 3] - o[0], g.edges[6 * e + 4] - o[1], g.edges[6 * e + 5] - o[2]);
          polyEdges.push({
            x1,
            y1,
            x2: at.x,
            y2: at.y,
            depth: (d1 + at.depth) / 2,
            color: rgbToHex(g.edgeColor[6 * e], g.edgeColor[6 * e + 1], g.edgeColor[6 * e + 2]),
            width: 1,
          });
        }
      }
    }

    let triad: SvgScene['triad'] = null;
    if (this.showAxes && this.triadGroup && this.lattice) {
      const size = Math.min(TRIAD_SIZE, W / 2, H / 2);
      const unit = size / 3.2; // the triad camera sees ±1.6 across `size` pixels
      const M = this.lattice.M;
      const colours = ['#e5484d', '#30a46c', '#3e63dd'];
      const axes: SvgAxis[] = [0, 1, 2].map((k) => {
        const d = this.v1
          .set(M[0][k], M[1][k], M[2][k])
          .transformDirection(camera.matrixWorldInverse);
        return {
          dx: d.x * unit,
          dy: -d.y * unit,
          depth: -d.z,
          name: 'abc'[k],
          color: colours[k],
        };
      });
      triad = { cx: 8 + size / 2, cy: H - 8 - size / 2, axes };
    }

    return {
      width: W,
      height: H,
      background: extras.background,
      toon: this.toon,
      atoms,
      bonds,
      cell,
      polyhedra: { triangles, opacity: poly?.opacity ?? 0, edges: polyEdges },
      triad,
      labels: extras.labels,
      legend: extras.legend,
    };
  }
}

/** A small sprite with one letter, for the axes triad. */
function makeLabel(text: string, colour: number): Sprite {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'italic 600 46px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + colour.toString(16).padStart(6, '0');
  ctx.fillText(text, size / 2, size / 2 + 2);
  const texture = new CanvasTexture(canvas);
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.setScalar(0.6);
  return sprite;
}
