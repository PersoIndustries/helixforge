import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ViewMode = "solid" | "wireframe" | "transparent";
export type MaterialPreset = "steel" | "aluminum" | "brass";

export interface PartRenderInput {
  id: string;
  group: THREE.Group;
  transform: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
  visible: boolean;
}

export interface ViewerHandle {
  setParts: (parts: PartRenderInput[]) => void;
  setSelected: (id: string | null) => void;
  getScene: () => THREE.Scene;
  getPartGroup: (id: string) => THREE.Group | null;
  getAssemblyGroup: () => THREE.Group;
  setView: (v: "front" | "side" | "top" | "iso" | "fit") => void;
  focusOn: (id: string | null) => void;
  setViewMode: (m: ViewMode) => void;
  setMaterial: (m: MaterialPreset) => void;
  setAutoRotate: (b: boolean) => void;
  setGridVisible: (b: boolean) => void;
  setAxesVisible: (b: boolean) => void;
  setClipEnabled: (b: boolean) => void;
  setClipPosition: (v: number) => void;
}

interface Props {
  onPick?: (id: string | null) => void;
}

const MATERIAL_PRESETS: Record<MaterialPreset, { color: number; metalness: number; roughness: number }> = {
  steel: { color: 0xb8bfc7, metalness: 0.9, roughness: 0.32 },
  aluminum: { color: 0xd4d7db, metalness: 0.85, roughness: 0.44 },
  brass: { color: 0xd4a24a, metalness: 0.9, roughness: 0.3 },
};

const HIGHLIGHT_COLOR = 0x22d3ee;

export const Viewer3D = forwardRef<ViewerHandle, Props>(function Viewer3D({ onPick }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    assembly: THREE.Group; // container for all part groups
    partMap: Map<string, THREE.Group>;
    grid: THREE.GridHelper;
    axes: THREE.AxesHelper;
    ruler: THREE.Group;
    clipPlane: THREE.Plane;
    clipHelper: THREE.PlaneHelper;
    clipEnabled: boolean;
    viewMode: ViewMode;
    materialPreset: MaterialPreset;
    selectedId: string | null;
    frame: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1418);
    scene.fog = new THREE.Fog(0x0e1418, 400, 1200);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(120, -120, 90);
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.HemisphereLight(0x88aacc, 0x101418, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(60, -80, 100);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x66ddee, 0.7);
    fill.position.set(-80, 40, 40);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffcc88, 0.4);
    rim.position.set(-40, -80, -40);
    scene.add(rim);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.Scene()).texture;

    // Grid + Axes
    const grid = new THREE.GridHelper(400, 40, 0x2a5566, 0x1c3844);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    const axes = new THREE.AxesHelper(60);
    scene.add(axes);

    const ruler = new THREE.Group();
    const tickMat = new THREE.LineBasicMaterial({ color: 0x55b8c8 });
    for (let i = -100; i <= 100; i += 10) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(i, 0, 0),
        new THREE.Vector3(i, 0, i % 50 === 0 ? 3 : 1.5),
      ]);
      ruler.add(new THREE.Line(g, tickMat));
    }
    scene.add(ruler);

    // Assembly root
    const assembly = new THREE.Group();
    assembly.name = "Assembly";
    scene.add(assembly);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.9;
    controls.zoomSpeed = 0.9;
    controls.autoRotateSpeed = 0.8;

    const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    const clipHelper = new THREE.PlaneHelper(clipPlane, 100, 0x22d3ee);
    clipHelper.visible = false;
    scene.add(clipHelper);

    const state = {
      renderer, scene, camera, controls, assembly,
      partMap: new Map<string, THREE.Group>(),
      grid, axes, ruler, clipPlane, clipHelper,
      clipEnabled: false,
      viewMode: "solid" as ViewMode,
      materialPreset: "steel" as MaterialPreset,
      selectedId: null as string | null,
      frame: 0,
    };
    stateRef.current = state;

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const animate = () => {
      state.frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Click picking
    const raycaster = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let downX = 0, downY = 0, downT = 0;
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; downT = performance.now(); };
    const onUp = (e: PointerEvent) => {
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      if (dx > 4 || dy > 4 || performance.now() - downT > 400) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ptr, camera);
      const hits = raycaster.intersectObjects(assembly.children, true);
      let pickedId: string | null = null;
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o) {
          if (o.userData && o.userData.partId) { pickedId = o.userData.partId as string; break; }
          o = o.parent;
        }
        if (pickedId) break;
      }
      onPickRef.current?.(pickedId);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // Keyboard shortcuts
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const map: Record<string, "front" | "side" | "top" | "iso" | "fit"> = {
        "1": "front", "2": "side", "3": "top", "4": "iso", f: "fit",
      };
      const v = map[e.key.toLowerCase()];
      if (v) setViewImpl(v, state.selectedId && v === "fit" ? state.selectedId : null);
    };
    window.addEventListener("keydown", onKey);

    function setViewImpl(v: "front" | "side" | "top" | "iso" | "fit", focusId: string | null = null) {
      const target = focusId ? state.partMap.get(focusId) : state.assembly;
      if (!target || (target === state.assembly && state.assembly.children.length === 0)) return;
      const box = new THREE.Box3().setFromObject(target);
      if (!isFinite(box.min.x)) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const dist = Math.max(size.x, size.y, size.z, 20) * 2.2 + 20;
      controls.target.copy(center);
      switch (v) {
        case "front": camera.position.set(center.x, center.y - dist, center.z); break;
        case "side": camera.position.set(center.x + dist, center.y, center.z); break;
        case "top": camera.position.set(center.x, center.y, center.z + dist); break;
        case "iso":
        case "fit":
          camera.position.set(center.x + dist * 0.7, center.y - dist * 0.7, center.z + dist * 0.6);
          break;
      }
      camera.lookAt(center);
      controls.update();
    }
    (state as unknown as { setViewImpl: typeof setViewImpl }).setViewImpl = setViewImpl;

    return () => {
      cancelAnimationFrame(state.frame);
      window.removeEventListener("keydown", onKey);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  const applyMaterialToGroup = (group: THREE.Group, selected: boolean) => {
    const s = stateRef.current!;
    const preset = MATERIAL_PRESETS[s.materialPreset];
    group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const currentMat = m.material as THREE.MeshStandardMaterial;
      const isBore = currentMat && currentMat.color && currentMat.color.getHex() === 0x0b0f14;
      if (isBore) return;
      const mat = new THREE.MeshStandardMaterial({
        color: preset.color,
        metalness: preset.metalness,
        roughness: preset.roughness,
        envMapIntensity: 1.1,
        wireframe: s.viewMode === "wireframe",
        transparent: s.viewMode === "transparent",
        opacity: s.viewMode === "transparent" ? 0.4 : 1,
        clippingPlanes: s.clipEnabled ? [s.clipPlane] : [],
        side: THREE.DoubleSide,
        emissive: selected ? new THREE.Color(HIGHLIGHT_COLOR) : new THREE.Color(0x000000),
        emissiveIntensity: selected ? 0.35 : 0,
      });
      m.material = mat;
    });
  };

  const reapplyAllMaterials = () => {
    const s = stateRef.current!;
    s.partMap.forEach((g, id) => applyMaterialToGroup(g, id === s.selectedId));
  };

  useImperativeHandle(ref, () => ({
    setParts: (parts: PartRenderInput[]) => {
      const s = stateRef.current!;
      const incoming = new Set(parts.map((p) => p.id));
      // Remove missing
      for (const [id, g] of Array.from(s.partMap.entries())) {
        if (!incoming.has(id)) {
          s.assembly.remove(g);
          g.traverse((c) => {
            const m = c as THREE.Mesh;
            if (m.isMesh) {
              m.geometry?.dispose();
              const mat = m.material as THREE.Material | THREE.Material[];
              if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
              else mat?.dispose();
            }
          });
          s.partMap.delete(id);
        }
      }
      // Add or replace
      for (const p of parts) {
        const existing = s.partMap.get(p.id);
        if (existing !== p.group) {
          if (existing) {
            s.assembly.remove(existing);
            existing.traverse((c) => {
              const m = c as THREE.Mesh;
              if (m.isMesh) {
                m.geometry?.dispose();
                const mat = m.material as THREE.Material | THREE.Material[];
                if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
                else mat?.dispose();
              }
            });
          }
          p.group.userData.partId = p.id;
          p.group.traverse((c) => { c.userData.partId = p.id; });
          s.assembly.add(p.group);
          s.partMap.set(p.id, p.group);
          applyMaterialToGroup(p.group, p.id === s.selectedId);
        }
        // Transform & visibility (relative to internal centering)
        p.group.position.set(p.transform.x, p.transform.y, p.transform.z);
        // Preserve original centering by using an inner offset? Simpler: parts are built centered, translate is absolute.
        p.group.rotation.set(p.transform.rx, p.transform.ry, p.transform.rz);
        p.group.visible = p.visible;
      }
    },
    setSelected: (id) => {
      const s = stateRef.current!;
      s.selectedId = id;
      reapplyAllMaterials();
    },
    getScene: () => stateRef.current!.scene,
    getPartGroup: (id) => stateRef.current!.partMap.get(id) ?? null,
    getAssemblyGroup: () => stateRef.current!.assembly,
    setView: (v) => (stateRef.current as unknown as { setViewImpl: (v: string, id: string | null) => void }).setViewImpl(v, null),
    focusOn: (id) => (stateRef.current as unknown as { setViewImpl: (v: string, id: string | null) => void }).setViewImpl("iso", id),
    setViewMode: (m) => { stateRef.current!.viewMode = m; reapplyAllMaterials(); },
    setMaterial: (m) => { stateRef.current!.materialPreset = m; reapplyAllMaterials(); },
    setAutoRotate: (b) => { stateRef.current!.controls.autoRotate = b; },
    setGridVisible: (b) => (stateRef.current!.grid.visible = b),
    setAxesVisible: (b) => {
      const s = stateRef.current!;
      s.axes.visible = b;
      s.ruler.visible = b;
    },
    setClipEnabled: (b) => {
      const s = stateRef.current!;
      s.clipEnabled = b;
      s.clipHelper.visible = b;
      reapplyAllMaterials();
    },
    setClipPosition: (v) => { stateRef.current!.clipPlane.constant = v; },
  }));

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-[oklch(0.15_0.02_240)]"
    />
  );
});
