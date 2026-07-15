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
  | "threaded-cylinder"
  | "note";

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
  capInteriorHeight?: number; // depth of internal cavity from bottom
  threadStartHeight?: number; // z where internal thread begins (from bottom)
  hasInternalThread?: boolean;
  gripType?: "smooth" | "hex" | "knurled" | "hex-knurled";
  gripHeight?: number;
  knurlIntensity?: number; // 0..1
  toolHoleType?: "none" | "hex" | "slot";
  toolHoleLocation?: "inside" | "outside-top";
  toolHoleSize?: number; // across-flats for hex, length for slot
  toolHoleDepth?: number;
  // Auger
  shaftDiameter?: number;
  flightThickness?: number;
  filletType?: "none" | "circular" | "triangular" | "rounded";
  filletRadius?: number; // radial run along flight face (mm)
  filletHeight?: number; // axial climb up shaft (mm); defaults to filletRadius
  // Cylinder / hollow
  hollow?: boolean;
  // Note (fictitious, no geometry)
  noteText?: string;
  noteColor?: string;
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
    outerDiameter: 30,
    innerDiameter: 20,
    pitch: 2.5,
    wireThickness: 1.2,
    flightWidth: 1.2,
    length: 18,
    turns: 4.8,
    starts: 1,
    handed: "right",
    resolution: 64,
    wallThickness: 2,
    hasHexGrip: true,
    threadForm: "metric",
    capInteriorHeight: 14,
    threadStartHeight: 1.5,
    hasInternalThread: true,
    gripType: "hex-knurled",
    gripHeight: 12,
    knurlIntensity: 0.5,
    toolHoleType: "none",
    toolHoleLocation: "inside",
    toolHoleSize: 4,
    toolHoleDepth: 3,
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
  note: {
    outerDiameter: 0,
    innerDiameter: 0,
    pitch: 1,
    wireThickness: 0,
    flightWidth: 0,
    length: 0,
    turns: 0,
    starts: 1,
    handed: "right",
    resolution: 8,
    noteText: "",
    noteColor: "#facc15",
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
  boreRadius: number,
  threadDepthOverride?: number,
  threadWidthOverride?: number
): THREE.Group {
  const group = new THREE.Group();
  // Thread depth is independent of the wall thickness (outer-inner).
  // Prefer explicit override; fall back to wireThickness; finally to a
  // sensible default derived from the pitch (ISO-metric ~ 0.54 * pitch).
  const fallbackDepth = p.wireThickness && p.wireThickness > 0 ? p.wireThickness : p.pitch * 0.54;
  const rawDepth =
    threadDepthOverride && threadDepthOverride > 0 ? threadDepthOverride : fallbackDepth;
  // Clamp so the thread crest doesn't reach the axis.
  const threadDepth = Math.max(0.05, Math.min(rawDepth, boreRadius * 0.85));

  // Axial flight width is independent of inner/outer diameter — driven only
  // by the metric parameters (pitch + explicit flight width).
  const rawWidth =
    threadWidthOverride && threadWidthOverride > 0 ? threadWidthOverride : p.pitch * 0.5;
  const threadWidth = Math.max(0.05, Math.min(rawWidth, p.pitch * 0.95));

  // Sweep pointing inward: profile center sits just outside the bore wall.
  const placementRadius = boreRadius - threadDepth / 2;
  const profile =
    p.threadForm === "acme"
      ? trapezoidThreadProfile(threadDepth, threadWidth)
      : triangleThreadProfile(threadDepth, threadWidth);
  // Flip x so the thread crest points inward (toward the axis).
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
  // Internal thread — for a threaded cylinder, default depth to the wall
  // thickness (legacy behavior) unless the user set wireThickness explicitly.
  const cylDepth =
    p.wireThickness && p.wireThickness > 0
      ? p.wireThickness
      : (p.outerDiameter - p.innerDiameter) / 2;
  group.add(buildInternalThread(p, material, height, 0, boreR, cylDepth));
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
  const filletType = p.filletType ?? "none";
  const filletR = Math.max(0, p.filletRadius ?? 0);
  const filletH = Math.max(0, p.filletHeight ?? filletR);
  // Clamp radius to a reasonable share of the flight (max 50% of width or 4× thickness)
  const maxR = Math.min(flightW * 0.9, flightT * 4);
  const rw = Math.min(filletR, maxR);
  const rh = Math.min(filletH, flightT * 4);
  const filletSeg = Math.max(6, Math.min(20, Math.floor(p.resolution / 4)));

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

    if (filletType !== "none" && rw > 0 && rh > 0) {
      for (const side of ["top", "bottom"] as const) {
        const fProfile = filletProfile({
          radiusRadial: rw,
          radiusAxial: rh,
          thickness: flightT,
          side,
          kind: filletType,
          segments: filletSeg,
        });
        const fGeom = sweepProfileAlongHelix({
          profile: fProfile,
          radius: shaftR,
          pitch: p.pitch * p.starts,
          turns: turns / p.starts,
          segmentsPerTurn: p.resolution,
          handed: handedSign(p.handed),
        });
        const fMesh = new THREE.Mesh(fGeom, material);
        fMesh.rotation.z = (s / p.starts) * Math.PI * 2;
        group.add(fMesh);
      }
    }
  }
  return group;
}

function buildKnurledCylinder(
  radius: number,
  height: number,
  intensity: number,
  material: THREE.Material,
  zBottom: number,
  ridges = 60
): THREE.Mesh {
  const segments = Math.max(96, ridges * 2);
  const geom = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const bump = 0.15 + Math.max(0, Math.min(1, intensity)) * 0.7; // mm
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const r = Math.sqrt(x * x + z * z);
    const mod = 0.5 + 0.5 * Math.cos(ang * ridges); // 0..1 ridged
    const nr = r + mod * bump;
    pos.setX(i, Math.cos(ang) * nr);
    pos.setZ(i, Math.sin(ang) * nr);
  }
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = zBottom + height / 2;
  return mesh;
}

function buildThreadedCap(p: PartParams, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const totalH = p.length;
  const outerR = p.outerDiameter / 2;
  const boreR = Math.max(0.5, Math.min(p.innerDiameter / 2, outerR - 0.4));
  const wall = Math.max(0.3, outerR - boreR);
  const requestedInterior = Math.min(
    p.capInteriorHeight ?? totalH - (p.wallThickness ?? wall),
    totalH - 0.5
  );
  const toolHoleType = p.toolHoleType ?? "none";
  const toolHoleLocation = p.toolHoleLocation ?? "inside";
  const toolHoleSize = Math.max(0.5, p.toolHoleSize ?? 4);
  const requestedDepth = Math.max(0, Math.min(p.toolHoleDepth ?? 3, totalH - 0.5));
  // Ensure the top wall is thick enough to host the tool hole; reduce cavity if needed.
  const minTopForHole =
    toolHoleType !== "none" && requestedDepth > 0 ? requestedDepth + 0.4 : 0;
  const maxInteriorForHole = Math.max(0.5, totalH - minTopForHole);
  const interiorH = Math.max(0.5, Math.min(requestedInterior, maxInteriorForHole));
  const topThickness = totalH - interiorH;
  const threadStart = Math.max(0, Math.min(p.threadStartHeight ?? 0, interiorH - 0.5));
  const threadLen = Math.max(0, interiorH - threadStart);
  const hasThread = p.hasInternalThread ?? true;
  const gripType = p.gripType ?? (p.hasHexGrip ? "hex" : "smooth");
  const gripHeight = Math.min(Math.max(0, p.gripHeight ?? totalH), totalH);
  const knurl = p.knurlIntensity ?? 0.5;
  const maxToolDepth = Math.max(0, topThickness - 0.4);
  const toolHoleDepth = Math.max(0, Math.min(requestedDepth, maxToolDepth));


  // Use DoubleSide clone so cavity walls render correctly from inside/outside.
  const base = material as THREE.MeshStandardMaterial;
  const shellMat = base.clone();
  shellMat.side = THREE.DoubleSide;

  const smoothTopH = Math.max(0, totalH - gripHeight);
  const hasHex = gripType === "hex" || gripType === "hex-knurled";
  // Smooth top above grip: only stays hex when the *entire* grip is pure hex.
  // For hex-knurled, the top of the grip is knurled → round smooth top instead.
  const smoothTopIsHex = gripType === "hex";
  const topDiscShape = smoothTopH > 0 ? (smoothTopIsHex ? 6 : 64) : hasHex ? 6 : 64;
  // Bottom rim matches the bottom of the grip.
  const gripBottomShape = hasHex ? 6 : 64;

  // --- Grip region (bottom) ---
  if (gripType === "hex-knurled" && gripHeight > 0) {
    const hexH = gripHeight * 0.55;
    const knurlH = gripHeight - hexH;
    const hex = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR, outerR, hexH, 6, 1, true),
      shellMat
    );
    hex.rotation.x = Math.PI / 2;
    hex.position.z = hexH / 2;
    group.add(hex);
    if (knurlH > 0) group.add(buildKnurledCylinder(outerR, knurlH, knurl, shellMat, hexH));
    // Cap the top of the hex (facing up) around the knurled column so the
    // hex→knurled seam has a proper annular closure.
    const seam = new THREE.Mesh(
      new THREE.RingGeometry(outerR - 0.001, outerR, 6),
      shellMat
    );
    seam.position.z = hexH;
    group.add(seam);
  } else if (gripType === "hex" && gripHeight > 0) {
    const hex = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR, outerR, gripHeight, 6, 1, true),
      shellMat
    );
    hex.rotation.x = Math.PI / 2;
    hex.position.z = gripHeight / 2;
    group.add(hex);
  } else if (gripType === "knurled" && gripHeight > 0) {
    group.add(buildKnurledCylinder(outerR, gripHeight, knurl, shellMat, 0));
  } else if (gripHeight > 0) {
    const cy = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR, outerR, gripHeight, 64, 1, true),
      shellMat
    );
    cy.rotation.x = Math.PI / 2;
    cy.position.z = gripHeight / 2;
    group.add(cy);
  }

  // --- Smooth top region above grip ---
  if (smoothTopH > 0) {
    const cy = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR, outerR, smoothTopH, smoothTopIsHex ? 6 : 64, 1, true),
      shellMat
    );
    cy.rotation.x = Math.PI / 2;
    cy.position.z = gripHeight + smoothTopH / 2;
    group.add(cy);
    // Transition annulus where the two profiles meet (hex-grip → round-top only).
    if (hasHex && !smoothTopIsHex) {
      const seam = new THREE.Mesh(
        new THREE.RingGeometry(outerR - 0.001, outerR, 64),
        shellMat
      );
      seam.position.z = gripHeight;
      group.add(seam);
    }
  }

  // --- Top disc / annulus (closed end, with optional outside tool hole) ---
  const outsideHex =
    toolHoleType === "hex" && toolHoleLocation === "outside-top" && toolHoleDepth > 0;
  const outsideSlot =
    toolHoleType === "slot" && toolHoleLocation === "outside-top" && toolHoleDepth > 0;
  const outsideHoleR = outsideHex ? Math.min(toolHoleSize / 2, outerR - 0.6) : 0;
  if (outsideHex && outsideHoleR > 0) {
    const topRing = new THREE.Mesh(
      new THREE.RingGeometry(outsideHoleR, outerR, topDiscShape),
      shellMat
    );
    topRing.position.z = totalH;
    group.add(topRing);
    // Hex pocket wall going down from top surface
    const hWall = new THREE.Mesh(
      new THREE.CylinderGeometry(outsideHoleR, outsideHoleR, toolHoleDepth, 6, 1, true),
      shellMat
    );
    hWall.rotation.x = Math.PI / 2;
    hWall.position.z = totalH - toolHoleDepth / 2;
    group.add(hWall);
    const hFloor = new THREE.Mesh(new THREE.CircleGeometry(outsideHoleR, 6), shellMat);
    hFloor.position.z = totalH - toolHoleDepth;
    group.add(hFloor);
  } else {
    const top = new THREE.Mesh(new THREE.CircleGeometry(outerR, topDiscShape), shellMat);
    top.position.z = totalH;
    group.add(top);
    if (outsideSlot) {
      const slotL = Math.min(toolHoleSize, outerR * 1.6);
      const slotW = Math.max(0.5, toolHoleSize * 0.22);
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(slotL, slotW, toolHoleDepth),
        new THREE.MeshStandardMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.95 })
      );
      slot.position.z = totalH - toolHoleDepth / 2;
      group.add(slot);
    }
  }

  // --- Bottom rim annulus (visible opening) ---
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(boreR, outerR, gripBottomShape),
    shellMat
  );
  rim.rotation.x = Math.PI; // face -Z
  rim.position.z = 0;
  group.add(rim);

  // --- Inner cavity wall (open-ended, DoubleSide) ---
  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(boreR, boreR, interiorH, 64, 1, true),
    shellMat
  );
  bore.rotation.x = Math.PI / 2;
  bore.position.z = interiorH / 2;
  group.add(bore);

  // --- Cavity ceiling annulus (inside top of cavity, facing down) ---
  const insideHoleR =
    toolHoleType === "hex" && toolHoleLocation === "inside"
      ? Math.min(toolHoleSize / 2, boreR - 0.5)
      : 0;
  const ceilingInner = Math.max(0.01, insideHoleR);
  const ceiling = new THREE.Mesh(
    new THREE.RingGeometry(ceilingInner, boreR, 64),
    shellMat
  );
  ceiling.rotation.x = Math.PI; // face -Z (into cavity)
  ceiling.position.z = interiorH;
  group.add(ceiling);

  // --- Inside tool hole (blind indent from cavity ceiling toward top) ---
  if (toolHoleLocation === "inside" && toolHoleType === "hex" && insideHoleR > 0 && toolHoleDepth > 0) {
    const hWall = new THREE.Mesh(
      new THREE.CylinderGeometry(insideHoleR, insideHoleR, toolHoleDepth, 6, 1, true),
      shellMat
    );
    hWall.rotation.x = Math.PI / 2;
    hWall.position.z = interiorH + toolHoleDepth / 2;
    group.add(hWall);
    const hCap = new THREE.Mesh(new THREE.CircleGeometry(insideHoleR, 6), shellMat);
    hCap.rotation.x = Math.PI;
    hCap.position.z = interiorH + toolHoleDepth;
    group.add(hCap);
  } else if (toolHoleLocation === "inside" && toolHoleType === "slot" && toolHoleDepth > 0) {
    const slotL = Math.min(toolHoleSize, boreR * 1.6);
    const slotW = Math.max(0.5, toolHoleSize * 0.22);
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(slotL, slotW, toolHoleDepth),
      new THREE.MeshStandardMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.95 })
    );
    slot.position.z = interiorH + toolHoleDepth / 2;
    group.add(slot);
  }

  // --- Internal thread on cavity wall ---
  if (hasThread && threadLen > 0) {
    group.add(buildInternalThread(p, material, threadLen, threadStart, boreR, p.wireThickness, p.flightWidth));
  }
  

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
    case "note": {
      const g = new THREE.Group();
      g.name = "Note";
      return g;
    }
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
  { id: "cap-m20", name: "Tapa M20", type: "threaded-cap", params: { outerDiameter: 28, innerDiameter: 20, pitch: 2.5, length: 16, capInteriorHeight: 12, threadStartHeight: 1.5, gripType: "hex-knurled", gripHeight: 10, hasInternalThread: true } },
];
