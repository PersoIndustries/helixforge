import * as THREE from "three";

/* Utility: sweep a 2D polygon profile along a helical path to produce a mesh geometry.
   profile: array of {x,y} points in the cross-section plane (x = radial offset from center path, y = axial offset).
   The profile is placed at each step around the helix and connected into a tube-like mesh. */
export function sweepProfileAlongHelix(opts: {
  profile: { x: number; y: number }[];
  radius: number; // helix mean radius
  pitch: number; // axial rise per turn
  turns: number;
  segmentsPerTurn: number;
  handed?: 1 | -1; // 1 = right, -1 = left
  closedProfile?: boolean;
}): THREE.BufferGeometry {
  const {
    profile,
    radius,
    pitch,
    turns,
    segmentsPerTurn,
    handed = 1,
    closedProfile = true,
  } = opts;

  const totalSteps = Math.max(2, Math.floor(segmentsPerTurn * turns));
  const pN = profile.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= totalSteps; i++) {
    const t = i / segmentsPerTurn; // in turns
    const theta = handed * t * Math.PI * 2;
    const z = t * pitch;

    // Tangent along helix
    const dTheta_dt = handed * Math.PI * 2;
    const dz_dt = pitch;
    const tangent = new THREE.Vector3(
      -Math.sin(theta) * radius * dTheta_dt,
      Math.cos(theta) * radius * dTheta_dt,
      dz_dt
    ).normalize();

    // Radial direction (outward from axis)
    const radial = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0);
    // Axial direction
    const axial = new THREE.Vector3(0, 0, 1);
    // The profile plane is (radial, axial). Correct: profile.x -> radial (outward), profile.y -> axial.
    // But to make the ribbon perpendicular to tangent for cleaner sweep, we build a frame:
    // binormal = tangent x radial (perpendicular). Keep simple: use radial/axial frame (works for typical threads).

    const center = new THREE.Vector3(
      Math.cos(theta) * radius,
      Math.sin(theta) * radius,
      z
    );

    for (let k = 0; k < pN; k++) {
      const p = profile[k];
      const px = center.x + radial.x * p.x + axial.x * p.y;
      const py = center.y + radial.y * p.x + axial.y * p.y;
      const pz = center.z + radial.z * p.x + axial.z * p.y;
      positions.push(px, py, pz);
      // temp normal (recomputed later)
      normals.push(radial.x, radial.y, radial.z);
    }
    // suppress unused warning
    void tangent;
  }

  // Build side quads
  for (let i = 0; i < totalSteps; i++) {
    const a0 = i * pN;
    const a1 = (i + 1) * pN;
    for (let k = 0; k < pN; k++) {
      const kn = (k + 1) % pN;
      if (!closedProfile && kn === 0) continue;
      const i0 = a0 + k;
      const i1 = a0 + kn;
      const i2 = a1 + kn;
      const i3 = a1 + k;
      indices.push(i0, i1, i2, i0, i2, i3);
    }
  }

  // End caps (triangulate as fan around centroid)
  if (closedProfile) {
    const startCentroid = { x: 0, y: 0 };
    profile.forEach((p) => {
      startCentroid.x += p.x;
      startCentroid.y += p.y;
    });
    startCentroid.x /= pN;
    startCentroid.y /= pN;

    const addCap = (stepIndex: number, flip: boolean) => {
      const theta = handed * (stepIndex / segmentsPerTurn) * Math.PI * 2;
      const z = (stepIndex / segmentsPerTurn) * pitch;
      const radial = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0);
      const center = new THREE.Vector3(
        Math.cos(theta) * radius,
        Math.sin(theta) * radius,
        z
      );
      const cx = center.x + radial.x * startCentroid.x;
      const cy = center.y + radial.y * startCentroid.x;
      const cz = center.z + startCentroid.y;
      const centroidIdx = positions.length / 3;
      positions.push(cx, cy, cz);
      normals.push(0, 0, flip ? -1 : 1);
      const base = stepIndex * pN;
      for (let k = 0; k < pN; k++) {
        const kn = (k + 1) % pN;
        if (flip) indices.push(centroidIdx, base + kn, base + k);
        else indices.push(centroidIdx, base + k, base + kn);
      }
    };
    addCap(0, true);
    addCap(totalSteps, false);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/* ------------ Profile builders ------------ */

// Circular wire profile (for springs)
export function circleProfile(radius: number, segments = 16) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

// Triangular thread profile (metric-ish). Centered radially at 0.
// height = radial depth of thread, pitch = axial pitch
export function triangleThreadProfile(height: number, pitch: number) {
  const h = height;
  const p = pitch;
  return [
    { x: -h / 2, y: -p / 2 },
    { x: h / 2, y: 0 },
    { x: -h / 2, y: p / 2 },
  ];
}

// Trapezoidal (ACME-like) profile
export function trapezoidThreadProfile(height: number, pitch: number) {
  const h = height;
  const p = pitch;
  return [
    { x: -h / 2, y: -p / 2 },
    { x: h / 2, y: -p / 4 },
    { x: h / 2, y: p / 4 },
    { x: -h / 2, y: p / 2 },
  ];
}

// Rectangular flight profile (for augers / worms)
export function flightProfile(width: number, thickness: number) {
  const w = width;
  const t = thickness;
  return [
    { x: 0, y: -t / 2 },
    { x: w, y: -t / 2 },
    { x: w, y: t / 2 },
    { x: 0, y: t / 2 },
  ];
}
