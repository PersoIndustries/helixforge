import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ViewMode = "solid" | "wireframe" | "transparent";
export type MaterialPreset = "steel" | "aluminum" | "brass";

export interface ViewerHandle {
  setPart: (group: THREE.Group) => void;
  getScene: () => THREE.Scene;
  getPartGroup: () => THREE.Group | null;
  setView: (v: "front" | "side" | "top" | "iso" | "fit") => void;
  setViewMode: (m: ViewMode) => void;
  setMaterial: (m: MaterialPreset) => void;
  setAutoRotate: (b: boolean) => void;
  setGridVisible: (b: boolean) => void;
  setAxesVisible: (b: boolean) => void;
  setClipEnabled: (b: boolean) => void;
  setClipPosition: (v: number) => void;
}

const MATERIAL_PRESETS: Record<MaterialPreset, { color: number; metalness: number; roughness: number }> = {
  steel: { color: 0xb8bfc7, metalness: 0.9, roughness: 0.32 },
  aluminum: { color: 0xd4d7db, metalness: 0.85, roughness: 0.44 },
  brass: { color: 0xd4a24a, metalness: 0.9, roughness: 0.3 },
};

export const Viewer3D = forwardRef<ViewerHandle>(function Viewer3D(_props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    partGroup: THREE.Group | null;
    grid: THREE.GridHelper;
    axes: THREE.AxesHelper;
    ruler: THREE.Group;
    clipPlane: THREE.Plane;
    clipHelper: THREE.PlaneHelper;
    clipEnabled: boolean;
    viewMode: ViewMode;
    materialPreset: MaterialPreset;
    frame: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1418);
    scene.fog = new THREE.Fog(0x0e1418, 200, 800);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(80, -80, 60);
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    // Lights
    const hemi = new THREE.HemisphereLight(0x88aacc, 0x101418, 0.6);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(60, -80, 100);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x66ddee, 0.7);
    fill.position.set(-80, 40, 40);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffcc88, 0.4);
    rim.position.set(-40, -80, -40);
    scene.add(rim);

    // Environment approximation via pmrem-less: simple room encoding
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new THREE.Scene()).texture;
    scene.environment = envTex;

    // Grid + Axes
    const grid = new THREE.GridHelper(200, 20, 0x2a5566, 0x1c3844);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    const axes = new THREE.AxesHelper(50);
    scene.add(axes);

    // Ruler ticks along X axis
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

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.9;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.9;
    controls.autoRotateSpeed = 0.8;

    // Clip plane
    const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    const clipHelper = new THREE.PlaneHelper(clipPlane, 80, 0x22d3ee);
    clipHelper.visible = false;
    scene.add(clipHelper);

    const state = {
      renderer,
      scene,
      camera,
      controls,
      partGroup: null as THREE.Group | null,
      grid,
      axes,
      ruler,
      clipPlane,
      clipHelper,
      clipEnabled: false,
      viewMode: "solid" as ViewMode,
      materialPreset: "steel" as MaterialPreset,
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

    // Keyboard shortcuts
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const map: Record<string, "front" | "side" | "top" | "iso" | "fit"> = {
        "1": "front",
        "2": "side",
        "3": "top",
        "4": "iso",
        f: "fit",
      };
      const v = map[e.key.toLowerCase()];
      if (v) setViewImpl(v);
    };
    window.addEventListener("keydown", onKey);

    function setViewImpl(v: "front" | "side" | "top" | "iso" | "fit") {
      if (!state.partGroup) return;
      const box = new THREE.Box3().setFromObject(state.partGroup);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const dist = Math.max(size.x, size.y, size.z) * 2.2 + 20;
      controls.target.copy(center);
      switch (v) {
        case "front":
          camera.position.set(center.x, center.y - dist, center.z);
          break;
        case "side":
          camera.position.set(center.x + dist, center.y, center.z);
          break;
        case "top":
          camera.position.set(center.x, center.y, center.z + dist);
          break;
        case "iso":
        case "fit":
          camera.position.set(center.x + dist * 0.7, center.y - dist * 0.7, center.z + dist * 0.6);
          break;
      }
      camera.lookAt(center);
      controls.update();
    }

    (state as any).setViewImpl = setViewImpl;

    return () => {
      cancelAnimationFrame(state.frame);
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  const applyMaterial = (group: THREE.Group) => {
    const s = stateRef.current!;
    const preset = MATERIAL_PRESETS[s.materialPreset];
    group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      // Preserve dark bore material
      const currentMat = m.material as THREE.MeshStandardMaterial;
      if (currentMat && currentMat.color && currentMat.color.getHex() === 0x0b0f14) return;
      const mat = new THREE.MeshStandardMaterial({
        color: preset.color,
        metalness: preset.metalness,
        roughness: preset.roughness,
        envMapIntensity: 1.1,
        wireframe: s.viewMode === "wireframe",
        transparent: s.viewMode === "transparent",
        opacity: s.viewMode === "transparent" ? 0.45 : 1,
        clippingPlanes: s.clipEnabled ? [s.clipPlane] : [],
        side: THREE.DoubleSide,
      });
      m.material = mat;
    });
  };

  useImperativeHandle(ref, () => ({
    setPart: (group: THREE.Group) => {
      const s = stateRef.current!;
      if (s.partGroup) {
        s.scene.remove(s.partGroup);
        s.partGroup.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.isMesh) {
            m.geometry?.dispose();
            const mat = m.material as THREE.Material | THREE.Material[];
            if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
            else mat?.dispose();
          }
        });
      }
      s.partGroup = group;
      applyMaterial(group);
      s.scene.add(group);
      (s as any).setViewImpl("iso");
    },
    getScene: () => stateRef.current!.scene,
    getPartGroup: () => stateRef.current!.partGroup,
    setView: (v) => (stateRef.current as any)?.setViewImpl(v),
    setViewMode: (m) => {
      const s = stateRef.current!;
      s.viewMode = m;
      if (s.partGroup) applyMaterial(s.partGroup);
    },
    setMaterial: (m) => {
      const s = stateRef.current!;
      s.materialPreset = m;
      if (s.partGroup) applyMaterial(s.partGroup);
    },
    setAutoRotate: (b) => {
      const s = stateRef.current!;
      s.controls.autoRotate = b;
    },
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
      if (s.partGroup) applyMaterial(s.partGroup);
    },
    setClipPosition: (v) => {
      const s = stateRef.current!;
      s.clipPlane.constant = v;
    },
  }));

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-[oklch(0.15_0.02_240)]"
    />
  );
});
