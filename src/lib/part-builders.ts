import * as THREE from "three";
import {
  sweepProfileAlongHelix,
  circleProfile,
  triangleThreadProfile,
  trapezoidThreadProfile,
  flightProfile,
  filletProfile,
} from "./geometry";

export type PartType =
  | "compression-spring"
  | "torsion-spring"
  | "screw"
  | "nut"
  | "auger"
  | "threaded-cap"
  | "threaded-cylinder";

export interface PartParams {
  // Common
  outerDiameter: number;
  innerDiameter: number;
  pitch: number;
  wireThickness: number;
  flightWidth: number;
  length: number;
  turns: number;
  starts: number;
  handed: "right" | "left";
  resolution: number; // segments per turn
  // Spring
  springEnds?: "open" | "closed" | "closed-ground";
  // Screw
  headType?: "hex" | "socket" | "button";
  headHeight?: number;
  headDiameter?: number;
  threadLength?: number;
  // Nut
  nutHeight?: number;
  nutShape?: "hex" | "square";
  // Cap
  wallThickness?: number;
  hasHexGrip?: boolean;
  threadForm?: "metric" | "acme";
  // Auger
  shaftDiameter?: number;
  flightThickness?: number;
  filletType?: "none" | "circular" | "triangular" | "rounded";
  filletRadius?: number; // radial run along flight face (mm)
  filletHeight?: number; // axial climb up shaft (mm); defaults to filletRadius
  // Cylinder / hollow
  hollow?: boolean;
}

export const DEFAULT_PARAMS: Record<PartType, PartParams> = {
  "compression-spring": {
    outerDiameter: 20,
    innerDiameter: 16,
    pitch: 5,
    wireThickness: 2,
    flightWidth: 2,
    length: 40,
    turns: 8,
    starts: 1,
    handed: "right",
    resolution: 48,
    springEnds: "closed-ground",
  },
  "torsion-spring": {
    outerDiameter: 18,
    innerDiameter: 14,
    pitch: 2.5,
    wireThickness: 2,
    flightWidth: 2,
    length: 20,
    turns: 8,
    starts: 1,
    handed: "right",
    resolution: 48,
    springEnds: "open",
  },
  screw: {
    outerDiameter: 8,
    innerDiameter: 6.6,
    pitch: 1.25,
    wireThickness: 0.7,
    flightWidth: 0.7,
    length: 30,
    turns: 24,
    starts: 1,
    handed: "right",
    resolution: 48,
    headType: "hex",
    headHeight: 5.3,
    headDiameter: 13,
    threadLength: 20,
    threadForm: "metric",
  },
  nut: {
    outerDiameter: 8,
    innerDiameter: 6.6,
    pitch: 1.25,
    wireThickness: 0.7,
    flightWidth: 0.7,
    length: 6.5,
    turns: 5.2,
    starts: 1,
    handed: "right",
    resolution: 48,
    nutHeight: 6.5,
    nutShape: "hex",
    headDiameter: 13,
    threadForm: "metric",
  },
  auger: {
    outerDiameter: 40,
    innerDiameter: 10,
    pitch: 20,
    wireThickness: 2,
    flightWidth: 15,
    length: 120,
    turns: 6,
    starts: 1,
    handed: "right",
    resolution: 64,
    shaftDiameter: 10,
    flightThickness: 2,
    filletType: "circular",
    filletRadius: 3,
    filletHeight: 3,
  },
  "threaded-cap": {
    outerDiameter: 24,
    innerDiameter: 20,
    pitch: 2.5,
    wireThickness: 1.2,
    flightWidth: 1.2,
    length: 12,
    turns: 4.8,
    starts: 1,
    handed: "right",
    resolution: 48,
    wallThickness: 2,
    hasHexGrip: true,
    threadForm: "metric",
  },
  "threaded-cylinder": {
    outerDiameter: 20,
    innerDiameter: 14,
    pitch: 2.5,
    wireThickness: 1.2,
    flightWidth: 1.2,
    length: 40,
    turns: 16,
    starts: 1,
    handed: "right",
    resolution: 48,
    hollow: true,
    threadForm: "metric",
  },
};

/* Materials */
export function makeMaterial(preset: "steel" | "aluminum" | "brass" | "wire" = "steel") {
  const configs = {
    steel: { color: 0xb0b8c0, metalness: 0.9, roughness: 0.35 },
    aluminum: { color: 0xd0d3d6, metalness: 0.85, roughness: 0.45 },
    brass: { color: 0xd4a24a, metalness: 0.9, roughness: 0.3 },
    wire: { color: 0xa8b3bd, metalness: 0.85, roughness: 0.4 },
  } as const;
  const c = configs[preset];
  return new THREE.MeshStandardMaterial({
    color: c.color,
    metalness: c.metalness,
    roughness: c.roughness,
    envMapIntensity: 1.2,
  });
}

/* --------- Builders --------- */

function handedSign(h: "right" | "left"): 1 | -1 {
  return h === "right" ? 1 : -1;
}

function buildSpring(p: PartParams, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const meanRadius = (p.outerDiameter - p.wireThickness) / 2;
  const wireR = p.wireThickness / 2;
  const turns = Math.max(0.5, p.length / Math.max(0.1, p.pitch));
  const geom = sweepProfileAlongHelix({
    profile: circleProfile(wireR, Math.max(8, Math.min(24, Math.floor(p.resolution / 3)))),
    radius: meanRadius,
    pitch: p.pitch,
    turns,
    segmentsPerTurn: p.resolution,
    handed: handedSign(p.handed),
  });
  const mesh = new THREE.Mesh(geom, material);
  group.add(mesh);
  // Center vertically
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.position.z = -center.z;
  return group;
}

function buildThreadedShaft(
  p: PartParams,
  material: THREE.Material,
  length: number,
  startZ: number
): THREE.Group {
  const group = new THREE.Group();
  // Core cylinder (root diameter)
  const rootR = Math.max(p.innerDiameter / 2, p.outerDiameter / 2 - p.wireThickness * 0.9);
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(rootR, rootR, length, Math.max(24, p.resolution)),
    material
  );
  core.rotation.x = Math.PI / 2;
  core.position.z = startZ + length / 2;
  group.add(core);

  const threadDepth = (p.outerDiameter - p.innerDiameter) / 2;
  const meanRadius = (p.outerDiameter + p.innerDiameter) / 4 + rootR - (p.outerDiameter + p.innerDiameter) / 4;
  // simpler: place profile so its center is at rootR + threadDepth/2
  const placementRadius = rootR + threadDepth / 2;
  void meanRadius;

  const profile =
    p.threadForm === "acme"
      ? trapezoidThreadProfile(threadDepth, p.pitch * 0.9)
      : triangleThreadProfile(threadDepth, p.pitch * 0.9);
  const turns = length / p.pitch;
  for (let s = 0; s < p.starts; s++) {
    const geom = sweepProfileAlongHelix({
      profile,
      radius: placementRadius,
      pitch: p.pitch * p.starts,
      turns: turns / p.starts,
      segmentsPerTurn: p.resolution,
      handed: handedSign(p.handed),
    });
    const mesh = new THREE.Mesh(geom, material);
    mesh.rotation.z = (s / p.starts) * Math.PI * 2;
    mesh.position.z = startZ;
    group.add(mesh);
  }
  return group;
}

function buildInternalThread(
  p: PartParams,
  material: THREE.Material,
  length: number,
  startZ: number,
  boreRadius: number
): THREE.Group {
  const group = new THREE.Group();
  const threadDepth = (p.outerDiameter - p.innerDiameter) / 2;
  // For internal thread, we sweep pointing inward
  const placementRadius = boreRadius - threadDepth / 2;
  const profile =
    p.threadForm === "acme"
      ? trapezoidThreadProfile(threadDepth, p.pitch * 0.9)
      : triangleThreadProfile(threadDepth, p.pitch * 0.9);
  // Flip x to point inward
  const inwardProfile = profile.map((pt) => ({ x: -pt.x, y: pt.y }));
  const turns = length / p.pitch;
  for (let s = 0; s < p.starts; s++) {
    const geom = sweepProfileAlongHelix({
      profile: inwardProfile,
      radius: placementRadius,
      pitch: p.pitch * p.starts,
      turns: turns / p.starts,
      segmentsPerTurn: p.resolution,
      handed: handedSign(p.handed),
    });
    const mesh = new THREE.Mesh(geom, material);
    mesh.rotation.z = (s / p.starts) * Math.PI * 2;
    mesh.position.z = startZ;
    group.add(mesh);
  }
  return group;
}

function buildScrewHead(p: PartParams, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const hType = p.headType ?? "hex";
  const hHeight = p.headHeight ?? p.outerDiameter * 0.7;
  const hDiameter = p.headDiameter ?? p.outerDiameter * 1.6;
  let head: THREE.Mesh;
  if (hType === "hex") {
    head = new THREE.Mesh(
      new THREE.CylinderGeometry(hDiameter / 2, hDiameter / 2, hHeight, 6),
      material
    );
  } else if (hType === "socket") {
    head = new THREE.Mesh(
      new THREE.CylinderGeometry(hDiameter / 2, hDiameter / 2, hHeight, 40),
      material
    );
  } else {
    head = new THREE.Mesh(new THREE.SphereGeometry(hDiameter / 2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), material);
  }
  head.rotation.x = Math.PI / 2;
  head.position.z = -hHeight / 2;
  group.add(head);
  return group;
}

function buildScrew(p: PartParams, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const threadL = Math.min(p.threadLength ?? p.length, p.length);
  const smoothL = Math.max(0, p.length - threadL);
  // Smooth shank
  if (smoothL > 0) {
    const rootR = p.outerDiameter / 2;
    const shank = new THREE.Mesh(
      new THREE.CylinderGeometry(rootR, rootR, smoothL, 40),
      material
    );
    shank.rotation.x = Math.PI / 2;
    shank.position.z = smoothL / 2;
    group.add(shank);
  }
  group.add(buildThreadedShaft(p, material, threadL, smoothL));
  group.add(buildScrewHead(p, material));
  return group;
}

function buildNut(p: PartParams, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const height = p.nutHeight ?? p.outerDiameter * 0.8;
  const across = p.headDiameter ?? p.outerDiameter * 1.6;
  const boreR = p.outerDiameter / 2;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(across / 2, across / 2, height, p.nutShape === "square" ? 4 : 6),
    material
  );
  body.rotation.x = Math.PI / 2;
  body.position.z = height / 2;
  group.add(body);
  // Bore (visual: place a slightly darker cylinder — we can't boolean cleanly, so use a hole cylinder as a matte hole cue)
  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(boreR, boreR, height + 0.1, 48, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x0b0f14,
      side: THREE.DoubleSide,
      metalness: 0.2,
      roughness: 0.9,
    })
  );
  bore.rotation.x = Math.PI / 2;
  bore.position.z = height / 2;
  group.add(bore);
  // Internal thread
  group.add(buildInternalThread(p, material, height, 0, boreR));
  return group;
}

function buildAuger(p: PartParams, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const shaftR = (p.shaftDiameter ?? p.innerDiameter) / 2;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(shaftR, shaftR, p.length, 40),
    material
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = p.length / 2;
  group.add(shaft);
  const turns = p.length / p.pitch;
  const flightW = p.flightWidth;
  const flightT = p.flightThickness ?? 2;
  const profile = flightProfile(flightW, flightT);
  for (let s = 0; s < p.starts; s++) {
    const geom = sweepProfileAlongHelix({
      profile,
      radius: shaftR,
      pitch: p.pitch * p.starts,
      turns: turns / p.starts,
      segmentsPerTurn: p.resolution,
      handed: handedSign(p.handed),
    });
    const mesh = new THREE.Mesh(geom, material);
    mesh.rotation.z = (s / p.starts) * Math.PI * 2;
    group.add(mesh);
  }
  return group;
}

function buildThreadedCap(p: PartParams, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const height = p.length;
  const wall = p.wallThickness ?? 2;
  const outerR = p.outerDiameter / 2 + wall;
  const shape = p.hasHexGrip ? 6 : 40;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(outerR, outerR, height, shape),
    material
  );
  body.rotation.x = Math.PI / 2;
  body.position.z = height / 2;
  group.add(body);
  // Bore (visual)
  const boreR = p.outerDiameter / 2;
  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(boreR, boreR, height, 48, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x0b0f14,
      side: THREE.DoubleSide,
      metalness: 0.2,
      roughness: 0.9,
    })
  );
  bore.rotation.x = Math.PI / 2;
  bore.position.z = height / 2 + wall / 2;
  group.add(bore);
  // Top cap disc
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(outerR, outerR, wall, shape),
    material
  );
  disc.rotation.x = Math.PI / 2;
  disc.position.z = height - wall / 2;
  group.add(disc);
  // Internal thread
  group.add(buildInternalThread(p, material, height - wall, 0, boreR));
  return group;
}

function buildThreadedCylinder(p: PartParams, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const outerR = p.outerDiameter / 2;
  const innerR = p.hollow ? Math.min(p.innerDiameter / 2, outerR - 0.6) : 0;
  if (innerR > 0) {
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR - 0.4, outerR - 0.4, p.length, 48, 1, false),
      material
    );
    tube.rotation.x = Math.PI / 2;
    tube.position.z = p.length / 2;
    group.add(tube);
    const bore = new THREE.Mesh(
      new THREE.CylinderGeometry(innerR, innerR, p.length + 0.1, 48, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x0b0f14,
        side: THREE.DoubleSide,
        metalness: 0.2,
        roughness: 0.9,
      })
    );
    bore.rotation.x = Math.PI / 2;
    bore.position.z = p.length / 2;
    group.add(bore);
  } else {
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR - 0.4, outerR - 0.4, p.length, 48),
      material
    );
    core.rotation.x = Math.PI / 2;
    core.position.z = p.length / 2;
    group.add(core);
  }
  // External thread
  group.add(buildThreadedShaft(p, material, p.length, 0));
  return group;
}

export function buildPart(type: PartType, params: PartParams, material: THREE.Material): THREE.Group {
  switch (type) {
    case "compression-spring":
    case "torsion-spring":
      return buildSpring(params, material);
    case "screw":
      return buildScrew(params, material);
    case "nut":
      return buildNut(params, material);
    case "auger":
      return buildAuger(params, material);
    case "threaded-cap":
      return buildThreadedCap(params, material);
    case "threaded-cylinder":
      return buildThreadedCylinder(params, material);
  }
}

/* Presets */
export interface Preset {
  id: string;
  name: string;
  type: PartType;
  params: Partial<PartParams>;
}

export const PRESETS: Preset[] = [
  { id: "spring-std", name: "Muelle estándar 20×40", type: "compression-spring", params: {} },
  { id: "m8-125", name: "Tornillo M8×1.25", type: "screw", params: { outerDiameter: 8, pitch: 1.25, length: 30 } },
  { id: "m10-150", name: "Tornillo M10×1.5", type: "screw", params: { outerDiameter: 10, innerDiameter: 8.3, pitch: 1.5, length: 40, headDiameter: 17, headHeight: 6.4 } },
  { id: "din934-m8", name: "Tuerca DIN 934 M8", type: "nut", params: { outerDiameter: 8, innerDiameter: 6.6, pitch: 1.25, nutHeight: 6.5, headDiameter: 13 } },
  { id: "auger-20", name: "Sinfín 20 mm", type: "auger", params: { outerDiameter: 20, shaftDiameter: 6, pitch: 15, length: 80, flightWidth: 7 } },
  { id: "cap-m20", name: "Tapa M20", type: "threaded-cap", params: { outerDiameter: 20, innerDiameter: 17, pitch: 2.5, length: 12, hasHexGrip: true } },
];
