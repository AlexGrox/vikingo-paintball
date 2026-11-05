/* Vista previa de archivos recién subidos.
   En GitHub Pages un archivo subido tarda 1-2 minutos en publicarse: mientras tanto
   se muestra la copia local del navegador. */
const previews = new Map();

export function setPreview(path, file) {
  previews.set(path, URL.createObjectURL(file));
}

/** URL a usar para mostrar un recurso del contenido */
export function mediaUrl(url) {
  return (url && previews.get(url)) || url;
}
