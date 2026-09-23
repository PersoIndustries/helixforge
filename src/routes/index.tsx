import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  Cog, Bolt, Nut, Package, Cylinder, Waves, Download, RotateCw,
  Grid3x3, Ruler, Scissors, Play, Sparkles, History, Layers,
  Plus, Eye, EyeOff, Copy, Trash2, Focus, GripVertical, Pencil, Check, X,
  ChevronDown, ChevronRight, Upload, FileJson, StickyNote,
  ClipboardCopy, ClipboardPaste, Stethoscope, AlertTriangle, Cone, Link2,
  RectangleVertical, RectangleHorizontal, Box, Scan, Frame, CircleDashed, Palette, Triangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toaster, toast } from "sonner";
import { Viewer3D, type ViewerHandle, type MaterialPreset, type ViewMode, type PartRenderInput } from "@/components/Viewer3D";
import { NumberControl } from "@/components/NumberControl";
import {
  buildPart, DEFAULT_PARAMS, PRESETS,
  type PartParams, type PartType,
} from "@/lib/part-builders";
import { exportSTLBinary, exportOBJ, downloadBlob } from "@/lib/stl-exporter";
import { analyzeGroup, type DiagnosticOptions, type DiagnosticReport } from "@/lib/mesh-diagnostics";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HelixForge — Ensamblajes STL 3D paramétricos" },
      {
        name: "description",
        content: "Diseña ensamblajes 3D paramétricos con múltiples piezas mecánicas: tornillos sinfín, tapas, muelles, roscas. Exporta cada pieza o el conjunto en STL.",
      },
      { property: "og:title", content: "HelixForge — Modelador multipieza paramétrico" },
      { property: "og:description", content: "Diseña ensamblajes helicoidales y expórtalos como STL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HelixForge,
});

const PART_TYPES: { type: PartType; label: string; short: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "compression-spring", label: "Muelle compresión", short: "Compresión", Icon: Waves },
  { type: "torsion-spring", label: "Muelle torsión", short: "Torsión", Icon: RotateCw },
  { type: "screw", label: "Tornillo / Bulón", short: "Tornillo", Icon: Bolt },
  { type: "nut", label: "Tuerca", short: "Tuerca", Icon: Nut },
  { type: "auger", label: "Sinfín de transporte", short: "Sinfín", Icon: Cog },
  { type: "threaded-cap", label: "Tapa roscada", short: "Tapa", Icon: Package },
  { type: "threaded-cylinder", label: "Cilindro roscado", short: "Cilindro", Icon: Cylinder },
  { type: "tube", label: "Tubo / Cono hueco", short: "Tubo", Icon: Cone },
  { type: "clevis", label: "Clevis / orejas de unión", short: "Clevis", Icon: Link2 },
  { type: "note", label: "Nota (anotación)", short: "Nota", Icon: StickyNote },
];

const partMeta = (t: PartType) => PART_TYPES.find((p) => p.type === t)!;

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-2 rounded-md border border-border bg-panel/60 p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary hover:text-primary/80"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <div className="h-1 w-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
        <span className="flex-1 text-left">{title}</span>
      </button>
      {open && <div className="space-y-3 pt-1">{children}</div>}
    </div>
  );
}


interface PartTransform { x: number; y: number; z: number; rx: number; ry: number; rz: number }
interface PartInstance {
  id: string;
  type: PartType;
  name: string;
  params: PartParams;
  visible: boolean;
  transform: PartTransform;
  color?: string | null;
}

interface HistoryEntry { id: string; name: string; at: number }

const PART_COLORS = [
  "#22d3ee", "#4ade80", "#facc15", "#f97316", "#f472b6",
  "#a78bfa", "#60a5fa", "#fb7185", "#34d399", "#e2e8f0",
];

const DEFAULT_TRANSFORM = (): PartTransform => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });


function HelixForge() {
  const [parts, setParts] = useState<PartInstance[]>(() => [
    {
      id: crypto.randomUUID(),
      type: "auger",
      name: "Sinfín 1",
      params: { ...DEFAULT_PARAMS.auger },
      visible: true,
      transform: DEFAULT_TRANSFORM(),
    },
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [material, setMaterial] = useState<MaterialPreset>("steel");
  const [viewMode, setViewMode] = useState<ViewMode>("solid");
  const [autoRotate, setAutoRotate] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipPos, setClipPos] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const viewerRef = useRef<ViewerHandle>(null);
  const [statsTick, setStatsTick] = useState(0);

  // Mesh diagnostics
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagOpts, setDiagOpts] = useState<DiagnosticOptions>({
    showOpenEdges: true,
    showNonManifold: true,
    showNormals: false,
    showThickness: false,
    wallThicknessMin: 1.2,
    wallThicknessSafe: 2.0,
  });
  const [diagReport, setDiagReport] = useState<DiagnosticReport | null>(null);
  const [diagScope, setDiagScope] = useState<"selected" | "assembly">("selected");
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [metricsMode, setMetricsMode] = useState<"tris" | "quads" | "perPart">("tris");
  const [meshMetrics, setMeshMetrics] = useState<{
    tris: number; verts: number; meshes: number;
    perPart: { id: string; name: string; tris: number; verts: number; visible: boolean }[];
  }>({ tris: 0, verts: 0, meshes: 0, perPart: [] });

  // Group cache: id + params signature -> group
  const groupCacheRef = useRef<Map<string, { sig: string; group: THREE.Group }>>(new Map());

  const selected = parts.find((p) => p.id === selectedId) ?? null;

  // Load/save history
  useEffect(() => {
    try {
      const raw = localStorage.getItem("helixforge:history");
      if (raw) setHistory(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);

  // Build & sync parts to viewer whenever parts change
  useEffect(() => {
    if (!viewerRef.current) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8bfc7, metalness: 0.9, roughness: 0.35 });
    const cache = groupCacheRef.current;
    const rendered: PartRenderInput[] = parts.map((p) => {
      const sig = `${p.type}:${JSON.stringify(p.params)}`;
      let entry = cache.get(p.id);
      if (!entry || entry.sig !== sig) {
        const group = buildPart(p.type, p.params, mat);
        entry = { sig, group };
        cache.set(p.id, entry);
      }
      return { id: p.id, group: entry.group, transform: p.transform, visible: p.visible, tint: p.color ?? null };
    });
    // Clean orphans
    const live = new Set(parts.map((p) => p.id));
    for (const k of Array.from(cache.keys())) if (!live.has(k)) cache.delete(k);
    viewerRef.current.setParts(rendered);
    setStatsTick((t) => t + 1);
  }, [parts]);

  useEffect(() => viewerRef.current?.setSelected(selectedId), [selectedId]);
  useEffect(() => viewerRef.current?.setMaterial(material), [material]);
  useEffect(() => viewerRef.current?.setViewMode(viewMode), [viewMode]);
  useEffect(() => viewerRef.current?.setAutoRotate(autoRotate), [autoRotate]);
  useEffect(() => viewerRef.current?.setGridVisible(showGrid), [showGrid]);
  useEffect(() => viewerRef.current?.setAxesVisible(showAxes), [showAxes]);
  useEffect(() => viewerRef.current?.setClipEnabled(clipEnabled), [clipEnabled]);
  useEffect(() => viewerRef.current?.setClipPosition(clipPos), [clipPos]);

  // Mesh diagnostics runner
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (!diagOpen) {
      v.setDiagnosticOverlay(null);
      setDiagReport(null);
      return;
    }
    const target = diagScope === "selected" && selectedId
      ? v.getPartGroup(selectedId)
      : v.getAssemblyGroup();
    if (!target) { v.setDiagnosticOverlay(null); setDiagReport(null); return; }
    // Defer to next frame so latest geometry is applied
    const raf = requestAnimationFrame(() => {
      try {
        const { overlay, report } = analyzeGroup(target, diagOpts);
        v.setDiagnosticOverlay(overlay);
        setDiagReport(report);
      } catch (e) {
        console.error("Diagnóstico de malla falló", e);
        toast.error(tr("El diagnóstico de malla falló"));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [diagOpen, diagOpts, diagScope, selectedId, parts, statsTick]);

  // Mesh metrics (triangles / vertices per part and total)
  useEffect(() => {
    const v = viewerRef.current;
    if (!metricsOpen || !v) return;
    const raf = requestAnimationFrame(() => {
      let tris = 0, verts = 0, meshes = 0;
      const perPart: { id: string; name: string; tris: number; verts: number; visible: boolean }[] = [];
      for (const p of parts) {
        const g = v.getPartGroup(p.id);
        let pt = 0, pv = 0;
        g?.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh || !m.geometry) return;
          const geo = m.geometry as THREE.BufferGeometry;
          const pos = geo.getAttribute("position");
          if (!pos) return;
          meshes += 1;
          pv += pos.count;
          pt += geo.index ? geo.index.count / 3 : pos.count / 3;
        });
        perPart.push({ id: p.id, name: p.name, tris: Math.round(pt), verts: pv, visible: p.visible });
        if (p.visible) { tris += pt; verts += pv; }
      }
      setMeshMetrics({ tris: Math.round(tris), verts, meshes, perPart });
    });
    return () => cancelAnimationFrame(raf);
  }, [metricsOpen, parts, statsTick]);


  // Part management
  const nextName = (t: PartType) => {
    const meta = partMeta(t);
    const existing = parts.filter((p) => p.type === t).length;
    return `${meta.short} ${existing + 1}`;
  };

  const addPart = (t: PartType) => {
    const id = crypto.randomUUID();
    setParts((ps) => [
      ...ps,
      { id, type: t, name: nextName(t), params: { ...DEFAULT_PARAMS[t] }, visible: true, transform: DEFAULT_TRANSFORM() },
    ]);
    setSelectedId(id);
    toast(`Añadido: ${nextName(t)}`);
  };

  const duplicatePart = (id: string) => {
    const p = parts.find((x) => x.id === id);
    if (!p) return;
    const newId = crypto.randomUUID();
    setParts((ps) => [
      ...ps,
      { ...p, id: newId, name: `${p.name} copia`, params: { ...p.params }, transform: { ...p.transform, z: p.transform.z + 20 } },
    ]);
    setSelectedId(newId);
  };

  const CLIPBOARD_FORMAT = "helixforge-part";

  const copyPartToClipboard = async (id: string) => {
    const p = parts.find((x) => x.id === id);
    if (!p) return;
    const payload = {
      format: CLIPBOARD_FORMAT,
      version: 1,
      part: { type: p.type, name: p.name, params: p.params, visible: p.visible, transform: p.transform, color: p.color ?? null },
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast.success(tr("Pieza copiada al portapapeles"), { description: p.name });
    } catch {
      toast.error(tr("No se pudo copiar al portapapeles"));
    }
  };

  const pastePartFromClipboard = async (mode: "new" | "apply" = "new") => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast.error(tr("No se pudo leer el portapapeles"), { description: tr("Permite el acceso al portapapeles del navegador") });
      return;
    }
    if (!text.trim()) { toast.error(tr("El portapapeles está vacío")); return; }
    let data: unknown;
    try { data = JSON.parse(text); } catch { toast.error(tr("El portapapeles no contiene JSON válido")); return; }
    const obj = data as { format?: string; part?: { type?: PartType; name?: string; params?: Partial<PartParams>; visible?: boolean; transform?: Partial<PartTransform>; color?: string | null }; parts?: unknown };
    const rp = obj?.part ?? (Array.isArray(obj?.parts) ? (obj.parts as { type?: PartType; name?: string; params?: Partial<PartParams>; visible?: boolean; transform?: Partial<PartTransform>; color?: string | null }[])[0] : undefined);
    if (!rp || !rp.type || !(rp.type in DEFAULT_PARAMS)) {
      toast.error(tr("El portapapeles no contiene una pieza válida"));
      return;
    }
    if (mode === "apply" && selected) {
      if (selected.type !== rp.type) {
        toast.error(tr("Los tipos de pieza no coinciden"), { description: `Seleccionada: ${selected.type} · Portapapeles: ${rp.type}` });
        return;
      }
      setParts((ps) => ps.map((p) => p.id === selected.id ? {
        ...p,
        params: { ...DEFAULT_PARAMS[rp.type!], ...(rp.params ?? {}) },
        transform: { ...p.transform, ...(rp.transform ?? {}) },
      } : p));
      toast.success(tr("Configuración aplicada a la pieza seleccionada"));
      return;
    }
    const newId = crypto.randomUUID();
    setParts((ps) => [
      ...ps,
      {
        id: newId,
        type: rp.type!,
        name: typeof rp.name === "string" ? `${rp.name} (pegada)` : "Pieza pegada",
        params: { ...DEFAULT_PARAMS[rp.type!], ...(rp.params ?? {}) },
        visible: rp.visible !== false,
        transform: { ...DEFAULT_TRANSFORM(), ...(rp.transform ?? {}) },
        color: typeof rp.color === "string" ? rp.color : null,
      },
    ]);
    setSelectedId(newId);
    toast.success(tr("Pieza pegada desde el portapapeles"));
  };


  const deletePart = (id: string) => {
    setParts((ps) => ps.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const toggleVisible = (id: string) => {
    setParts((ps) => ps.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)));
  };

  const setPartColor = (id: string, color: string | null) => {
    setParts((ps) => ps.map((p) => (p.id === id ? { ...p, color } : p)));
  };

  const renamePart = (id: string, name: string) => {
    setParts((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const updateSelectedParams = <K extends keyof PartParams>(key: K, v: PartParams[K]) => {
    if (!selected) return;
    setParts((ps) => ps.map((p) => (p.id === selected.id ? { ...p, params: { ...p.params, [key]: v } } : p)));
  };

  const updateSelectedTransform = (key: keyof PartTransform, v: number) => {
    if (!selected) return;
    setParts((ps) => ps.map((p) => (p.id === selected.id ? { ...p, transform: { ...p.transform, [key]: v } } : p)));
  };

  // Drag & drop reorder
  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  };
  const onDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const srcId = e.dataTransfer.getData("text/plain");
    setDragOverId(null);
    if (!srcId || srcId === targetId) return;
    setParts((ps) => {
      const src = ps.findIndex((p) => p.id === srcId);
      const tgt = ps.findIndex((p) => p.id === targetId);
      if (src < 0 || tgt < 0) return ps;
      const arr = [...ps];
      const [moved] = arr.splice(src, 1);
      arr.splice(tgt, 0, moved);
      return arr;
    });
  };

  // Validation for selected
  const validation = useMemo(() => {
    if (!selected) return [] as { level: "warn" | "error" | "ok"; text: string }[];
    if (selected.type === "note") return [{ level: "ok" as const, text: tr("Nota del proyecto (sin geometría).") }];
    const p = selected.params;
    const t = selected.type;
    const msgs: { level: "warn" | "error" | "ok"; text: string }[] = [];
    const generic = t !== "tube" && t !== "clevis";
    if (generic && p.innerDiameter >= p.outerDiameter) msgs.push({ level: "error", text: tr("El diámetro interior debe ser menor que el exterior.") });
    if (generic && p.pitch <= 0) msgs.push({ level: "error", text: tr("El paso debe ser positivo.") });
    if (t === "clevis") {
      const style = p.clevisStyle ?? "fork";
      const w = p.lugWidth ?? 20, pd = p.pinDiameter ?? 8, arm = p.armLength ?? 28;
      if (pd >= w - 1.5) msgs.push({ level: "error", text: tr("El agujero es demasiado grande para el ancho de la oreja: deja al menos 1,5 mm de material.") });
      if (arm < w / 2) msgs.push({ level: "warn", text: tr("El brazo es más corto que el radio del ojo: la oreja queda muy compacta.") });
      if (style === "fork" && (p.clevisGap ?? 10) < 1) msgs.push({ level: "warn", text: tr("La separación entre orejas es muy pequeña.") });
      if (style !== "pin" && (p.baseThickness ?? 6) < 1.5) msgs.push({ level: "warn", text: tr("Base muy fina: puede romperse al aplicar carga.") });
    }
    if (t === "tube") {
      const dA = p.tubeDiameterA ?? 0;
      const dB = p.tubeDiameterB ?? 0;
      const wall = p.wallThickness ?? 0;
      if (dA <= 0 || dB <= 0) msgs.push({ level: "error", text: tr("Los diámetros A y B deben ser positivos.") });
      if (wall <= 0) msgs.push({ level: "error", text: tr("El grosor de pared debe ser positivo.") });
      if (wall * 2 >= Math.min(dA, dB)) msgs.push({ level: "error", text: tr("El grosor es demasiado grande: no queda hueco interior en el extremo menor.") });
      if (wall * 2 >= Math.min(dA, dB) * 0.7) msgs.push({ level: "warn", text: tr("Pared muy gruesa respecto al diámetro menor: el hueco interior es muy estrecho.") });
      const aA = p.tubeAngleA ?? 0, aB = p.tubeAngleB ?? 0;
      const drop = (dA / 2) * Math.abs(Math.tan((aA * Math.PI) / 180)) + (dB / 2) * Math.abs(Math.tan((aB * Math.PI) / 180));
      if (drop >= p.length) msgs.push({ level: "error", text: tr("Los cortes inclinados se cruzan: reduce los ángulos o aumenta la longitud.") });
      else if (drop > p.length * 0.7) msgs.push({ level: "warn", text: tr("Cortes muy inclinados respecto a la longitud: la pieza queda muy afilada en un lado.") });
    }
    if (t === "threaded-cylinder") {
      const cA = p.cylinderAngleA ?? 0, cB = p.cylinderAngleB ?? 0;
      const r = p.outerDiameter / 2;
      const drop = r * (Math.abs(Math.tan((cA * Math.PI) / 180)) + Math.abs(Math.tan((cB * Math.PI) / 180)));
      if (drop >= p.length) msgs.push({ level: "error", text: tr("Los cortes inclinados se cruzan: reduce los ángulos o aumenta la longitud.") });
      else if (drop > p.length * 0.7) msgs.push({ level: "warn", text: tr("Cortes muy inclinados: la pieza queda muy afilada en un lado.") });
      if ((cA !== 0 || cB !== 0) && (p.cylinderThread ?? "external") !== "none") msgs.push({ level: "warn", text: tr("Con cortes inclinados la rosca puede sobresalir de los extremos.") });
    }
    if (p.pitch < p.wireThickness && t.includes("spring")) msgs.push({ level: "warn", text: tr("Paso menor que grosor: las espiras se solapan.") });
    if (t === "screw" && (p.threadLength ?? 0) > p.length) msgs.push({ level: "warn", text: tr("La longitud de rosca supera la del tornillo.") });
    if (p.resolution < 24) msgs.push({ level: "warn", text: tr("Resolución baja: la rosca puede verse facetada.") });
    if (msgs.length === 0) msgs.push({ level: "ok", text: tr("Parámetros válidos.") });
    return msgs;
  }, [selected]);

  // Stats
  const stats = useMemo(() => {
    void statsTick;
    const assembly = viewerRef.current?.getAssemblyGroup();
    if (!assembly) return null;
    const target = selected ? viewerRef.current?.getPartGroup(selected.id) : assembly;
    if (!target) return null;
    const box = new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3());
    let tris = 0;
    target.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        const geom = m.geometry;
        const idx = geom.index;
        tris += idx ? idx.count / 3 : (geom.attributes.position?.count ?? 0) / 3;
      }
    });
    return { size, tris: Math.round(tris) };
  }, [statsTick, selectedId, selected]);

  const buildFileName = (p: PartInstance, ext: string) => {
    if (p.type === "clevis") {
      const st = p.params.clevisStyle ?? "fork";
      return `clevis_${st}_pin${p.params.pinDiameter}_w${p.params.lugWidth}_a${p.params.armLength}.${ext}`;
    }
    if (p.type === "tube") {
      return `tube_dA${p.params.tubeDiameterA}_dB${p.params.tubeDiameterB}_t${p.params.wallThickness}_l${p.params.length}.${ext}`;
    }
    const parts = [p.type.replace(/-/g, "_"), `d${p.params.outerDiameter}`, `p${p.params.pitch}`, `s${p.params.starts}`, `l${p.params.length}`];
    return `${parts.join("_")}.${ext}`;
  };

  const pushHistory = useCallback((name: string) => {
    setHistory((h) => {
      const next = [{ id: crypto.randomUUID(), name, at: Date.now() }, ...h].slice(0, 15);
      localStorage.setItem("helixforge:history", JSON.stringify(next));
      return next;
    });
  }, []);

  const doExportAssembly = (fmt: "stl" | "obj") => {
    const assembly = viewerRef.current?.getAssemblyGroup();
    if (!assembly || parts.length === 0) return;
    const filename = `helixforge_ensamblaje_${parts.length}p.${fmt}`;
    const blob = fmt === "stl" ? exportSTLBinary(assembly) : exportOBJ(assembly);
    downloadBlob(blob, filename);
    pushHistory(filename);
    toast.success(`Exportado ${filename}`, { description: `${(blob.size / 1024).toFixed(1)} KB · ${parts.length} piezas` });
  };

  const doExportEach = (fmt: "stl" | "obj") => {
    let count = 0;
    for (const p of parts) {
      const g = viewerRef.current?.getPartGroup(p.id);
      if (!g) continue;
      const filename = `${p.name.replace(/\s+/g, "_").toLowerCase()}_${buildFileName(p, fmt)}`;
      const blob = fmt === "stl" ? exportSTLBinary(g) : exportOBJ(g);
      downloadBlob(blob, filename);
      pushHistory(filename);
      count++;
    }
    toast.success(`Exportadas ${count} piezas (${fmt.toUpperCase()})`);
  };

  const doExportSelected = (fmt: "stl" | "obj") => {
    if (!selected) return;
    const g = viewerRef.current?.getPartGroup(selected.id);
    if (!g) return;
    const filename = `${selected.name.replace(/\s+/g, "_").toLowerCase()}_${buildFileName(selected, fmt)}`;
    const blob = fmt === "stl" ? exportSTLBinary(g) : exportOBJ(g);
    downloadBlob(blob, filename);
    pushHistory(filename);
    toast.success(`Exportado ${filename}`);
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const doExportJSON = (scope: "all" | "selected") => {
    const list = scope === "selected" && selected ? [selected] : parts;
    if (list.length === 0) { toast.error(tr("No hay piezas para exportar")); return; }
    const payload = {
      format: "helixforge-project",
      version: 1,
      exportedAt: new Date().toISOString(),
      parts: list.map((p) => ({
        id: p.id, type: p.type, name: p.name,
        params: p.params, visible: p.visible, transform: p.transform,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const filename = scope === "selected" && selected
      ? `${selected.name.replace(/\s+/g, "_").toLowerCase()}.json`
      : `helixforge_proyecto_${list.length}p.json`;
    downloadBlob(blob, filename);
    pushHistory(filename);
    toast.success(`Exportado ${filename}`, { description: `${(blob.size / 1024).toFixed(1)} KB · ${list.length} pieza${list.length !== 1 ? "s" : ""}` });
  };

  const openImportDialog = () => fileInputRef.current?.click();

  const handleImportFile = async (file: File, mode: "replace" | "append") => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const rawParts = Array.isArray(data) ? data : data?.parts;
      if (!Array.isArray(rawParts)) throw new Error("Formato JSON inválido: falta 'parts'");
      const valid: PartInstance[] = [];
      for (const rp of rawParts) {
        if (!rp || typeof rp !== "object") continue;
        const type = rp.type as PartType;
        if (!type || !(type in DEFAULT_PARAMS)) continue;
        valid.push({
          id: crypto.randomUUID(),
          type,
          name: typeof rp.name === "string" ? rp.name : `Pieza ${valid.length + 1}`,
          params: { ...DEFAULT_PARAMS[type], ...(rp.params ?? {}) },
          visible: rp.visible !== false,
          transform: { ...DEFAULT_TRANSFORM(), ...(rp.transform ?? {}) },
          color: typeof rp.color === "string" ? rp.color : null,
        });
      }
      if (valid.length === 0) throw new Error("El archivo no contiene piezas válidas");
      setParts((ps) => mode === "replace" ? valid : [...ps, ...valid]);
      setSelectedId(valid[0].id);
      toast.success(`Importadas ${valid.length} pieza${valid.length !== 1 ? "s" : ""}`, {
        description: mode === "replace" ? "Proyecto reemplazado" : "Añadidas al proyecto",
      });
    } catch (err) {
      toast.error(tr("Error al importar"), { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const loadPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const newId = crypto.randomUUID();
    setParts((ps) => [
      ...ps,
      {
        id: newId, type: preset.type, name: preset.name,
        params: { ...DEFAULT_PARAMS[preset.type], ...preset.params },
        visible: true, transform: DEFAULT_TRANSFORM(),
      },
    ]);
    setSelectedId(newId);
    toast(`Preset añadido: ${preset.name}`);
  };

  const t = selected?.type;
  const p = selected?.params;

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground">
      <Toaster theme="dark" position="bottom-right" />

      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-panel/80 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/20 glow-primary">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">
              HelixForge <span className="ml-1 text-[10px] font-normal text-muted-foreground">{tr("v1.1 · Multipieza")}</span>
            </h1>
            <p className="text-[11px] text-muted-foreground leading-none">{tr("Ensamblajes paramétricos helicoidales")}</p>
          </div>
          <Separator orientation="vertical" className="mx-2 h-6" />
          <Badge variant="outline" className="border-primary/50 text-primary">
            {parts.length} pieza{parts.length !== 1 ? "s" : ""}
          </Badge>
          {selected && (
            <Badge variant="outline" className="border-accent/50 text-accent">
              {selected.name}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Plus className="h-3.5 w-3.5" />
                {tr("Añadir pieza")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{tr("Tipo de pieza")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PART_TYPES.map(({ type, label, Icon }) => (
                <DropdownMenuItem key={type} onClick={() => addPart(type)}>
                  <Icon className="mr-2 h-4 w-4" />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                {tr("Presets")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{tr("Añadir preset")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PRESETS.map((pr) => (
                <DropdownMenuItem key={pr.id} onClick={() => loadPreset(pr.id)}>
                  {pr.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" title={tr("Importar proyecto JSON")}>
                <Upload className="h-3.5 w-3.5" />
                {tr("Importar")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{tr("Importar proyecto (.json)")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { if (fileInputRef.current) { fileInputRef.current.dataset.mode = "append"; openImportDialog(); } }}>
                {tr("Añadir al proyecto actual")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { if (fileInputRef.current) { fileInputRef.current.dataset.mode = "replace"; openImportDialog(); } }}>
                {tr("Reemplazar proyecto actual")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const mode = (e.target.dataset.mode as "replace" | "append") || "append";
              if (file) handleImportFile(file, mode);
              e.target.value = "";
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <Download className="h-3.5 w-3.5" />
                {tr("Exportar")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="flex items-center gap-1.5">
                <FileJson className="h-3.5 w-3.5" /> Proyecto (JSON)
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => doExportJSON("all")}>{tr("Proyecto completo (.json)")}</DropdownMenuItem>
              {selected && (
                <DropdownMenuItem onClick={() => doExportJSON("selected")}>Solo seleccionada — {selected.name} (.json)</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{tr("Ensamblaje completo")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => doExportAssembly("stl")}>{tr("STL binario (todo junto)")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExportAssembly("obj")}>{tr("OBJ (todo junto)")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{tr("Cada pieza por separado")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => doExportEach("stl")}>{tr("STL — un archivo por pieza")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExportEach("obj")}>{tr("OBJ — un archivo por pieza")}</DropdownMenuItem>
              {selected && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{tr("Solo seleccionada")}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => doExportSelected("stl")}>STL — {selected.name}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => doExportSelected("obj")}>OBJ — {selected.name}</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>


      {/* Main content */}
      <div className="flex min-h-0 flex-1">
        {/* Left: parts list + parameters */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-background/40">
          {/* Parts list */}
          <div className="shrink-0 border-b border-border bg-panel/40">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Layers className="h-3 w-3" /> Piezas
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setSelectedId(null)} title={tr("Deseleccionar")}>
                  {tr("Ninguna")}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2" title={tr("Centrar vista en todo")} onClick={() => viewerRef.current?.setView("fit")}>
                  <Focus className="h-3 w-3" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-primary hover:bg-primary/10" title={tr("Pegar pieza del portapapeles")}>
                      <ClipboardPaste className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>{tr("Pegar desde portapapeles")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => pastePartFromClipboard("new")}>
                      <Plus className="mr-2 h-4 w-4" />
                      {tr("Como pieza nueva")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => pastePartFromClipboard("apply")}
                      disabled={!selected}
                    >
                      <ClipboardPaste className="mr-2 h-4 w-4" />
                      {tr("Aplicar a la seleccionada")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-primary hover:bg-primary/10" title={tr("Añadir pieza")}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>{tr("Añadir pieza")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {PART_TYPES.map(({ type, label, Icon }) => (
                      <DropdownMenuItem key={type} onClick={() => addPart(type)}>
                        <Icon className="mr-2 h-4 w-4" />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

            </div>
            <ScrollArea className="max-h-64">
              <div className="space-y-1 px-2 pb-2">
                {parts.length === 0 && (
                  <div className="p-3 text-center text-[11px] text-muted-foreground">
                    Sin piezas. Usa <b>{tr("Añadir pieza")}</b> arriba.
                  </div>
                )}
                {parts.map((p) => {
                  const meta = partMeta(p.type);
                  const active = p.id === selectedId;
                  const drop = dragOverId === p.id;
                  return (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, p.id)}
                      onDragOver={(e) => onDragOver(e, p.id)}
                      onDragLeave={() => setDragOverId(null)}
                      onDrop={(e) => onDrop(e, p.id)}
                      onClick={() => setSelectedId(p.id)}
                      onDoubleClick={() => viewerRef.current?.focusOn(p.id)}
                      className={`group flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs transition-colors cursor-pointer ${
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-input/40 text-foreground hover:border-primary/40"
                      } ${drop ? "ring-1 ring-primary" : ""} ${!p.visible ? "opacity-50" : ""}`}
                      style={p.color ? { backgroundColor: `${p.color}1f`, borderColor: `${p.color}80` } : undefined}
                    >
                      {p.color && <span className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />}
                      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" />
                      <meta.Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      {editingId === p.id ? (
                        <Input
                          autoFocus
                          value={p.name}
                          onChange={(e) => renamePart(p.id, e.target.value)}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingId(null); }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-5 flex-1 border-border bg-input px-1 text-xs"
                        />
                      ) : (
                        <span className="flex-1 truncate">{p.name}</span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(editingId === p.id ? null : p.id); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                        title={tr("Renombrar")}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className={`${p.color ? "" : "opacity-0 group-hover:opacity-100"} text-muted-foreground hover:text-primary`}
                            title={tr("Color de la pieza")}
                          >
                            <Palette className="h-3 w-3" style={p.color ? { color: p.color } : undefined} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-44 p-2" onClick={(e) => e.stopPropagation()}>
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {tr("Color de la pieza")}
                          </div>
                          <div className="grid grid-cols-5 gap-1.5">
                            {PART_COLORS.map((c) => (
                              <button
                                key={c}
                                onClick={(e) => { e.stopPropagation(); setPartColor(p.id, c); }}
                                className={`h-5 w-5 rounded border-2 transition-transform hover:scale-110 ${p.color === c ? "border-primary scale-110" : "border-border"}`}
                                style={{ backgroundColor: c }}
                                title={c}
                              />
                            ))}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPartColor(p.id, null); }}
                            className="mt-2 w-full rounded border border-border py-1 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          >
                            {tr("Sin color")}
                          </button>
                        </PopoverContent>
                      </Popover>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleVisible(p.id); }}
                        className="text-muted-foreground hover:text-foreground"
                        title={p.visible ? "Ocultar" : "Mostrar"}
                      >
                        {p.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyPartToClipboard(p.id); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                        title={tr("Copiar configuración al portapapeles")}
                      >
                        <ClipboardCopy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); duplicatePart(p.id); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                        title={tr("Duplicar")}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deletePart(p.id); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        title={tr("Eliminar")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Parameters for selected */}
          <ScrollArea className="min-h-0 flex-1">
            <div key={selected?.id ?? "assembly"} className="space-y-3 p-3">
              {!selected ? (
                <div className="rounded-md border border-dashed border-border bg-panel/30 p-6 text-center">
                  <Layers className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    {tr("Selecciona una pieza de la lista o haz clic sobre ella en el visor 3D para editar sus parámetros.")}
                  </p>
                  <div className="mt-4 text-left text-[10px] text-muted-foreground">
                    <div className="mb-1 font-semibold uppercase tracking-wider">{tr("Ensamblaje")}</div>
                    <div>Piezas: {parts.length}</div>
                    <div>Visibles: {parts.filter((p) => p.visible).length}</div>
                  </div>
                </div>
              ) : selected.type === "note" ? (
                <>
                  <Section title={tr("Nota del proyecto")}>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{tr("Contenido")}</label>
                      <textarea
                        value={selected.params.noteText ?? ""}
                        onChange={(e) => updateSelectedParams("noteText", e.target.value)}
                        placeholder={tr("Escribe aquí notas, TODOs, medidas de referencia, decisiones de diseño…")}
                        className="min-h-[220px] w-full resize-y rounded border border-border bg-input px-2 py-1.5 text-xs font-mono leading-relaxed text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{tr("Color de la etiqueta")}</label>
                      <div className="flex gap-1.5">
                        {["#facc15", "#f97316", "#22d3ee", "#a78bfa", "#4ade80", "#f472b6"].map((c) => (
                          <button
                            key={c}
                            onClick={() => updateSelectedParams("noteColor", c)}
                            className={`h-6 w-6 rounded border-2 transition-transform ${(selected.params.noteColor ?? "#facc15") === c ? "border-primary scale-110" : "border-border"}`}
                            style={{ backgroundColor: c }}
                            title={c}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="rounded border border-dashed border-border bg-panel/30 p-2 text-[10px] text-muted-foreground">
                      {tr("Las notas no generan geometría 3D. Se guardan e importan/exportan con el proyecto en JSON.")}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Caracteres: {(selected.params.noteText ?? "").length}
                    </div>
                  </Section>
                </>
              ) : (
                <>


                  <Section title={tr("Transformación")}>
                    <NumberControl label={tr("Vertical (Z)")} value={selected.transform.z} min={-200} max={200} step={0.5}
                      tooltip={tr("Desplazamiento vertical de la pieza. Úsalo para alinear, por ejemplo, un sinfín dentro de una tapa.")}
                      onChange={(v) => updateSelectedTransform("z", v)} />
                    <NumberControl label={tr("Offset X")} value={selected.transform.x} min={-200} max={200} step={0.5}
                      onChange={(v) => updateSelectedTransform("x", v)} />
                    <NumberControl label={tr("Offset Y")} value={selected.transform.y} min={-200} max={200} step={0.5}
                      onChange={(v) => updateSelectedTransform("y", v)} />
                    <NumberControl label={tr("Inclinación X (pitch)")} value={selected.transform.rx * 180 / Math.PI} min={-180} max={180} step={1} unit="°"
                      tooltip={tr("Rotación vertical alrededor del eje X. Útil para tumbar o inclinar la pieza.")}
                      onChange={(v) => updateSelectedTransform("rx", v * Math.PI / 180)} />
                    <NumberControl label={tr("Inclinación Y (roll)")} value={selected.transform.ry * 180 / Math.PI} min={-180} max={180} step={1} unit="°"
                      tooltip={tr("Rotación vertical alrededor del eje Y.")}
                      onChange={(v) => updateSelectedTransform("ry", v * Math.PI / 180)} />
                    <NumberControl label={tr("Rotación Z (yaw)")} value={selected.transform.rz * 180 / Math.PI} min={-180} max={180} step={1} unit="°"
                      tooltip={tr("Rotación sobre el eje axial de la pieza.")}
                      onChange={(v) => updateSelectedTransform("rz", v * Math.PI / 180)} />

                    <Button size="sm" variant="outline" className="w-full gap-1 text-xs" onClick={() => {
                      setParts((ps) => ps.map((x) => x.id === selected.id ? { ...x, transform: DEFAULT_TRANSFORM() } : x));
                    }}>
                      {tr("Resetear posición")}
                    </Button>
                  </Section>

                  {t !== "tube" && t !== "clevis" && (
                  <>

                  <Section title={tr("Dimensiones principales")}>
                    <NumberControl label={tr("Diámetro exterior")} value={p!.outerDiameter} min={1} max={200} step={0.1} tooltip={tr("Diámetro nominal exterior de la pieza.")} onChange={(v) => updateSelectedParams("outerDiameter", v)} />
                    <NumberControl label={tr("Diámetro interior")} value={p!.innerDiameter} min={0} max={200} step={0.1} tooltip={tr("Diámetro de raíz o hueco interior.")} onChange={(v) => updateSelectedParams("innerDiameter", v)} />
                    <NumberControl label={tr("Longitud / Altura")} value={p!.length} min={1} max={500} step={0.5} tooltip={tr("Longitud axial total.")} onChange={(v) => updateSelectedParams("length", v)} />
                  </Section>

                  <Section title={tr("Parámetros de hélice / rosca")}>
                    <NumberControl label={tr("Paso (pitch)")} value={p!.pitch} min={0.2} max={50} step={0.05} tooltip={tr("Distancia axial de una espira completa.")} onChange={(v) => updateSelectedParams("pitch", v)} />
                    <NumberControl label={t!.includes("spring") ? "Grosor del alambre" : "Grosor del filete"} value={p!.wireThickness} min={0.1} max={20} step={0.05} onChange={(v) => updateSelectedParams("wireThickness", v)} />
                    {(t === "auger" || t!.includes("spring")) && (
                      <NumberControl label={tr("Pala (ancho perfil)")} value={p!.flightWidth} min={0.2} max={80} step={0.1} onChange={(v) => updateSelectedParams("flightWidth", v)} />
                    )}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{tr("Entradas (multi-start)")}</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((n) => (
                          <button key={n} onClick={() => updateSelectedParams("starts", n)}
                            className={`flex-1 rounded border py-1 text-xs font-mono transition-colors ${p!.starts === n ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                            {n}×
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{tr("Dirección hélice")}</label>
                      <div className="flex gap-1">
                        {(["right", "left"] as const).map((h) => (
                          <button key={h} onClick={() => updateSelectedParams("handed", h)}
                            className={`flex-1 rounded border py-1 text-xs transition-colors ${p!.handed === h ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                            {h === "right" ? "Derecha ↻" : "Izquierda ↺"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Section>

                  </>
                  )}

                  {t === "clevis" && (
                    <>
                      <Section title={tr("Tipo de unión")}>
                        <div className="flex gap-1">
                          {([["fork", "Horquilla"], ["single", "Oreja simple"], ["pin", "Pasador"]] as const).map(([v, label]) => (
                            <button key={v} onClick={() => updateSelectedParams("clevisStyle", v)}
                              className={`flex-1 rounded border py-1 text-[11px] transition-colors ${(p!.clevisStyle ?? "fork") === v ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="rounded border border-dashed border-border bg-panel/30 p-2 text-[10px] text-muted-foreground">
                          {tr("Combina una horquilla + una oreja simple + un pasador para formar la junta completa.")}
                        </div>
                      </Section>

                      <Section title={tr("Oreja / ojo")}>
                        <NumberControl label={tr("Diámetro del pasador")} value={p!.pinDiameter ?? 8} min={1} max={100} step={0.1}
                          tooltip={tr("Diámetro del agujero pasante (y del pasador).")} onChange={(v) => updateSelectedParams("pinDiameter", v)} />
                        {(p!.clevisStyle ?? "fork") !== "pin" && (
                          <>
                            <NumberControl label={tr("Ancho de la oreja")} value={p!.lugWidth ?? 20} min={2} max={200} step={0.5}
                              tooltip={tr("Ancho de la oreja; define el diámetro exterior del ojo.")} onChange={(v) => updateSelectedParams("lugWidth", v)} />
                            <NumberControl label={tr("Espesor de la oreja")} value={p!.lugThickness ?? 6} min={0.5} max={60} step={0.1}
                              onChange={(v) => updateSelectedParams("lugThickness", v)} />
                            <NumberControl label={tr("Largo del brazo")} value={p!.armLength ?? 28} min={2} max={300} step={0.5}
                              tooltip={tr("Distancia desde la base hasta el centro del agujero.")} onChange={(v) => updateSelectedParams("armLength", v)} />
                          </>
                        )}
                        {(p!.clevisStyle ?? "fork") === "fork" && (
                          <NumberControl label={tr("Separación entre orejas")} value={p!.clevisGap ?? 10} min={0.5} max={200} step={0.1}
                            tooltip={tr("Hueco interior de la horquilla: debe ser algo mayor que el espesor de la oreja simple.")}
                            onChange={(v) => updateSelectedParams("clevisGap", v)} />
                        )}
                      </Section>

                      {(p!.clevisStyle ?? "fork") !== "pin" && (
                        <Section title={tr("Base de anclaje")}>
                          <NumberControl label={tr("Ancho base")} value={p!.baseWidth ?? 34} min={2} max={400} step={0.5} onChange={(v) => updateSelectedParams("baseWidth", v)} />
                          <NumberControl label={tr("Fondo base")} value={p!.baseDepth ?? 24} min={2} max={400} step={0.5} onChange={(v) => updateSelectedParams("baseDepth", v)} />
                          <NumberControl label={tr("Espesor base")} value={p!.baseThickness ?? 6} min={0.5} max={80} step={0.1} onChange={(v) => updateSelectedParams("baseThickness", v)} />
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">{tr("Agujeros de fijación")}</label>
                            <div className="flex gap-1">
                              {([0, 2, 4] as const).map((n) => (
                                <button key={n} onClick={() => updateSelectedParams("baseHoles", n)}
                                  className={`flex-1 rounded border py-1 text-xs font-mono transition-colors ${(p!.baseHoles ?? 0) === n ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                                  {n === 0 ? "Sin" : `${n}×`}
                                </button>
                              ))}
                            </div>
                          </div>
                          {(p!.baseHoles ?? 0) > 0 && (
                            <NumberControl label={tr("Diámetro agujeros")} value={p!.baseHoleDiameter ?? 5} min={0.5} max={60} step={0.1} onChange={(v) => updateSelectedParams("baseHoleDiameter", v)} />
                          )}
                        </Section>
                      )}
                    </>
                  )}

                  {t === "tube" && (
                    <Section title={tr("Tubo")}>
                      <NumberControl label={tr("Diámetro A (superior)")} value={p!.tubeDiameterA ?? 30} min={2} max={300} step={0.5}
                        tooltip={tr("Diámetro exterior del extremo superior del tubo.")}
                        onChange={(v) => updateSelectedParams("tubeDiameterA", v)} />
                      <NumberControl label={tr("Diámetro B (inferior)")} value={p!.tubeDiameterB ?? 20} min={2} max={300} step={0.5}
                        tooltip={tr("Diámetro exterior del extremo inferior. Igual a A si quieres un tubo recto.")}
                        onChange={(v) => updateSelectedParams("tubeDiameterB", v)} />
                      <NumberControl label={tr("Grosor de pared")} value={p!.wallThickness ?? 2} min={0.2} max={40} step={0.1}
                        tooltip={tr("Espesor de la pared. El tubo es hueco y ambos extremos quedan cerrados por un anillo sólido.")}
                        onChange={(v) => updateSelectedParams("wallThickness", v)} />
                      <NumberControl label={tr("Longitud")} value={p!.length} min={1} max={500} step={0.5}
                        tooltip={tr("Longitud axial del tubo.")}
                        onChange={(v) => updateSelectedParams("length", v)} />
                      <NumberControl label={tr("Ángulo extremo A (superior)")} value={p!.tubeAngleA ?? 0} min={-75} max={75} step={1}
                        tooltip={tr("Inclinación del corte superior en grados. 0 = corte recto; valores positivos o negativos inclinan el plano de corte.")}
                        onChange={(v) => updateSelectedParams("tubeAngleA", v)} />
                      <NumberControl label={tr("Ángulo extremo B (inferior)")} value={p!.tubeAngleB ?? 0} min={-75} max={75} step={1}
                        tooltip={tr("Inclinación del corte inferior en grados. 0 = corte recto.")}
                        onChange={(v) => updateSelectedParams("tubeAngleB", v)} />
                      <div className="rounded border border-dashed border-border bg-panel/30 p-2 text-[10px] text-muted-foreground">
                        Tubo hueco con superficie interior y exterior sólidas (manifold), listo para impresión 3D.
                      </div>
                    </Section>
                  )}

                  {(t === "screw" || t === "nut" || t === "threaded-cap" || t === "threaded-cylinder") && (
                    <Section title={tr("Rosca")}>
                      <Select value={p!.threadForm ?? "metric"} onValueChange={(v) => updateSelectedParams("threadForm", v as "metric" | "acme")}>
                        <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="metric">{tr("Métrica (triangular)")}</SelectItem>
                          <SelectItem value="acme">{tr("ACME / Trapezoidal")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Section>
                  )}

                  {t === "screw" && (
                    <Section title={tr("Cabeza y cuerpo")}>
                      <Select value={p!.headType ?? "hex"} onValueChange={(v) => updateSelectedParams("headType", v as "hex" | "socket" | "button")}>
                        <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hex">{tr("Hexagonal")}</SelectItem>
                          <SelectItem value="socket">{tr("Allen (cilíndrica)")}</SelectItem>
                          <SelectItem value="button">{tr("Botón")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <NumberControl label={tr("Diámetro cabeza")} value={p!.headDiameter ?? 13} min={2} max={100} step={0.1} onChange={(v) => updateSelectedParams("headDiameter", v)} />
                      <NumberControl label={tr("Altura cabeza")} value={p!.headHeight ?? 5} min={0.5} max={50} step={0.1} onChange={(v) => updateSelectedParams("headHeight", v)} />
                      <NumberControl label={tr("Longitud rosca")} value={p!.threadLength ?? p!.length} min={0} max={500} step={0.5} onChange={(v) => updateSelectedParams("threadLength", v)} />
                    </Section>
                  )}

                  {t === "nut" && (
                    <Section title={tr("Tuerca")}>
                      <div className="flex gap-1">
                        {(["hex", "square"] as const).map((s) => (
                          <button key={s} onClick={() => updateSelectedParams("nutShape", s)}
                            className={`flex-1 rounded border py-1 text-xs transition-colors ${p!.nutShape === s ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                            {s === "hex" ? "Hexagonal" : "Cuadrada"}
                          </button>
                        ))}
                      </div>
                      <NumberControl label={tr("Altura tuerca")} value={p!.nutHeight ?? 6.5} min={1} max={80} step={0.1} onChange={(v) => updateSelectedParams("nutHeight", v)} />
                      <NumberControl label={tr("Entrecaras")} value={p!.headDiameter ?? 13} min={2} max={100} step={0.1} onChange={(v) => updateSelectedParams("headDiameter", v)} />
                    </Section>
                  )}

                  {t === "auger" && (
                    <>
                      <Section title={tr("Sinfín")}>
                        <NumberControl label={tr("Diámetro eje")} value={p!.shaftDiameter ?? 10} min={1} max={100} step={0.1} onChange={(v) => updateSelectedParams("shaftDiameter", v)} />
                        <NumberControl label={tr("Espesor pala")} value={p!.flightThickness ?? 2} min={0.4} max={20} step={0.1} onChange={(v) => updateSelectedParams("flightThickness", v)} />
                      </Section>
                      <Section title={tr("Refuerzo / Fillet")}>
                        <Select value={p!.filletType ?? "none"} onValueChange={(v) => updateSelectedParams("filletType", v as "none" | "circular" | "triangular" | "rounded")}>
                          <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{tr("Ninguno")}</SelectItem>
                            <SelectItem value="circular">{tr("Fillet circular")}</SelectItem>
                            <SelectItem value="triangular">{tr("Triangular (rib)")}</SelectItem>
                            <SelectItem value="rounded">{tr("Redondeado suave")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <NumberControl label={tr("Radio de refuerzo")} value={p!.filletRadius ?? 0} min={0} max={Math.max(1, (p!.flightWidth ?? 10) * 0.9)} step={0.1}
                          tooltip={tr("Añade material de refuerzo entre el eje y la pala.")}
                          onChange={(v) => updateSelectedParams("filletRadius", v)} />
                        <NumberControl label={tr("Altura del refuerzo")} value={p!.filletHeight ?? p!.filletRadius ?? 0} min={0} max={Math.max(1, (p!.flightThickness ?? 2) * 4)} step={0.1}
                          onChange={(v) => updateSelectedParams("filletHeight", v)} />
                      </Section>
                    </>
                  )}

                  {t === "threaded-cap" && (
                    <>
                      <Section title={tr("Tapa — Cavidad")}>
                        <div className="rounded border border-primary/30 bg-primary/5 p-2 text-[10px] text-muted-foreground">
                          Cavidad interior real (hueca). Activa <b>{tr("Sección")}</b> arriba o gira la tapa boca abajo para ver el hueco desde dentro.
                        </div>
                        <NumberControl label={tr("Altura interior (cavidad)")} value={p!.capInteriorHeight ?? (p!.length - 2)} min={0.5} max={Math.max(1, p!.length - 0.5)} step={0.1}
                          tooltip={tr("Profundidad real del hueco desde el borde inferior.")}
                          onChange={(v) => updateSelectedParams("capInteriorHeight", v)} />
                        <div className="flex items-center justify-between rounded border border-border bg-input/40 px-2 py-1 text-[11px]">
                          <span className="text-muted-foreground">{tr("Espesor pared (calc.)")}</span>
                          <span className="font-mono text-foreground">{((p!.outerDiameter - p!.innerDiameter) / 2).toFixed(2)} mm</span>
                        </div>
                        <div className="flex items-center justify-between rounded border border-border bg-input/40 px-2 py-1 text-[11px]">
                          <span className="text-muted-foreground">{tr("Espesor techo (calc.)")}</span>
                          <span className="font-mono text-foreground">{(p!.length - (p!.capInteriorHeight ?? p!.length - 2)).toFixed(2)} mm</span>
                        </div>
                      </Section>

                      <Section title={tr("Rosca interior")}>
                        <div className="flex gap-1">
                          {[true, false].map((b) => (
                            <button key={String(b)} onClick={() => updateSelectedParams("hasInternalThread", b)}
                              className={`flex-1 rounded border py-1 text-xs transition-colors ${(p!.hasInternalThread ?? true) === b ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                              {b ? "Con rosca" : "Sin rosca"}
                            </button>
                          ))}
                        </div>
                        <NumberControl label={tr("Inicio rosca (desde base)")} value={p!.threadStartHeight ?? 0} min={0} max={Math.max(0, (p!.capInteriorHeight ?? p!.length) - 0.5)} step={0.1}
                          tooltip={tr("Distancia desde el borde inferior hasta donde empieza la rosca interior.")}
                          onChange={(v) => updateSelectedParams("threadStartHeight", v)} />
                        <NumberControl label={tr("Profundidad de rosca")} value={p!.wireThickness} min={0.2} max={5} step={0.05}
                          tooltip={tr("Profundidad radial de cada filete. Ajusta según el tornillo que debe alojarse.")}
                          onChange={(v) => updateSelectedParams("wireThickness", v)} />
                        <NumberControl label={tr("Ancho de pala (rosca)")} value={p!.flightWidth} min={0.1} max={Math.max(0.2, p!.pitch * 0.95)} step={0.05}
                          tooltip={tr("Ancho axial del filete de la rosca interior. Debe ser menor que el paso.")}
                          onChange={(v) => updateSelectedParams("flightWidth", v)} />
                      </Section>

                      <Section title={tr("Agarradera exterior (grip)")}>
                        <Select value={p!.gripType ?? "smooth"} onValueChange={(v) => updateSelectedParams("gripType", v as "smooth" | "hex" | "knurled" | "hex-knurled")}>
                          <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="smooth">{tr("Lisa")}</SelectItem>
                            <SelectItem value="hex">{tr("Hexagonal")}</SelectItem>
                            <SelectItem value="knurled">{tr("Antideslizante (knurled)")}</SelectItem>
                            <SelectItem value="hex-knurled">{tr("Hex + knurled")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <NumberControl label={tr("Altura zona agarre")} value={p!.gripHeight ?? p!.length} min={0} max={p!.length} step={0.1}
                          tooltip={tr("Altura, desde la base, ocupada por la zona de agarre. El resto es liso.")}
                          onChange={(v) => updateSelectedParams("gripHeight", v)} />
                        {(p!.gripType === "knurled" || p!.gripType === "hex-knurled") && (
                          <NumberControl label={tr("Intensidad knurl")} value={p!.knurlIntensity ?? 0.5} min={0} max={1} step={0.05} unit=""
                            tooltip={tr("Profundidad y agresividad de los surcos antideslizantes.")}
                            onChange={(v) => updateSelectedParams("knurlIntensity", v)} />
                        )}
                      </Section>

                      <Section title={tr("Agujero de herramienta")}>
                        <Select value={p!.toolHoleType ?? "none"} onValueChange={(v) => updateSelectedParams("toolHoleType", v as "none" | "hex" | "slot")}>
                          <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{tr("Ninguno")}</SelectItem>
                            <SelectItem value="hex">{tr("Hexagonal (Allen)")}</SelectItem>
                            <SelectItem value="slot">{tr("Ranura (destornillador)")}</SelectItem>
                          </SelectContent>
                        </Select>
                        {(p!.toolHoleType ?? "none") !== "none" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">{tr("Ubicación")}</label>
                              <div className="flex gap-1">
                                {(["inside", "outside-top"] as const).map((loc) => (
                                  <button key={loc} onClick={() => updateSelectedParams("toolHoleLocation", loc)}
                                    className={`flex-1 rounded border py-1 text-xs transition-colors ${(p!.toolHoleLocation ?? "inside") === loc ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                                    {loc === "inside" ? "Base interior" : "Base exterior (top)"}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <NumberControl label={tr("Tamaño")} value={p!.toolHoleSize ?? 4} min={0.5} max={Math.max(1, ((p!.toolHoleLocation ?? "inside") === "outside-top" ? p!.outerDiameter : p!.innerDiameter) - 1)} step={0.1}
                              tooltip={tr("Entrecaras (Allen) o largo (ranura).")}
                              onChange={(v) => updateSelectedParams("toolHoleSize", v)} />
                            <NumberControl label={tr("Profundidad")} value={p!.toolHoleDepth ?? 3} min={0} max={Math.max(0.5, p!.length - 0.5)} step={0.1}
                              tooltip={tr("Si supera el grosor del techo, la cavidad se reduce automáticamente para dar espacio al agujero.")}
                              onChange={(v) => updateSelectedParams("toolHoleDepth", v)} />

                          </>
                        )}
                      </Section>
                    </>
                  )}


                  {t === "threaded-cylinder" && (
                    <Section title={tr("Cilindro")}>
                      <div className="flex gap-1">
                        {[true, false].map((b) => (
                          <button key={String(b)} onClick={() => {
                            updateSelectedParams("hollow", b);
                            // Si pasa a macizo y estaba en rosca interior, cae a "ninguna".
                            if (!b && p!.cylinderThread === "internal") {
                              updateSelectedParams("cylinderThread", "none");
                            }
                          }}
                            className={`flex-1 rounded border py-1 text-xs transition-colors ${p!.hollow === b ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                            {b ? "Tubo" : "Macizo"}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{tr("Rosca")}</div>
                        <div className="flex gap-1">
                          {([
                            { v: "none", label: tr("Sin rosca"), disabled: false },
                            { v: "external", label: tr("Exterior"), disabled: false },
                            { v: "internal", label: tr("Interior"), disabled: !p!.hollow },
                          ] as const).map((opt) => {
                            const current = p!.cylinderThread ?? "external";
                            const active = current === opt.v;
                            return (
                              <button
                                key={opt.v}
                                disabled={opt.disabled}
                                onClick={() => updateSelectedParams("cylinderThread", opt.v)}
                                title={opt.disabled ? "Solo disponible en modo Tubo" : undefined}
                                className={`flex-1 rounded border py-1 text-xs transition-colors ${
                                  active
                                    ? "border-primary bg-primary/20 text-primary"
                                    : opt.disabled
                                      ? "cursor-not-allowed border-border/50 bg-input/40 text-muted-foreground/40"
                                      : "border-border bg-input text-muted-foreground hover:border-primary/50"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <NumberControl label={tr("Ángulo extremo A (superior)")} value={p!.cylinderAngleA ?? 0} min={-75} max={75} step={1}
                        unit="°" tooltip={tr("Inclina el corte del extremo superior. 0° = corte recto.")}
                        onChange={(v) => updateSelectedParams("cylinderAngleA", v)} />
                      <NumberControl label={tr("Ángulo extremo B (inferior)")} value={p!.cylinderAngleB ?? 0} min={-75} max={75} step={1}
                        unit="°" tooltip={tr("Inclina el corte del extremo inferior. 0° = corte recto.")}
                        onChange={(v) => updateSelectedParams("cylinderAngleB", v)} />
                    </Section>
                  )}


                  {t!.includes("spring") && (
                    <Section title={tr("Extremos del muelle")}>
                      <Select value={p!.springEnds ?? "closed"} onValueChange={(v) => updateSelectedParams("springEnds", v as "open" | "closed" | "closed-ground")}>
                        <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">{tr("Abiertos")}</SelectItem>
                          <SelectItem value="closed">{tr("Cerrados")}</SelectItem>
                          <SelectItem value="closed-ground">{tr("Cerrados y rectificados")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Section>
                  )}

                  <Section title={tr("Avanzado")}>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">{tr("Resolución de malla")}</label>
                      <span className="text-xs font-mono text-primary">{p!.resolution}</span>
                    </div>
                    <Slider value={[p!.resolution]} min={12} max={128} step={4} onValueChange={(v) => updateSelectedParams("resolution", v[0])} />
                  </Section>
                </>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Center: viewer */}
        <main className="relative flex min-w-0 flex-1 flex-col p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel/60 p-2 text-xs">
            <div className="flex items-center gap-1">
              {(["front", "side", "top", "iso"] as const).map((v, i) => (
                <Button key={v} variant="ghost" size="sm" className="h-7 w-7 p-0" title={["Vista frontal", "Vista lateral", "Vista superior", "Vista isométrica"][i]} onClick={() => viewerRef.current?.setView(v)}>
                  {i === 0 && <RectangleVertical className="h-3.5 w-3.5" />}
                  {i === 1 && <RectangleVertical className="h-3.5 w-3.5 rotate-90" />}
                  {i === 2 && <RectangleHorizontal className="h-3.5 w-3.5" />}
                  {i === 3 && <Box className="h-3.5 w-3.5" />}
                </Button>
              ))}
              <Button variant="secondary" size="sm" className="h-7 w-7 p-0" title={tr("Ajustar vista a todo el conjunto")} onClick={() => viewerRef.current?.setView("fit")}>
                <Scan className="h-3.5 w-3.5" />
              </Button>
              {selected && (
                <Button variant="secondary" size="sm" className="h-7 w-7 p-0" title={tr("Centrar vista en la pieza seleccionada")} onClick={() => viewerRef.current?.focusOn(selected.id)}>
                  <Focus className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-1">
              {(["solid", "wireframe", "transparent"] as const).map((m, i) => (
                <Toggle key={m} pressed={viewMode === m} onPressedChange={() => setViewMode(m)} size="sm" className="h-7 w-7 p-0 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"
                  title={["Modo sólido", "Modo alambre", "Modo transparente"][i]}>
                  {m === "solid" ? <Box className="h-3.5 w-3.5" /> : m === "wireframe" ? <Frame className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
                </Toggle>
              ))}
            </div>
            <Separator orientation="vertical" className="h-6" />
            <Select value={material} onValueChange={(v) => setMaterial(v as MaterialPreset)}>
              <SelectTrigger className="h-7 w-[110px] bg-input text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="steel">{tr("Acero")}</SelectItem>
                <SelectItem value="aluminum">{tr("Aluminio")}</SelectItem>
                <SelectItem value="brass">{tr("Latón")}</SelectItem>
              </SelectContent>
            </Select>
            <Separator orientation="vertical" className="h-6" />
            <Toggle pressed={showGrid} onPressedChange={setShowGrid} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"><Grid3x3 className="h-3.5 w-3.5" /></Toggle>
            <Toggle pressed={showAxes} onPressedChange={setShowAxes} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"><Ruler className="h-3.5 w-3.5" /></Toggle>
            <Toggle pressed={autoRotate} onPressedChange={setAutoRotate} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"><Play className="h-3.5 w-3.5" /></Toggle>
            <Toggle pressed={clipEnabled} onPressedChange={setClipEnabled} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary" title={tr("Sección de corte")}>
              <Scissors className="h-3.5 w-3.5" />
            </Toggle>
            {clipEnabled && (
              <div className="flex w-40 items-center gap-2">
                <Slider value={[clipPos]} min={-100} max={100} step={0.5} onValueChange={(v) => setClipPos(v[0])} />
                <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">{clipPos.toFixed(1)}</span>
              </div>
            )}
            <Separator orientation="vertical" className="h-6" />
            <Toggle
              pressed={diagOpen}
              onPressedChange={setDiagOpen}
              size="sm"
              className="h-7 px-2 data-[state=on]:bg-destructive/20 data-[state=on]:text-destructive"
              title={tr("Diagnóstico de malla: detecta huecos, bordes abiertos y paredes finas")}
            >
              <Stethoscope className="h-3.5 w-3.5" />
            </Toggle>
            <Toggle
              pressed={metricsOpen}
              onPressedChange={setMetricsOpen}
              size="sm"
              className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"
              title={tr("Estadísticas de malla: triángulos, quads y detalle por pieza")}
            >
              <Triangle className="h-3.5 w-3.5" />
            </Toggle>
            <div className="ml-auto text-[10px] text-muted-foreground">
              {tr("Clic sobre una pieza para seleccionarla · doble-clic en la lista → focus")}
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <Viewer3D ref={viewerRef} onPick={(id) => setSelectedId(id)} />
            {metricsOpen && (
              <div className="pointer-events-auto absolute left-3 top-3 w-[250px] rounded-md border border-primary/40 bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
                <div className="mb-2 flex items-center gap-2">
                  <Triangle className="h-4 w-4 text-primary" />
                  <span className="font-semibold uppercase tracking-wider text-primary">{tr("Malla")}</span>
                  <Button variant="ghost" size="sm" className="ml-auto h-6 w-6 p-0" onClick={() => setMetricsOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Select value={metricsMode} onValueChange={(v) => setMetricsMode(v as typeof metricsMode)}>
                  <SelectTrigger className="mb-2 h-7 bg-input text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tris">{tr("Triángulos")}</SelectItem>
                    <SelectItem value="quads">{tr("Quads (equivalente)")}</SelectItem>
                    <SelectItem value="perPart">{tr("Triángulos por pieza")}</SelectItem>
                  </SelectContent>
                </Select>
                {metricsMode === "perPart" ? (
                  <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
                    {meshMetrics.perPart.length === 0 && (
                      <div className="text-[10px] text-muted-foreground">{tr("Sin piezas en escena.")}</div>
                    )}
                    {meshMetrics.perPart.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedId(m.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/50 ${m.visible ? "" : "opacity-50"} ${selectedId === m.id ? "bg-primary/10 text-primary" : ""}`}
                      >
                        <span className="truncate">{m.name}</span>
                        <span className="shrink-0 font-mono text-[10px]">{m.tris.toLocaleString("es-ES")}</span>
                      </button>
                    ))}
                    <div className="mt-1 flex items-center justify-between border-t border-border/50 pt-1 font-mono text-[10px] text-muted-foreground">
                      <span>{tr("Total visible")}</span>
                      <span className="text-foreground">{meshMetrics.tris.toLocaleString("es-ES")}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 font-mono text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{metricsMode === "quads" ? "Quads" : "Triángulos"}</span>
                      <span className="text-foreground">
                        {(metricsMode === "quads" ? Math.round(meshMetrics.tris / 2) : meshMetrics.tris).toLocaleString("es-ES")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{tr("Vértices")}</span>
                      <span className="text-foreground">{meshMetrics.verts.toLocaleString("es-ES")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{tr("Mallas")}</span>
                      <span className="text-foreground">{meshMetrics.meshes.toLocaleString("es-ES")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{tr("Piezas visibles")}</span>
                      <span className="text-foreground">{meshMetrics.perPart.filter((m) => m.visible).length}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {diagOpen && (
              <div className="pointer-events-auto absolute right-3 top-3 w-[300px] rounded-md border border-destructive/40 bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
                <div className="mb-2 flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-destructive" />
                  <span className="font-semibold uppercase tracking-wider text-destructive">{tr("Diagnóstico de malla")}</span>
                  <Button variant="ghost" size="sm" className="ml-auto h-6 w-6 p-0" onClick={() => setDiagOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mb-2 flex gap-1">
                  <Button size="sm" variant={diagScope === "selected" ? "secondary" : "ghost"} className="h-6 flex-1 px-2 text-[10px]" onClick={() => setDiagScope("selected")} disabled={!selectedId}>
                    {tr("Pieza sel.")}
                  </Button>
                  <Button size="sm" variant={diagScope === "assembly" ? "secondary" : "ghost"} className="h-6 flex-1 px-2 text-[10px]" onClick={() => setDiagScope("assembly")}>
                    {tr("Ensamblaje")}
                  </Button>
                </div>
                <div className="space-y-1">
                  {[
                    { key: "showOpenEdges", label: tr("Bordes abiertos (rojo)") },
                    { key: "showNonManifold", label: tr("No-manifold (magenta)") },
                    { key: "showThickness", label: tr("Espesor de pared") },
                    { key: "showNormals", label: tr("Normales de caras") },
                  ].map((o) => (
                    <label key={o.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={diagOpts[o.key as keyof DiagnosticOptions] as boolean}
                        onChange={(e) => setDiagOpts((d) => ({ ...d, [o.key]: e.target.checked }))}
                        className="h-3 w-3 accent-destructive"
                      />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
                {diagOpts.showThickness && (
                  <div className="mt-2 space-y-1 rounded border border-border/50 p-2">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{tr("Mín. seguro (mm)")}</span>
                      <span className="font-mono text-foreground">{diagOpts.wallThicknessMin.toFixed(2)}</span>
                    </div>
                    <Slider value={[diagOpts.wallThicknessMin]} min={0.2} max={5} step={0.1}
                      onValueChange={(v) => setDiagOpts((d) => ({ ...d, wallThicknessMin: v[0] }))} />
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{tr("Objetivo verde (mm)")}</span>
                      <span className="font-mono text-foreground">{diagOpts.wallThicknessSafe.toFixed(2)}</span>
                    </div>
                    <Slider value={[diagOpts.wallThicknessSafe]} min={0.5} max={8} step={0.1}
                      onValueChange={(v) => setDiagOpts((d) => ({ ...d, wallThicknessSafe: v[0] }))} />
                  </div>
                )}
                {diagReport && (
                  <div className="mt-2 space-y-1 rounded border border-border/50 p-2">
                    <div className="grid grid-cols-2 gap-1 font-mono text-[10px] text-muted-foreground">
                      <div>{tr("Meshes:")} <span className="text-foreground">{diagReport.meshes}</span></div>
                      <div>{tr("Tris:")} <span className="text-foreground">{diagReport.triangles}</span></div>
                      <div>{tr("Abiertos:")} <span className={diagReport.openEdges > 0 ? "text-destructive" : "text-foreground"}>{diagReport.openEdges}</span></div>
                      <div>{tr("No-manif.:")} <span className={diagReport.nonManifoldEdges > 0 ? "text-destructive" : "text-foreground"}>{diagReport.nonManifoldEdges}</span></div>
                      {diagOpts.showThickness && (
                        <>
                          <div>{tr("Finas:")} <span className={diagReport.thinTriangles > 0 ? "text-destructive" : "text-foreground"}>{diagReport.thinTriangles}</span></div>
                          <div>{tr("Mín:")} <span className="text-foreground">{diagReport.minWallThickness.toFixed(2)}mm</span></div>
                        </>
                      )}
                    </div>
                    <div className="mt-1 space-y-1">
                      {diagReport.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-1 rounded bg-muted/40 p-1 text-[10px] leading-tight">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-yellow-500" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-[9px] text-muted-foreground">
                  Consejos: aumenta el espesor de pared, reduce la intensidad del grip o disminuye la profundidad del agujero de herramienta si aparecen bordes rojos cerca de la tapa.
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right panel */}
        <aside className="w-[280px] shrink-0 border-l border-border bg-background/40">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              <Section title={selected ? "Pieza seleccionada" : "Ensamblaje"}>
                <div className="space-y-1.5 text-xs">
                  {stats && (
                    <>
                      <Row k="Bounding X" v={`${stats.size.x.toFixed(2)} mm`} />
                      <Row k="Bounding Y" v={`${stats.size.y.toFixed(2)} mm`} />
                      <Row k="Bounding Z" v={`${stats.size.z.toFixed(2)} mm`} />
                      <Row k="Triángulos" v={stats.tris.toLocaleString()} />
                    </>
                  )}
                  {selected ? (
                    <>
                      <Row k="Tipo" v={partMeta(selected.type).label} />
                      <Row k="Entradas" v={`${selected.params.starts}×`} />
                      <Row k="Avance/vuelta" v={`${(selected.params.pitch * selected.params.starts).toFixed(2)} mm`} />
                    </>
                  ) : (
                    <>
                      <Row k="Total piezas" v={String(parts.length)} />
                      <Row k="Visibles" v={String(parts.filter((p) => p.visible).length)} />
                    </>
                  )}
                </div>
              </Section>

              {selected && (
                <Section title={tr("Validación")}>
                  <div className="space-y-1.5">
                    {validation.map((v, i) => (
                      <div key={i} className={`rounded border p-2 text-[11px] ${
                        v.level === "error" ? "border-destructive/50 bg-destructive/10 text-destructive"
                        : v.level === "warn" ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                        : "border-primary/40 bg-primary/10 text-primary"
                      }`}>
                        {v.text}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <Section title={tr("Exportar rápido")}>
                <Button className="w-full justify-start gap-2 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => doExportAssembly("stl")}>
                  <Download className="h-4 w-4" /> STL — ensamblaje
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2" onClick={() => doExportEach("stl")}>
                  <Download className="h-4 w-4" /> STL — cada pieza
                </Button>
                {selected && (
                  <Button variant="outline" className="w-full justify-start gap-2" onClick={() => doExportSelected("stl")}>
                    <Download className="h-4 w-4" /> STL — {selected.name}
                  </Button>
                )}
              </Section>

              <Section title={tr("Historial")}>
                {history.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{tr("Aún no has exportado piezas.")}</p>
                ) : (
                  <div className="space-y-1">
                    {history.map((h) => (
                      <div key={h.id} className="flex items-start gap-2 rounded border border-border bg-input/50 p-2 text-left">
                        <History className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[10px] text-foreground">{h.name}</div>
                          <div className="text-[10px] text-muted-foreground">{new Date(h.at).toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-1 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono tabular-nums text-foreground">{v}</span>
    </div>
  );
}

// Kept for future use
void Check; void X;
