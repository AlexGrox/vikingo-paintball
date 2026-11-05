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

## Publicación (GitHub Pages)

La web publicada es la carpeta `public/`. En cada cambio de la rama `main` la automatización `.github/workflows/pages.yml` la vuelve a publicar en GitHub Pages (1-2 minutos).

Configuración (una vez):
1. Repositorio **público** (Settings → General → Change visibility).
2. **Settings → Pages → Source: GitHub Actions**.
3. Clave de edición: perfil → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → solo este repositorio, permiso **Contents: Read and write**.
4. Dominio propio (opcional): **Settings → Pages → Custom domain** y el registro DNS que indique GitHub.

### Editar la web publicada

1. Pulsa el candado (abajo a la izquierda) o entra en `#/admin` y pega la **clave de GitHub**. Se guarda solo en ese navegador.
2. Activa **Editar**, cambia lo que quieras y pulsa **Guardar** (o Ctrl+S).
3. El guardado se escribe en el repositorio (`public/content.json`, imágenes en `public/uploads/`) y la web se republica sola en 1-2 minutos.

Notas: archivos de hasta 25 MB (los vídeos, mejor en YouTube con un bloque Vídeo). En la web publicada no hay servidor, así que el bloque de reservas muestra botones de **WhatsApp y llamada** (se configuran en Ajustes del sitio). La base de datos de reservas y ranking queda pendiente.

## Probar en el PC (servidor local)

```bash
npm install
npm start          # http://localhost:3000
```

Con el servidor local la web funciona con contraseña de administrador (la primera vez es **`vikingo`**, o la indicada en `ADMIN_PASSWORD`), formulario de reservas y subida de vídeos grandes. Los cambios se guardan en `public/content.json`: para publicarlos, haz commit y push.

## Editar el contenido

1. Inicia sesión y activa **Editar** en la barra superior.
2. Abre cualquier sección (disparando al cartel o con las pestañas) y edita directamente:
   - **Título y subtítulo**: haz clic y escribe.
   - **Imagen de fondo** de la cabecera y **texto del cartel 3D**: botones arriba a la izquierda.
   - **Bloques**: «Añadir bloque» entre bloques. Cada bloque se puede subir, bajar, duplicar o borrar.
3. **Guardar** (o Ctrl+S). «Descartar» vuelve a la última versión guardada.

**Ajustes del sitio**: logo (aparece en el escudo 3D), nombre, textos de los 4 carteles, texto de ayuda de la portada, descripción para Google, WhatsApp y teléfono.

### Tipos de bloque

| Bloque | Para qué |
|---|---|
| Texto | Editor enriquecido: títulos, negrita, colores, alineación, listas, citas, **enlaces**, imágenes y vídeos incrustados |
| Imagen | Subida o URL, pie de foto, ancho (normal / ancho / pantalla completa), enlace opcional |
| Vídeo | Enlace de YouTube/Vimeo (o archivo MP4/WebM); opción de reproducción automática en bucle |
| Galería | Varias fotos con ampliación al hacer clic |
| Tarjetas | Packs, modos de juego, productos: imagen, etiqueta/precio, título, texto y botón |
| Tabla / Ranking | Celdas editables, ordenar por columna, podio destacado, **pegar desde Excel** |
| Botón | Llamada a la acción (WhatsApp, teléfono, otra sección…) |
| Formulario de reserva | Web publicada: botones de WhatsApp y llamada. Servidor local: formulario con panel **Admin → Reservas** |

Enlaces internos: usa `#/reservas`, `#/juegos`, `#/tienda`, `#/ranking`.

## Dónde se guarda todo

- `public/content.json`: todo el contenido (se publica con la web).
- `public/uploads/`: imágenes y vídeos subidos.
- Solo con servidor local: `data/reservas.json` (reservas), `data/auth.json` (contraseña cifrada) y `data/backups/` (copias de cada guardado). No se suben al repositorio.

## Estructura

```
.github/workflows/pages.yml  publicación automática en GitHub Pages
server.js                    servidor local (contenido, login, subidas, reservas) + estáticos
server/default-content.js    contenido inicial
public/index.html
public/content.json          contenido editable
public/css/style.css
public/js/main.js            arranque y rutas (#/seccion)
public/js/scene.js           escena 3D (Three.js): campo, marcadora, carteles, disparos
public/js/props.js           neumáticos, bidones, barriles, cartón, paja
public/js/atmosphere.js      bruma y rayos de sol
public/js/runners.js         jugadores que cruzan y disparan
public/js/screen-splats.js   salpicaduras en la pantalla
public/js/sections.js        render de secciones
public/js/blocks.js          tipos de bloque (vista + edición, Quill)
public/js/admin.js           barra de admin, ajustes, reservas, contraseña
public/js/store.js           estado y guardado (servidor local o GitHub)
public/js/github.js          API de GitHub para guardar desde la web publicada
public/js/config.js          repositorio de GitHub y límites de subida
public/js/audio.js           sonidos sintetizados (WebAudio)
public/js/ui.js              utilidades (modales, toasts, iconos)
```
