# Vikingo Paintball — web

Portada 3D interactiva (disparas a los carteles para navegar) y contenido 100 % editable desde la propia web.

Cada sección es un lugar del escenario: al acertar en un cartel la cámara viaja hasta allí y la página aparece con fondo transparente sobre el 3D.

| Sección | Lugar del escenario |
|---|---|
| Reservas | Casa larga vikinga con mesa, farol y libro de reservas |
| Juegos | Vista aérea del campo, banderas de equipo y entrada al fuerte |
| Tienda | Puesto de mercado con marcadoras expuestas y cajas de bolas |
| Ranking | Podio con trofeos, estandarte con el logo y antorchas |

Las posiciones de cámara de cada estación están en `STATIONS` dentro de `public/js/scene.js`.

El fondo del escenario es la foto `public/img/fondo-bosque.jpg` (pinar al atardecer), colocada como panorama curvo. La niebla, el cielo, el musgo y la luz dorada a contraluz usan sus colores. Se ajusta en `BACKDROP` dentro de `public/js/scene.js` (amplitud, altura del horizonte y posición del sol).

Cada pocos segundos un jugador en silueta cruza corriendo entre los árboles (uno a la vez), en `public/js/runners.js`. Su animación es `public/img/corredor-sheet.webp`; el recorrido se elige para que se vea desde la cámara actual. Unos cruzan de lado y otros avanzan en diagonal hacia la cámara: crecen al acercarse y, en la portada, disparan ráfagas cuyas bolas revientan en la pantalla (`public/js/screen-splats.js`).

La bruma en movimiento y los rayos de sol entre los árboles están en `public/js/atmosphere.js` (cantidad, tamaño, color y opacidad). Solo aparecen en las zonas de árboles; el campo y las estaciones quedan despejados.

## Arrancar

```bash
npm install
npm start          # http://localhost:3000
```

La primera vez se crea la contraseña de administrador **`vikingo`** (o la que indiques con la variable `ADMIN_PASSWORD` antes del primer arranque). Cámbiala desde la web: **Admin → Contraseña**.

## Editar la web

1. Pulsa el candado (abajo a la izquierda) o entra en `/#/admin` e introduce la contraseña.
2. Activa **Editar** en la barra superior.
3. Abre cualquier sección (disparando al cartel o con las pestañas) y edita directamente:
   - **Título y subtítulo**: haz clic y escribe.
   - **Imagen de fondo** de la cabecera y **texto del cartel 3D**: botones arriba a la izquierda.
   - **Bloques**: «Añadir bloque» entre bloques. Cada bloque se puede subir, bajar, duplicar o borrar.
4. **Guardar** (o Ctrl+S). «Descartar» vuelve a la última versión guardada.

**Ajustes del sitio**: logo (aparece en el escudo 3D), nombre, textos de los 4 carteles, texto de ayuda de la portada y descripción para Google.

### Tipos de bloque

| Bloque | Para qué |
|---|---|
| Texto | Editor enriquecido: títulos, negrita, colores, alineación, listas, citas, **enlaces**, imágenes y vídeos incrustados |
| Imagen | Subida o URL, pie de foto, ancho (normal / ancho / pantalla completa), enlace opcional |
| Vídeo | Subida MP4/WebM o enlace de YouTube/Vimeo; opción de reproducción automática en bucle |
| Galería | Varias fotos con ampliación al hacer clic |
| Tarjetas | Packs, modos de juego, productos: imagen, etiqueta/precio, título, texto y botón |
| Tabla / Ranking | Celdas editables, ordenar por columna, podio destacado, **pegar desde Excel** |
| Botón | Llamada a la acción (WhatsApp, teléfono, otra sección…) |
| Formulario de reserva | Las solicitudes llegan a **Admin → Reservas** (cambiar estado, WhatsApp, exportar CSV) |

Enlaces internos: usa `#/reservas`, `#/juegos`, `#/tienda`, `#/ranking`.

## Dónde se guarda todo

- `data/content.json`: todo el contenido (cada guardado deja una copia en `data/backups/`, últimas 30).
- `data/reservas.json`: solicitudes de reserva.
- `data/auth.json`: contraseña (cifrada con scrypt).
- `public/uploads/`: imágenes y vídeos subidos (máx. 300 MB por archivo).

Al publicarla, el hosting necesita **Node.js 18+** y que las carpetas `data/` y `public/uploads/` sean persistentes (VPS, Railway/Render con disco persistente, etc.). Usa HTTPS para que la contraseña no viaje en claro.

## Estructura

```
server.js                 API (contenido, login, subidas, reservas) + estáticos
server/default-content.js contenido inicial
public/index.html
public/css/style.css
public/js/main.js         arranque y rutas (#/seccion)
public/js/scene.js        escena 3D (Three.js): campo, marcadora, carteles, disparos
public/js/sections.js     render de secciones
public/js/blocks.js       tipos de bloque (vista + edición, Quill)
public/js/admin.js        barra de admin, ajustes, reservas, contraseña
public/js/store.js        estado y llamadas a la API
public/js/audio.js        sonidos sintetizados (WebAudio)
public/js/ui.js           utilidades (modales, toasts, iconos)
```
