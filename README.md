# HelixForge

Crea una webapp moderna y profesional llamada **HelixForge** para generar modelos STL 3D paramétricos de piezas mecánicas basadas en rotación helicoidal clásica (muelles, roscas, tornillos, sinfines y tapas).

La aplicación está pensada para makers, diseñadores industriales e ingenieros que necesitan generar piezas listas para impresión 3D de forma rápida y precisa.

### Tipos de piezas que debe soportar (con selector visual en la parte superior):

1. **Muelle de compresión**

2. **Muelle de torsión**

3. **Tornillo / Bulón** (con cabeza)

4. **Tuerca** (hexagonal y cuadrada)

5. **Tornillo sinfín / Sinfín de transporte** (con pala helicoidal)

6. **Tapa / Tapón roscado** (con rosca interior)

7. **Cilindro / Tubo roscado** (rosca exterior + interior opcional)

### Interfaz de usuario (UI/UX):

- **Diseño moderno tipo herramienta de ingeniería**: tema oscuro profesional, acentos en cyan/teal, tipografía limpia.

- **Layout**:

  - Barra superior con logo "HelixForge", nombre de la pieza actual y botones de acción.

  - Selector de tipo de pieza en la parte superior (cards horizontales o tabs con iconos).

  - **Panel izquierdo**: Controles paramétricos organizados en secciones (Dimensiones principales, Parámetros de hélice/rosca, Opciones de extremos, Avanzado).

  - **Centro**: Visor 3D grande e interactivo (Three.js + OrbitControls).

  - **Panel derecho** (o colapsable): Información de la pieza (volumen, medidas clave, alertas de validación) + botones de exportación.

### Visor 3D Avanzado (muy importante):

El visor 3D debe ser **altamente avanzado, intuitivo y fácil de navegar**:

- Controles completos de cámara (OrbitControls mejorados): rotación suave, zoom con rueda + pinch, paneo, y atajos de teclado.

- **Escalas y mediciones en 3D**: mostrar ejes XYZ con marcas de escala en milímetros (regla dinámica visible), opción para activar rejilla de referencia y mediciones de distancia.

- Botones de vista rápida: Vista Frontal, Lateral, Superior, Isométrica y "Ajustar a objeto".

- Modo "Sección de corte" con plano ajustable (clip plane) para ver roscas interiores y estructura interna.

- Opciones visuales: Wireframe, Sólido, Transparente, y Material metálico PBR realista (acero, aluminio, etc.).

- Rotación automática opcional (slow spin) y botón para centrar/resetear vista.

- Alto rendimiento incluso con piezas complejas (buena optimización de geometría).

### Parámetros configurables (deben aparecer según el tipo de pieza seleccionado):

**Parámetros comunes a la mayoría de piezas:**

- Diámetro exterior (mm)

- Diámetro interior (mm)

- Paso / Pitch (mm)

- Espesor / Diámetro del alambre o grosor del filete (mm)

- **Pala** (altura o ancho del perfil helicoidal / flight width) — especialmente importante en sinfines y muelles de lámina

- Longitud / Altura total (mm)

- Número de espiras / vueltas

- **Número de entradas / Multi-start** (1, 2, 3 o más roscas paralelas) — muy importante

- Dirección de la hélice: Derecha o Izquierda

- Resolución de la malla (segmentos por vuelta) — slider de baja/media/alta

**Parámetros específicos por tipo:**

- **Muelle**: Tipo de extremos (abiertos, cerrados, cerrados y rectificados), diámetro medio del muelle

- **Tornillo**: Tipo de cabeza (Hexagonal, Allen/Cilíndrica, Botón, etc.), longitud de rosca vs parte lisa, tipo de punta

- **Tuerca**: Altura de la tuerca, si tiene chaflán o arandela integrada

- **Tornillo sinfín**: Ancho de pala, espesor de pala

- **Tapa roscada**: Altura de la tapa, tipo de rosca interior (métrica, ACME, etc.), si tiene hexágono exterior para llave, espesor de pared

- **Relleno / Hueco**: Opción de hacer la pieza maciza o hueca con diámetro interior adicional

Todos los parámetros deben tener sliders + inputs numéricos sincronizados, rangos lógicos y validación en tiempo real.

### Funcionalidades clave:

- Generación procedural de geometría usando Three.js (helices, perfiles de rosca triangulares/trapezoidales, extrusiones helicoidales, restas booleanas para roscas interiores). Soporte completo para roscas multi-start.

- Botón principal **"Exportar STL"** con nombre inteligente (ej: `tornillo_m8_p125_2starts_l50.stl`).

- Posibilidad de exportar también en formato OBJ o GLB.

- **Presets** listos para cargar (Muelle estándar, Tornillo M8x1.25, Tuerca DIN 934, Sinfín de 20mm, Tapa M20, etc.).

- Sistema de validación con mensajes claros.

- Historial de las últimas piezas generadas (localStorage).

- Tooltips explicativos en cada parámetro.

La app debe ser completamente funcional, con actualizaciones del visor 3D fluidas y de alto rendimiento.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3f58d0ac-6315-40ab-828c-e303855b2a0a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
