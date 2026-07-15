import * as THREE from "three";

export interface DiagnosticOptions {
  showOpenEdges: boolean;
  showNonManifold: boolean;
  showNormals: boolean;
  showThickness: boolean;
  wallThicknessMin: number; // red below
  wallThicknessSafe: number; // green above
}

export interface DiagnosticReport {
  meshes: number;
  triangles: number;
  openEdges: number;
  nonManifoldEdges: number;
  thinTriangles: number; // < min
  warningTriangles: number; // < safe
  minWallThickness: number; // mm
  warnings: string[];
}

export interface DiagnosticResult {
  overlay: THREE.Group;
  report: DiagnosticReport;
}

const QUANT = 1000; // 0.001 mm

function keyPoint(p: THREE.Vector3) {
  return `${Math.round(p.x * QUANT)},${Math.round(p.y * QUANT)},${Math.round(p.z * QUANT)}`;
}
function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface Tri {
  a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3;
  center: THREE.Vector3; normal: THREE.Vector3;
}

/** Analyze all meshes under `root` (world-space). Returns an overlay group
 *  positioned in the same world coords (add directly to the scene, not to root). */
export function analyzeGroup(root: THREE.Object3D, opts: DiagnosticOptions): DiagnosticResult {
  const overlay = new THREE.Group();
  overlay.name = "MeshDiagnosticsOverlay";
  overlay.renderOrder = 999;

  const report: DiagnosticReport = {
    meshes: 0, triangles: 0, openEdges: 0, nonManifoldEdges: 0,
    thinTriangles: 0, warningTriangles: 0,
    minWallThickness: Infinity, warnings: [],
  };

  root.updateMatrixWorld(true);

  const edgeCount = new Map<string, number>();
  const edgeSample = new Map<string, [THREE.Vector3, THREE.Vector3]>();
  const tris: Tri[] = [];
  const meshList: THREE.Mesh[] = [];

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const geom = m.geometry as THREE.BufferGeometry;
    if (!geom || !geom.attributes.position) return;
    // Skip helper/wire objects
    const mat = m.material as THREE.Material | undefined;
    if (mat && (mat as THREE.MeshBasicMaterial).color?.getHex?.() === 0x0b0f14) {
      // interior bore mesh — still analyze (it's actual geometry)
    }
    report.meshes += 1;
    meshList.push(m);

    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    report.triangles += triCount;

    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (let i = 0; i < triCount; i++) {
      const ia = idx ? idx.getX(i * 3) : i * 3;
      const ib = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
      const ic = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
      va.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
      vb.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
      vc.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
      const ka = keyPoint(va), kb = keyPoint(vb), kc = keyPoint(vc);
      for (const [k1, k2, p1, p2] of [
        [ka, kb, va, vb], [kb, kc, vb, vc], [kc, ka, vc, va],
      ] as [string, string, THREE.Vector3, THREE.Vector3][]) {
        const k = edgeKey(k1, k2);
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
        if (!edgeSample.has(k)) edgeSample.set(k, [p1.clone(), p2.clone()]);
      }
      const center = new THREE.Vector3().addVectors(va, vb).add(vc).multiplyScalar(1 / 3);
      const normal = new THREE.Vector3().subVectors(vb, va)
        .cross(new THREE.Vector3().subVectors(vc, va)).normalize();
      tris.push({ a: va.clone(), b: vb.clone(), c: vc.clone(), center, normal });
    }
  });

  // Classify edges
  const openSegs: number[] = [];
  const nmSegs: number[] = [];
  for (const [k, count] of edgeCount) {
    if (count === 1) {
      report.openEdges += 1;
      const [p1, p2] = edgeSample.get(k)!;
      openSegs.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    } else if (count > 2) {
      report.nonManifoldEdges += 1;
      const [p1, p2] = edgeSample.get(k)!;
      nmSegs.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  if (opts.showOpenEdges && openSegs.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(openSegs, 3));
    const line = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xff2a2a, linewidth: 2, depthTest: false, transparent: true, opacity: 0.95 })
    );
    line.renderOrder = 1000;
    overlay.add(line);
  }
  if (opts.showNonManifold && nmSegs.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(nmSegs, 3));
    const line = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xff00ff, linewidth: 2, depthTest: false, transparent: true, opacity: 0.95 })
    );
    line.renderOrder = 1000;
    overlay.add(line);
  }

  // Normals visualization
  if (opts.showNormals && tris.length) {
    const step = Math.max(1, Math.floor(tris.length / 3000));
    const pts: number[] = [];
    for (let i = 0; i < tris.length; i += step) {
      const t = tris[i];
      pts.push(t.center.x, t.center.y, t.center.z,
        t.center.x + t.normal.x * 1.5, t.center.y + t.normal.y * 1.5, t.center.z + t.normal.z * 1.5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    overlay.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6 })));
  }

  // Wall thickness via raycasting inward
  if (opts.showThickness && tris.length && meshList.length) {
    const raycaster = new THREE.Raycaster();
    raycaster.far = Math.max(50, opts.wallThicknessSafe * 20);
    const step = Math.max(1, Math.floor(tris.length / 4000));
    const positions: number[] = [];
    const colors: number[] = [];
    const eps = 1e-3;
    const min = opts.wallThicknessMin, safe = opts.wallThicknessSafe;
    for (let i = 0; i < tris.length; i += step) {
      const t = tris[i];
      const origin = t.center.clone().addScaledVector(t.normal, -eps);
      raycaster.set(origin, t.normal.clone().negate());
      const hits = raycaster.intersectObjects(meshList, false);
      let d = Infinity;
      for (const h of hits) {
        if (h.distance > eps * 4) { d = h.distance; break; }
      }
      if (!isFinite(d)) continue;
      if (d < report.minWallThickness) report.minWallThickness = d;
      let r = 0, gCol = 0, b = 0;
      if (d < min) { r = 1; gCol = 0.15; b = 0.15; report.thinTriangles += 1; }
      else if (d < safe) { r = 1; gCol = 0.75; b = 0.1; report.warningTriangles += 1; }
      else { r = 0.15; gCol = 0.95; b = 0.35; }
      positions.push(t.a.x, t.a.y, t.a.z, t.b.x, t.b.y, t.b.z, t.c.x, t.c.y, t.c.z);
      for (let k = 0; k < 3; k++) colors.push(r, gCol, b);
    }
    if (positions.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      g.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false,
      });
      overlay.add(new THREE.Mesh(g, mat));
    }
  }

  if (!isFinite(report.minWallThickness)) report.minWallThickness = 0;

  // Warnings
  if (report.openEdges > 0)
    report.warnings.push(`${report.openEdges} bordes abiertos (posibles huecos / fugas en la malla).`);
  if (report.nonManifoldEdges > 0)
    report.warnings.push(`${report.nonManifoldEdges} bordes no-manifold (aristas compartidas por >2 caras).`);
  if (opts.showThickness && report.thinTriangles > 0)
    report.warnings.push(`${report.thinTriangles} zonas con pared inferior a ${opts.wallThicknessMin} mm — riesgo de impresión.`);
  if (opts.showThickness && report.minWallThickness > 0 && report.minWallThickness < opts.wallThicknessMin)
    report.warnings.push(`Espesor mínimo detectado: ${report.minWallThickness.toFixed(2)} mm.`);
  if (report.warnings.length === 0)
    report.warnings.push("Sin problemas detectados con la configuración actual.");

  return { overlay, report };
}

export function disposeOverlay(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh | THREE.LineSegments;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geom = (m as any).geometry as THREE.BufferGeometry | undefined;
    geom?.dispose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mat = (m as any).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
