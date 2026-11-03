# KAGAMI

Sitio web estático de Kagami.inc. La página principal está en [`index.html`](./index.html); no requiere instalación de dependencias ni proceso de compilación.

## Probar en local

Desde la carpeta del proyecto, ejecuta:

```sh
python3 -m http.server 8000
```

Abre http://localhost:8000. La aplicación guarda el perfil y las preferencias en el almacenamiento local del navegador; no hay servidor ni sincronización entre dispositivos.

## Publicación

En la configuración del repositorio, selecciona **Settings → Pages → Deploy from a branch**, con la rama `main` y la carpeta `/(root)`. GitHub Pages publicará el HTML, CSS, JavaScript e imágenes desde la raíz:

https://astricaaa.github.io/KAGAMI/

Después de subir los archivos a `main`, espera a que termine el despliegue de Pages y recarga el enlace.
