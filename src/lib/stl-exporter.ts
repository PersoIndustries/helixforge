import * as THREE from "three";

// Binary STL exporter. Traverses object and writes all mesh triangles in world space.
export function exportSTLBinary(object: THREE.Object3D): Blob {
  const triangles: { n: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }[] = [];
  const tempA = new THREE.Vector3();
  const tempB = new THREE.Vector3();
  const tempC = new THREE.Vector3();
  const tempN = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  object.updateMatrixWorld(true);

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as THREE.Mesh).isMesh) return;
    const geom = mesh.geometry as THREE.BufferGeometry;
    if (!geom) return;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    if (!pos) return;
    const index = geom.index;
    const matrix = mesh.matrixWorld;
    const process = (ia: number, ib: number, ic: number) => {
      tempA.fromBufferAttribute(pos, ia).applyMatrix4(matrix);
      tempB.fromBufferAttribute(pos, ib).applyMatrix4(matrix);
      tempC.fromBufferAttribute(pos, ic).applyMatrix4(matrix);
      cb.subVectors(tempC, tempB);
      ab.subVectors(tempA, tempB);
      tempN.crossVectors(cb, ab).normalize();
      triangles.push({
        n: tempN.clone(),
        a: tempA.clone(),
        b: tempB.clone(),
        c: tempC.clone(),
      });
    };
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        process(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        process(i, i + 1, i + 2);
      }
    }
  });

  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const dv = new DataView(buffer);
  // 80-byte header (zeroes)
  dv.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const t of triangles) {
    dv.setFloat32(offset, t.n.x, true);
    dv.setFloat32(offset + 4, t.n.y, true);
    dv.setFloat32(offset + 8, t.n.z, true);
    dv.setFloat32(offset + 12, t.a.x, true);
    dv.setFloat32(offset + 16, t.a.y, true);
    dv.setFloat32(offset + 20, t.a.z, true);
    dv.setFloat32(offset + 24, t.b.x, true);
    dv.setFloat32(offset + 28, t.b.y, true);
    dv.setFloat32(offset + 32, t.b.z, true);
    dv.setFloat32(offset + 36, t.c.x, true);
    dv.setFloat32(offset + 40, t.c.y, true);
    dv.setFloat32(offset + 44, t.c.z, true);
    dv.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return new Blob([buffer], { type: "application/octet-stream" });
}

export function exportOBJ(object: THREE.Object3D): Blob {
  const lines: string[] = ["# HelixForge OBJ export"];
  let vOffset = 1;
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    if (!pos) return;
    const matrix = mesh.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      lines.push(`v ${v.x} ${v.y} ${v.z}`);
    }
    const index = geom.index;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        lines.push(
          `f ${index.getX(i) + vOffset} ${index.getX(i + 1) + vOffset} ${index.getX(i + 2) + vOffset}`
        );
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        lines.push(`f ${i + vOffset} ${i + 1 + vOffset} ${i + 2 + vOffset}`);
      }
    }
    vOffset += pos.count;
  });
  return new Blob([lines.join("\n")], { type: "text/plain" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
