import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  Cog,
  Bolt,
  Nut,
  CircleDot,
  Package,
  Cylinder,
  Waves,
  Download,
  RotateCw,
  Grid3x3,
  Ruler,
  Scissors,
  Play,
  Sparkles,
  History,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Toaster, toast } from "sonner";
import { Viewer3D, type ViewerHandle, type MaterialPreset, type ViewMode } from "@/components/Viewer3D";
import { NumberControl } from "@/components/NumberControl";
import {
  buildPart,
  DEFAULT_PARAMS,
  PRESETS,
  type PartParams,
  type PartType,
} from "@/lib/part-builders";
import { exportSTLBinary, exportOBJ, downloadBlob } from "@/lib/stl-exporter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HelixForge — Generador STL de piezas mecánicas paramétricas" },
      {
        name: "description",
        content:
          "Genera modelos STL 3D paramétricos de muelles, tornillos, tuercas, sinfines y tapas roscadas listos para impresión 3D.",
      },
      { property: "og:title", content: "HelixForge — Modelador paramétrico de piezas helicoidales" },
      { property: "og:description", content: "Diseña y exporta piezas mecánicas roscadas y helicoidales en STL." },
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

interface HistoryEntry {
  id: string;
  type: PartType;
  name: string;
  params: PartParams;
  at: number;
}

function HelixForge() {
  const [partType, setPartType] = useState<PartType>("screw");
  const [params, setParams] = useState<PartParams>(DEFAULT_PARAMS.screw);
  const [material, setMaterial] = useState<MaterialPreset>("steel");
  const [viewMode, setViewMode] = useState<ViewMode>("solid");
  const [autoRotate, setAutoRotate] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipPos, setClipPos] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const viewerRef = useRef<ViewerHandle>(null);

  // Load history
  useEffect(() => {
    try {
      const raw = localStorage.getItem("helixforge:history");
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);

  // Switch part type -> load default params
  const changePartType = (t: PartType) => {
    setPartType(t);
    setParams(DEFAULT_PARAMS[t]);
  };

  // Rebuild part when params change
  useEffect(() => {
    if (!viewerRef.current) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8bfc7, metalness: 0.9, roughness: 0.35 });
    const group = buildPart(partType, params, mat);
    viewerRef.current.setPart(group);
  }, [partType, params]);

  useEffect(() => viewerRef.current?.setMaterial(material), [material]);
  useEffect(() => viewerRef.current?.setViewMode(viewMode), [viewMode]);
  useEffect(() => viewerRef.current?.setAutoRotate(autoRotate), [autoRotate]);
  useEffect(() => viewerRef.current?.setGridVisible(showGrid), [showGrid]);
  useEffect(() => viewerRef.current?.setAxesVisible(showAxes), [showAxes]);
  useEffect(() => viewerRef.current?.setClipEnabled(clipEnabled), [clipEnabled]);
  useEffect(() => viewerRef.current?.setClipPosition(clipPos), [clipPos]);

  const partLabel = PART_TYPES.find((p) => p.type === partType)!.label;

  // Validation
  const validation = useMemo(() => {
    const msgs: { level: "warn" | "error" | "ok"; text: string }[] = [];
    if (params.innerDiameter >= params.outerDiameter) {
      msgs.push({ level: "error", text: "El diámetro interior debe ser menor que el exterior." });
    }
    if (params.pitch <= 0) msgs.push({ level: "error", text: "El paso debe ser positivo." });
    if (params.pitch < params.wireThickness && (partType.includes("spring"))) {
      msgs.push({ level: "warn", text: "El paso es menor que el grosor del alambre: espiras pueden solaparse." });
    }
    if (partType === "screw" && (params.threadLength ?? 0) > params.length) {
      msgs.push({ level: "warn", text: "La longitud de rosca supera la del tornillo." });
    }
    if (params.resolution < 24) msgs.push({ level: "warn", text: "Resolución baja: la rosca puede verse facetada." });
    if (msgs.length === 0) msgs.push({ level: "ok", text: "Parámetros válidos." });
    return msgs;
  }, [params, partType]);

  const stats = useMemo(() => {
    const g = viewerRef.current?.getPartGroup();
    if (!g) return null;
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    let tris = 0;
    g.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        const geom = m.geometry;
        const idx = geom.index;
        tris += idx ? idx.count / 3 : (geom.attributes.position?.count ?? 0) / 3;
      }
    });
    return { size, tris: Math.round(tris) };
  }, [params, partType]);

  const buildFileName = (ext: string) => {
    const parts = [partType.replace(/-/g, "_"), `d${params.outerDiameter}`, `p${params.pitch}`, `s${params.starts}`, `l${params.length}`];
    return `${parts.join("_")}.${ext}`;
  };

  const pushHistory = useCallback(
    (name: string) => {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        type: partType,
        name,
        params,
        at: Date.now(),
      };
      const next = [entry, ...history].slice(0, 10);
      setHistory(next);
      localStorage.setItem("helixforge:history", JSON.stringify(next));
    },
    [partType, params, history]
  );

  const doExport = (fmt: "stl" | "obj") => {
    const g = viewerRef.current?.getPartGroup();
    if (!g) return;
    const filename = buildFileName(fmt);
    const blob = fmt === "stl" ? exportSTLBinary(g) : exportOBJ(g);
    downloadBlob(blob, filename);
    pushHistory(filename);
    toast.success(`Exportado ${filename}`, { description: `${(blob.size / 1024).toFixed(1)} KB` });
  };

  const loadPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPartType(preset.type);
    setParams({ ...DEFAULT_PARAMS[preset.type], ...preset.params });
    toast(`Preset cargado: ${preset.name}`);
  };

  const update = <K extends keyof PartParams>(key: K, v: PartParams[K]) =>
    setParams((p) => ({ ...p, [key]: v }));

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
              HelixForge <span className="ml-1 text-[10px] font-normal text-muted-foreground">v1.0</span>
            </h1>
            <p className="text-[11px] text-muted-foreground leading-none">Generador paramétrico de piezas helicoidales</p>
          </div>
          <Separator orientation="vertical" className="mx-2 h-6" />
          <Badge variant="outline" className="border-primary/50 text-primary">
            {partLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                Presets
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Piezas estándar</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PRESETS.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => loadPreset(p.id)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <Download className="h-3.5 w-3.5" />
                Exportar STL
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("stl")}>STL (binario)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("obj")}>OBJ</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Part selector */}
      <div className="shrink-0 border-b border-border bg-background/60 px-3 py-2">
        <div className="flex gap-2 overflow-x-auto">
          {PART_TYPES.map(({ type, label, short, Icon }) => {
            const active = type === partType;
            return (
              <button
                key={type}
                onClick={() => changePartType(type)}
                className={`group flex min-w-[130px] flex-col items-center gap-1.5 rounded-md border px-3 py-2 text-xs transition-all ${
                  active
                    ? "border-primary bg-primary/10 text-primary glow-primary"
                    : "border-border bg-panel/40 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
                title={label}
              >
                <Icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} />
                <span className="font-medium">{short}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel: parameters */}
        <aside className="w-[320px] shrink-0 border-r border-border bg-background/40">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              <Section title="Dimensiones principales">
                <NumberControl label="Diámetro exterior" value={params.outerDiameter} min={1} max={200} step={0.1} tooltip="Diámetro nominal exterior de la pieza." onChange={(v) => update("outerDiameter", v)} />
                <NumberControl label="Diámetro interior" value={params.innerDiameter} min={0} max={200} step={0.1} tooltip="Diámetro de raíz (roscas) o del hueco interior." onChange={(v) => update("innerDiameter", v)} />
                <NumberControl label="Longitud / Altura" value={params.length} min={1} max={500} step={0.5} tooltip="Longitud axial total de la pieza." onChange={(v) => update("length", v)} />
              </Section>

              <Section title="Parámetros de hélice / rosca">
                <NumberControl label="Paso (pitch)" value={params.pitch} min={0.2} max={50} step={0.05} tooltip="Distancia axial que avanza una espira completa." onChange={(v) => update("pitch", v)} />
                <NumberControl label={partType.includes("spring") ? "Grosor del alambre" : "Grosor del filete"} value={params.wireThickness} min={0.1} max={20} step={0.05} tooltip="Diámetro del alambre (muelles) o altura del filete (roscas)." onChange={(v) => update("wireThickness", v)} />
                {(partType === "auger" || partType.includes("spring")) && (
                  <NumberControl label="Pala (ancho perfil)" value={params.flightWidth} min={0.2} max={80} step={0.1} tooltip="Ancho radial de la pala helicoidal (importante en sinfines)." onChange={(v) => update("flightWidth", v)} />
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Entradas (multi-start)</label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => update("starts", n)}
                        className={`flex-1 rounded border py-1 text-xs font-mono transition-colors ${
                          params.starts === n
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-border bg-input text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {n}×
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Dirección hélice</label>
                  <div className="flex gap-1">
                    {(["right", "left"] as const).map((h) => (
                      <button
                        key={h}
                        onClick={() => update("handed", h)}
                        className={`flex-1 rounded border py-1 text-xs transition-colors ${
                          params.handed === h ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {h === "right" ? "Derecha ↻" : "Izquierda ↺"}
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              {(partType === "screw" || partType === "nut" || partType === "threaded-cap" || partType === "threaded-cylinder") && (
                <Section title="Rosca">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Perfil de rosca</label>
                    <Select value={params.threadForm ?? "metric"} onValueChange={(v) => update("threadForm", v as "metric" | "acme")}>
                      <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="metric">Métrica (triangular)</SelectItem>
                        <SelectItem value="acme">ACME / Trapezoidal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </Section>
              )}

              {partType === "screw" && (
                <Section title="Cabeza y cuerpo">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Tipo de cabeza</label>
                    <Select value={params.headType ?? "hex"} onValueChange={(v) => update("headType", v as "hex" | "socket" | "button")}>
                      <SelectTrigger className="h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hex">Hexagonal</SelectItem>
                        <SelectItem value="socket">Allen (cilíndrica)</SelectItem>
                        <SelectItem value="button">Botón</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberControl label="Diámetro cabeza" value={params.headDiameter ?? 13} min={2} max={100} step={0.1} onChange={(v) => update("headDiameter", v)} />
                  <NumberControl label="Altura cabeza" value={params.headHeight ?? 5} min={0.5} max={50} step={0.1} onChange={(v) => update("headHeight", v)} />
                  <NumberControl label="Longitud rosca" value={params.threadLength ?? params.length} min={0} max={500} step={0.5} tooltip="Longitud roscada; el resto será liso." onChange={(v) => update("threadLength", v)} />
                </Section>
              )}

              {partType === "nut" && (
                <Section title="Tuerca">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Forma</label>
                    <div className="flex gap-1">
                      {(["hex", "square"] as const).map((s) => (
                        <button key={s} onClick={() => update("nutShape", s)} className={`flex-1 rounded border py-1 text-xs transition-colors ${params.nutShape === s ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                          {s === "hex" ? "Hexagonal" : "Cuadrada"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <NumberControl label="Altura tuerca" value={params.nutHeight ?? 6.5} min={1} max={80} step={0.1} onChange={(v) => update("nutHeight", v)} />
                  <NumberControl label="Entrecaras" value={params.headDiameter ?? 13} min={2} max={100} step={0.1} tooltip="Distancia entre caras opuestas (llave)." onChange={(v) => update("headDiameter", v)} />
                </Section>
              )}

              {partType === "auger" && (
                <Section title="Sinfín">
                  <NumberControl label="Diámetro eje" value={params.shaftDiameter ?? 10} min={1} max={100} step={0.1} onChange={(v) => update("shaftDiameter", v)} />
                  <NumberControl label="Espesor pala" value={params.flightThickness ?? 2} min={0.4} max={20} step={0.1} onChange={(v) => update("flightThickness", v)} />
                </Section>
              )}

              {partType === "threaded-cap" && (
                <Section title="Tapa">
                  <NumberControl label="Espesor pared" value={params.wallThickness ?? 2} min={0.5} max={20} step={0.1} onChange={(v) => update("wallThickness", v)} />
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Agarre exterior hexagonal</label>
                    <div className="flex gap-1">
                      {[true, false].map((b) => (
                        <button key={String(b)} onClick={() => update("hasHexGrip", b)} className={`flex-1 rounded border py-1 text-xs transition-colors ${params.hasHexGrip === b ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                          {b ? "Sí" : "No"}
                        </button>
                      ))}
                    </div>
                  </div>
                </Section>
              )}

              {partType === "threaded-cylinder" && (
                <Section title="Cilindro">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Hueco interior</label>
                    <div className="flex gap-1">
                      {[true, false].map((b) => (
                        <button key={String(b)} onClick={() => update("hollow", b)} className={`flex-1 rounded border py-1 text-xs transition-colors ${params.hollow === b ? "border-primary bg-primary/20 text-primary" : "border-border bg-input text-muted-foreground hover:border-primary/50"}`}>
                          {b ? "Tubo" : "Macizo"}
                        </button>
                      ))}
                    </div>
                  </div>
                </Section>
              )}

              {partType.includes("spring") && (
                <Section title="Extremos del muelle">
                  <Select value={params.springEnds ?? "closed"} onValueChange={(v) => update("springEnds", v as "open" | "closed" | "closed-ground")}>
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
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Resolución de malla</label>
                    <span className="text-xs font-mono text-primary">{params.resolution}</span>
                  </div>
                  <Slider value={[params.resolution]} min={12} max={128} step={4} onValueChange={(v) => update("resolution", v[0])} />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Baja</span><span>Media</span><span>Alta</span>
                  </div>
                </div>
              </Section>
            </div>
          </ScrollArea>
        </aside>

        {/* Center: 3D viewer + toolbars */}
        <main className="relative flex min-w-0 flex-1 flex-col p-3">
          {/* Viewer toolbar */}
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel/60 p-2 text-xs">
            <div className="flex items-center gap-1">
              {(["front", "side", "top", "iso"] as const).map((v, i) => (
                <Button key={v} variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => viewerRef.current?.setView(v)}>
                  {["Frontal", "Lateral", "Superior", "Iso"][i]}
                </Button>
              ))}
              <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={() => viewerRef.current?.setView("fit")}>
                Ajustar
              </Button>
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
            <Toggle pressed={showGrid} onPressedChange={setShowGrid} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
              <Grid3x3 className="h-3.5 w-3.5" />
            </Toggle>
            <Toggle pressed={showAxes} onPressedChange={setShowAxes} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
              <Ruler className="h-3.5 w-3.5" />
            </Toggle>
            <Toggle pressed={autoRotate} onPressedChange={setAutoRotate} size="sm" className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
              <Play className="h-3.5 w-3.5" />
            </Toggle>
            <Toggle pressed={clipEnabled} onPressedChange={setClipEnabled} size="sm" className="h-7 gap-1 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
              <Scissors className="h-3.5 w-3.5" />
              Sección
            </Toggle>
            {clipEnabled && (
              <div className="flex w-40 items-center gap-2">
                <Slider value={[clipPos]} min={-60} max={60} step={0.5} onValueChange={(v) => setClipPos(v[0])} />
                <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">{clipPos.toFixed(1)}</span>
              </div>
            )}
            <div className="ml-auto text-[10px] text-muted-foreground">
              Atajos: <kbd className="rounded border border-border bg-input px-1">1-4</kbd> vistas · <kbd className="rounded border border-border bg-input px-1">F</kbd> ajustar
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <Viewer3D ref={viewerRef} />
          </div>
        </main>

        {/* Right panel */}
        <aside className="w-[280px] shrink-0 border-l border-border bg-background/40">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              <Section title="Información de la pieza">
                <div className="space-y-1.5 text-xs">
                  {stats && (
                    <>
                      <Row k="Bounding X" v={`${stats.size.x.toFixed(2)} mm`} />
                      <Row k="Bounding Y" v={`${stats.size.y.toFixed(2)} mm`} />
                      <Row k="Bounding Z" v={`${stats.size.z.toFixed(2)} mm`} />
                      <Row k="Triángulos" v={stats.tris.toLocaleString()} />
                    </>
                  )}
                  <Row k="Entradas rosca" v={`${params.starts}×`} />
                  <Row k="Avance / vuelta" v={`${(params.pitch * params.starts).toFixed(2)} mm`} />
                </div>
              </Section>

              <Section title="Validación">
                <div className="space-y-1.5">
                  {validation.map((v, i) => (
                    <div
                      key={i}
                      className={`rounded border p-2 text-[11px] ${
                        v.level === "error"
                          ? "border-destructive/50 bg-destructive/10 text-destructive"
                          : v.level === "warn"
                          ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                          : "border-primary/40 bg-primary/10 text-primary"
                      }`}
                    >
                      {v.text}
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Exportar">
                <Button className="w-full justify-start gap-2 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => doExport("stl")}>
                  <Download className="h-4 w-4" />
                  STL binario
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2" onClick={() => doExport("obj")}>
                  <Download className="h-4 w-4" />
                  OBJ
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Nombre: <span className="font-mono text-foreground/80">{buildFileName("stl")}</span>
                </p>
              </Section>

              <Section title="Historial">
                {history.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Aún no has exportado piezas.</p>
                ) : (
                  <div className="space-y-1">
                    {history.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => {
                          setPartType(h.type);
                          setParams(h.params);
                          toast(`Cargado: ${h.name}`);
                        }}
                        className="flex w-full items-start gap-2 rounded border border-border bg-input/50 p-2 text-left transition-colors hover:border-primary/50 hover:bg-input"
                      >
                        <History className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[10px] text-foreground">{h.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(h.at).toLocaleString()}
                          </div>
                        </div>
                      </button>
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

// Suppress unused warnings for imports kept for future use
void Card;
void CircleDot;
