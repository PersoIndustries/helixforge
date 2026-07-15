import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  Cog, Bolt, Nut, Package, Cylinder, Waves, Download, RotateCw,
  Grid3x3, Ruler, Scissors, Play, Sparkles, History, Layers,
  Plus, Eye, EyeOff, Copy, Trash2, Focus, GripVertical, Pencil, Check, X,
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
import { Toaster, toast } from "sonner";
import { Viewer3D, type ViewerHandle, type MaterialPreset, type ViewMode, type PartRenderInput } from "@/components/Viewer3D";
import { NumberControl } from "@/components/NumberControl";
import {
  buildPart, DEFAULT_PARAMS, PRESETS,
  type PartParams, type PartType,
} from "@/lib/part-builders";
import { exportSTLBinary, exportOBJ, downloadBlob } from "@/lib/stl-exporter";

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
];

const partMeta = (t: PartType) => PART_TYPES.find((p) => p.type === t)!;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-panel/60 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
        <div className="h-1 w-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

interface PartTransform { x: number; y: number; z: number; rz: number }
interface PartInstance {
  id: string;
  type: PartType;
  name: string;
  params: PartParams;
  visible: boolean;
  transform: PartTransform;
}

interface HistoryEntry { id: string; name: string; at: number }

const DEFAULT_TRANSFORM = (): PartTransform => ({ x: 0, y: 0, z: 0, rz: 0 });

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
      return { id: p.id, group: entry.group, transform: p.transform, visible: p.visible };
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

  const deletePart = (id: string) => {
    setParts((ps) => ps.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const toggleVisible = (id: string) => {
    setParts((ps) => ps.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)));
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
    const p = selected.params;
    const t = selected.type;
    const msgs: { level: "warn" | "error" | "ok"; text: string }[] = [];
    if (p.innerDiameter >= p.outerDiameter) msgs.push({ level: "error", text: "El diámetro interior debe ser menor que el exterior." });
    if (p.pitch <= 0) msgs.push({ level: "error", text: "El paso debe ser positivo." });
    if (p.pitch < p.wireThickness && t.includes("spring")) msgs.push({ level: "warn", text: "Paso menor que grosor: las espiras se solapan." });
    if (t === "screw" && (p.threadLength ?? 0) > p.length) msgs.push({ level: "warn", text: "La longitud de rosca supera la del tornillo." });
    if (p.resolution < 24) msgs.push({ level: "warn", text: "Resolución baja: la rosca puede verse facetada." });
    if (msgs.length === 0) msgs.push({ level: "ok", text: "Parámetros válidos." });
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
    const filename = buildFileName(selected, fmt);
    const blob = fmt === "stl" ? exportSTLBinary(g) : exportOBJ(g);
    downloadBlob(blob, filename);
    pushHistory(filename);
    toast.success(`Exportado ${filename}`);
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
              HelixForge <span className="ml-1 text-[10px] font-normal text-muted-foreground">v1.1 · Multipieza</span>
            </h1>
            <p className="text-[11px] text-muted-foreground leading-none">Ensamblajes paramétricos helicoidales</p>
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
                Añadir pieza
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Tipo de pieza</DropdownMenuLabel>
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
                Presets
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Añadir preset</DropdownMenuLabel>
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
              <Button size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <Download className="h-3.5 w-3.5" />
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Ensamblaje completo</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => doExportAssembly("stl")}>STL binario (todo junto)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExportAssembly("obj")}>OBJ (todo junto)</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Cada pieza por separado</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => doExportEach("stl")}>STL — un archivo por pieza</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExportEach("obj")}>OBJ — un archivo por pieza</DropdownMenuItem>
              {selected && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Solo seleccionada</DropdownMenuLabel>
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
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setSelectedId(null)} title="Deseleccionar">
                  Ninguna
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2" title="Centrar vista en todo" onClick={() => viewerRef.current?.setView("fit")}>
                  <Focus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <ScrollArea className="max-h-64">
              <div className="space-y-1 px-2 pb-2">
                {parts.length === 0 && (
                  <div className="p-3 text-center text-[11px] text-muted-foreground">
                    Sin piezas. Usa <b>Añadir pieza</b> arriba.
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
                    >
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
                        title="Renombrar"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleVisible(p.id); }}
                        className="text-muted-foreground hover:text-foreground"
                        title={p.visible ? "Ocultar" : "Mostrar"}
                      >
                        {p.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); duplicatePart(p.id); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                        title="Duplicar"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deletePart(p.id); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        title="Eliminar"
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
            <div className="space-y-3 p-3">
              {!selected ? (
                <div className="rounded-md border border-dashed border-border bg-panel/30 p-6 text-center">
                  <Layers className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Selecciona una pieza de la lista o haz clic sobre ella en el visor 3D para editar sus parámetros.
                  </p>
                  <div className="mt-4 text-left text-[10px] text-muted-foreground">
                    <div className="mb-1 font-semibold uppercase tracking-wider">Ensamblaje</div>
                    <div>Piezas: {parts.length}</div>
                    <div>Visibles: {parts.filter((p) => p.visible).length}</div>
                  </div>
                </div>
              ) : (
                <>
                  <Section title="Transformación">
                    <NumberControl label="Vertical (Z)" value={selected.transform.z} min={-200} max={200} step={0.5}
                      tooltip="Desplazamiento vertical de la pieza. Úsalo para alinear, por ejemplo, un sinfín dentro de una tapa."
                      onChange={(v) => updateSelectedTransform("z", v)} />
                    <NumberControl label="Offset X" value={selected.transform.x} min={-200} max={200} step={0.5}
                      onChange={(v) => updateSelectedTransform("x", v)} />
                    <NumberControl label="Offset Y" value={selected.transform.y} min={-200} max={200} step={0.5}
                      onChange={(v) => updateSelectedTransform("y", v)} />
                    <NumberControl label="Rotación Z" value={selected.transform.rz * 180 / Math.PI} min={-180} max={180} step={1} unit="°"
                      tooltip="Rotación sobre el eje axial de la pieza."
                      onChange={(v) => updateSelectedTransform("rz", v * Math.PI / 180)} />
                    <Button size="sm" variant="outline" className="w-full gap-1 text-xs" onClick={() => {
                      setParts((ps) => ps.map((x) => x.id === selected.id ? { ...x, transform: DEFAULT_TRANSFORM() } : x));
                    }}>
                      Resetear posición
                    </Button>
                  </Section>

                  <Section title="Dimensiones principales">
                    <NumberControl label="Diámetro exterior" value={p!.outerDiameter} min={1} max={200} step={0.1} tooltip="Diámetro nominal exterior de la pieza." onChange={(v) => updateSelectedParams("outerDiameter", v)} />
                    <NumberControl label="Diámetro interior" value={p!.innerDiameter} min={0} max={200} step={0.1} tooltip="Diámetro de raíz o hueco interior." onChange={(v) => updateSelectedParams("innerDiameter", v)} />
                    <NumberControl label="Longitud / Altura" value={p!.length} min={1} max={500} step={0.5} tooltip="Longitud axial total." onChange={(v) => updateSelectedParams("length", v)} />
                  </Section>

                  <Section title="Parámetros de hélice / rosca">
                    <NumberControl label="Paso (pitch)" value={p!.pitch} min={0.2} max={50} step={0.05} tooltip="Distancia axial de una espira completa." onChange={(v) => updateSelectedParams("pitch", v)} />
                    <NumberControl label={t!.includes("spring") ? "Grosor del alambre" : "Grosor del filete"} value={p!.wireThickness} min={0.1} max={20} step={0.05} onChange={(v) => updateSelectedParams("wireThickness", v)} />
                    {(t === "auger" || t!.includes("spring")) && (
                      <NumberControl label="Pala (ancho perfil)" value={p!.flightWidth} min={0.2} max={80} step={0.1} onChange={(v) => updateSelectedParams("flightWidth", v)} />
                    )}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Entradas (multi-start)</label>
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
                      <label className="text-xs font-medium text-muted-foreground">Dirección hélice</label>
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

                  {(t === "screw" || t === "nut" || t === "threaded-cap" || t === "threaded-cylinder") && (
                    <Section title="Rosca">
                      <Select value={p!.threadForm ?? "metric"} onValueChange={(v) => updateSelectedParams("threadForm", v as "metric" | "acme")}>
                        <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="metric">Métrica (triangular)</SelectItem>
                          <SelectItem value="acme">ACME / Trapezoidal</SelectItem>
                        </SelectContent>
                      </Select>
                    </Section>
                  )}

                  {t === "screw" && (
                    <Section title="Cabeza y cuerpo">
                      <Select value={p!.headType ?? "hex"} onValueChange={(v) => updateSelectedParams("headType", v as "hex" | "socket" | "button")}>
                        <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hex">Hexagonal</SelectItem>
                          <SelectItem value="socket">Allen (cilíndrica)</SelectItem>
                          <SelectItem value="button">Botón</SelectItem>
                        </SelectContent>
                      </Select>
                      <NumberControl label="Diámetro cabeza" value={p!.headDiameter ?? 13} min={2} max={100} step={0.1} onChange={(v) => updateSelectedParams("headDiameter", v)} />
                      <NumberControl label="Altura cabeza" value={p!.headHeight ?? 5} min={0.5} max={50} step={0.1} onChange={(v) => updateSelectedParams("headHeight", v)} />
                      <NumberControl label="Longitud rosca" value={p!.threadLength ?? p!.length} min={0} max={500} step={0.5} onChange={(v) => updateSelectedParams("threadLength", v)} />
                    </Section>
                  )}

                  {t === "nut" && (
                    <Section title="Tuerca">
                      <div className="flex gap-1">
                        {(["hex", "square"] as const).map((s) => (
                          <button key={s} onClick={() => updateSelectedParams("nutShape", s)}
                            className={`flex-1 rounded border py-1 text-xs transition-colors ${p!.nutShape === s ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                            {s === "hex" ? "Hexagonal" : "Cuadrada"}
                          </button>
                        ))}
                      </div>
                      <NumberControl label="Altura tuerca" value={p!.nutHeight ?? 6.5} min={1} max={80} step={0.1} onChange={(v) => updateSelectedParams("nutHeight", v)} />
                      <NumberControl label="Entrecaras" value={p!.headDiameter ?? 13} min={2} max={100} step={0.1} onChange={(v) => updateSelectedParams("headDiameter", v)} />
                    </Section>
                  )}

                  {t === "auger" && (
                    <>
                      <Section title="Sinfín">
                        <NumberControl label="Diámetro eje" value={p!.shaftDiameter ?? 10} min={1} max={100} step={0.1} onChange={(v) => updateSelectedParams("shaftDiameter", v)} />
                        <NumberControl label="Espesor pala" value={p!.flightThickness ?? 2} min={0.4} max={20} step={0.1} onChange={(v) => updateSelectedParams("flightThickness", v)} />
                      </Section>
                      <Section title="Refuerzo / Fillet">
                        <Select value={p!.filletType ?? "none"} onValueChange={(v) => updateSelectedParams("filletType", v as "none" | "circular" | "triangular" | "rounded")}>
                          <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Ninguno</SelectItem>
                            <SelectItem value="circular">Fillet circular</SelectItem>
                            <SelectItem value="triangular">Triangular (rib)</SelectItem>
                            <SelectItem value="rounded">Redondeado suave</SelectItem>
                          </SelectContent>
                        </Select>
                        <NumberControl label="Radio de refuerzo" value={p!.filletRadius ?? 0} min={0} max={Math.max(1, (p!.flightWidth ?? 10) * 0.9)} step={0.1}
                          tooltip="Añade material de refuerzo entre el eje y la pala."
                          onChange={(v) => updateSelectedParams("filletRadius", v)} />
                        <NumberControl label="Altura del refuerzo" value={p!.filletHeight ?? p!.filletRadius ?? 0} min={0} max={Math.max(1, (p!.flightThickness ?? 2) * 4)} step={0.1}
                          onChange={(v) => updateSelectedParams("filletHeight", v)} />
                      </Section>
                    </>
                  )}

                  {t === "threaded-cap" && (
                    <Section title="Tapa">
                      <NumberControl label="Espesor pared" value={p!.wallThickness ?? 2} min={0.5} max={20} step={0.1} onChange={(v) => updateSelectedParams("wallThickness", v)} />
                      <div className="flex gap-1">
                        {[true, false].map((b) => (
                          <button key={String(b)} onClick={() => updateSelectedParams("hasHexGrip", b)}
                            className={`flex-1 rounded border py-1 text-xs transition-colors ${p!.hasHexGrip === b ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                            {b ? "Agarre hex" : "Liso"}
                          </button>
                        ))}
                      </div>
                    </Section>
                  )}

                  {t === "threaded-cylinder" && (
                    <Section title="Cilindro">
                      <div className="flex gap-1">
                        {[true, false].map((b) => (
                          <button key={String(b)} onClick={() => updateSelectedParams("hollow", b)}
                            className={`flex-1 rounded border py-1 text-xs transition-colors ${p!.hollow === b ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                            {b ? "Tubo" : "Macizo"}
                          </button>
                        ))}
                      </div>
                    </Section>
                  )}

                  {t!.includes("spring") && (
                    <Section title="Extremos del muelle">
                      <Select value={p!.springEnds ?? "closed"} onValueChange={(v) => updateSelectedParams("springEnds", v as "open" | "closed" | "closed-ground")}>
                        <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Abiertos</SelectItem>
                          <SelectItem value="closed">Cerrados</SelectItem>
                          <SelectItem value="closed-ground">Cerrados y rectificados</SelectItem>
                        </SelectContent>
                      </Select>
                    </Section>
                  )}

                  <Section title="Avanzado">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">Resolución de malla</label>
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
                <Button key={v} variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => viewerRef.current?.setView(v)}>
                  {["Frontal", "Lateral", "Superior", "Iso"][i]}
                </Button>
              ))}
              <Button variant="secondary" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => viewerRef.current?.setView("fit")}>
                <Focus className="h-3 w-3" /> Ajustar todo
              </Button>
              {selected && (
                <Button variant="secondary" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => viewerRef.current?.focusOn(selected.id)}>
                  <Focus className="h-3 w-3" /> Focus pieza
                </Button>
              )}
            </div>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-1">
              {(["solid", "wireframe", "transparent"] as const).map((m) => (
                <Toggle key={m} pressed={viewMode === m} onPressedChange={() => setViewMode(m)} size="sm" className="h-7 px-2 text-xs data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
                  {m === "solid" ? "Sólido" : m === "wireframe" ? "Wire" : "Trans"}
                </Toggle>
              ))}
            </div>
            <Separator orientation="vertical" className="h-6" />
            <Select value={material} onValueChange={(v) => setMaterial(v as MaterialPreset)}>
              <SelectTrigger className="h-7 w-[110px] bg-input text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="steel">Acero</SelectItem>
                <SelectItem value="aluminum">Aluminio</SelectItem>
                <SelectItem value="brass">Latón</SelectItem>
              </SelectContent>
            </Select>
            <Separator orientation="vertical" className="h-6" />
            <Toggle pressed={showGrid} onPressedChange={setShowGrid} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"><Grid3x3 className="h-3.5 w-3.5" /></Toggle>
            <Toggle pressed={showAxes} onPressedChange={setShowAxes} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"><Ruler className="h-3.5 w-3.5" /></Toggle>
            <Toggle pressed={autoRotate} onPressedChange={setAutoRotate} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"><Play className="h-3.5 w-3.5" /></Toggle>
            <Toggle pressed={clipEnabled} onPressedChange={setClipEnabled} size="sm" className="h-7 gap-1 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
              <Scissors className="h-3.5 w-3.5" /> Sección
            </Toggle>
            {clipEnabled && (
              <div className="flex w-40 items-center gap-2">
                <Slider value={[clipPos]} min={-100} max={100} step={0.5} onValueChange={(v) => setClipPos(v[0])} />
                <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">{clipPos.toFixed(1)}</span>
              </div>
            )}
            <div className="ml-auto text-[10px] text-muted-foreground">
              Clic sobre una pieza para seleccionarla · doble-clic en la lista → focus
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <Viewer3D ref={viewerRef} onPick={(id) => setSelectedId(id)} />
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
                <Section title="Validación">
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

              <Section title="Exportar rápido">
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

              <Section title="Historial">
                {history.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Aún no has exportado piezas.</p>
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
