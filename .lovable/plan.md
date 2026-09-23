# Multi-idioma en HelixForge (español e inglés, ampliable)

## Objetivo

Toda la interfaz visible (títulos, botones, nombres de piezas, etiquetas de
parámetros, tooltips, mensajes de validación, avisos y textos de exportación)
pasa a estar disponible en español e inglés, con un sistema preparado para
añadir más idiomas con solo crear un archivo nuevo.

## Cómo lo verá el usuario

- Un selector de idioma en la barra superior (junto al logo HelixForge), con
  bandera/código: ES · EN.
- Al abrir la app por primera vez se usa el idioma del navegador; si no es
  español ni inglés, se usa inglés. La elección se guarda y se recuerda entre
  sesiones.
- El cambio es instantáneo, sin recargar, y no afecta a las piezas ni a la
  escena 3D.

## Decisiones de contenido

- Los nombres de archivo exportados (STL/OBJ/GLB) se mantienen sin acentos y
  con los identificadores técnicos actuales, para que sean seguros en
  cualquier sistema.
- Los archivos JSON de proyecto guardan identificadores internos (no texto
  traducido), así un proyecto creado en español se abre correctamente en
  inglés.
- Las notas escritas por el usuario nunca se traducen.

## Detalles técnicos

**Archivos de idioma**

- `src/i18n/locales/es.json` y `src/i18n/locales/en.json`, con claves
  anidadas por área: `app`, `parts`, `params`, `tooltips`, `viewer`,
  `assembly`, `export`, `validation`, `presets`, `notes`.
- `src/i18n/index.ts`: lista de idiomas disponibles, tipo `Locale` derivado de
  las claves de `en.json` para que falte texto sea un error de tipado.

**Motor de traducción (sin dependencias nuevas)**

- `src/i18n/I18nProvider.tsx`: contexto React con `locale`, `setLocale` y
  `t(key, vars?)`. Resolución por ruta de clave, interpolación `{{valor}}`,
  y fallback a inglés si falta una clave.
- Persistencia en `localStorage` bajo `helixforge:locale`; lectura dentro de
  `useEffect` para evitar desajustes de hidratación en SSR.
- El proveedor envuelve la app en `src/routes/__root.tsx`; se actualiza el
  atributo `lang` del documento.

**Migración de textos**

1. `src/routes/index.tsx` (la mayor parte): cabecera, selector de tipo de
   pieza, secciones de parámetros, etiquetas de `NumberControl`, tooltips,
   opciones de los desplegables, panel de piezas, panel de información y
   métricas de malla, diálogos de import/export, mensajes `toast`.
2. `src/components/Viewer3D.tsx`: etiquetas de ejes, vistas, ayudas.
3. Mensajes de validación y diagnóstico generados en la lógica de piezas:
   devuelven una clave (`validation.tube.crossedPlanes`) más parámetros, y la
   interfaz los traduce al mostrarlos. Así la lógica queda sin texto fijo.
4. `src/routes/__root.tsx`: páginas de error y "no encontrado"; metadatos
   `head()` de la ruta principal en inglés con descripción propia.

**Añadir un idioma en el futuro**

Copiar `en.json`, traducirlo, y registrarlo en la lista de `src/i18n/index.ts`
(código, nombre nativo). No hace falta tocar componentes.

## Verificación

- Typecheck limpio.
- Revisión en el navegador: cambiar entre ES y EN y comprobar cabecera,
  parámetros de al menos tres tipos de pieza (tapa, cilindro, sinfín),
  panel del visor, mensajes de validación y exportación.
- Comprobar que el idioma se conserva al recargar.
