<p align="center"><img src="web/assets/logo.svg" alt="WG" width="96"></p>

# WilScan — escáner de documentos con OCR y herramientas PDF

**by WG · Wilmar Gómez**

Escanea documentos con la cámara, endereza y mejora las fotos, reconoce su texto y trabaja con PDF. **Todo se procesa en tu dispositivo: no se sube nada a ningún servidor.**

## Probar la web

**https://wilgomezgit.github.io/wil_Scan/** — instalable como app (PWA) y con modo sin conexión.

## App para Android

Descarga [`descargas/WilScan-1.0.0.apk`](descargas/WilScan-1.0.0.apk) e instálala (permite «instalar apps de origen desconocido»). APK firmado, 32 MB, Android 7.0 o superior.

## Qué hace

- **Escanear** con detección de bordes en vivo: una página o un lote; modo documento de identidad (anverso y reverso en una hoja); importar desde la galería.
- **Enderezar y mejorar:** corrige la perspectiva; si la foto no muestra los bordes del papel, endereza por la inclinación del texto; amplía las fotos pequeñas.
- **6 filtros:** Original, Mejorado, Sin sombras, Color vivo, Grises, Blanco y negro, más brillo y contraste (a una página o a todas).
- **Editor:** recorte con esquinas arrastrables, girar, ordenar, añadir y eliminar páginas; biblioteca con búsqueda, selección y unir documentos.
- **Texto (OCR)** en español e inglés, sin conexión.
- **Exportar:** PDF (buscable), JPG o TXT, y **compartir** por WhatsApp, correo, Telegram, Discord… (hoja de compartir del sistema).
- **15 herramientas:** imágenes a PDF, unir, dividir, extraer, borrar, girar y ordenar páginas, marca de agua, numerar, firmar, comprimir, PDF a imágenes, PDF a texto, imagen a texto, importar PDF.

## Desarrollo

```bash
npm install && npm run vendor      # copia los motores a web/vendor/
node tools/serve.js                # http://localhost:5180
node tests/make-fixtures.js && node tests/app.e2e.js   # pruebas en Chrome real
node tools/stage.js && npx cap sync android            # prepara el proyecto Android
cd android && ./gradlew assembleRelease                # JDK 21 + SDK de Android
```

La firma del APK usa un almacén de claves local (`android-keystore/`, no incluido en el repositorio).

## Cómo está hecho para ir rápido

Todo el trabajo de imagen va **fuera del hilo principal**, para que la pantalla nunca se congele:

- **GPU (WebGL2 en un Worker, `gl-ops.js`)**: recorta con perspectiva, endereza, gira y aplica los filtros con un «shader». La página recortada queda en la memoria de la GPU: cambiar de filtro, brillo o contraste solo vuelve a dibujar. Al arrancar se hace una **prueba de corrección** (todos los filtros, giro y perspectiva sobre una hoja conocida) y una **prueba de velocidad**; si la GPU es por software, es lenta o algo no cuadra, se usa OpenCV.
- **OpenCV en otro Worker (`cv-worker.js`)**: detecta los bordes del papel y es el respaldo de la GPU (mismos resultados). Solo se carga cuando se va a escanear o importar.
- **Sin pantallas de espera que bloqueen**: el resultado se ve al instante con una vista previa y la imagen final se genera detrás; las tareas tienen tiempo máximo y un vigilante reemplaza un motor que deje de responder.
- **Ajustes → Diagnóstico de velocidad**: motor en uso, tiempo de cada paso y errores recientes; «Copiar informe» deja todo listo para pegar en un mensaje.

Para probar un modo concreto: `?gpu=force` (sin la prueba de velocidad) o `?gpu=off` en la dirección de la web.

## Licencias

© WG — Wilmar Gómez. Usa [OpenCV.js](https://docs.opencv.org/) y [Tesseract.js](https://tesseract.projectnaptha.com/) (Apache-2.0), [pdf-lib](https://pdf-lib.js.org/) (MIT) y [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0). Detalle en `web/vendor/LICENCIAS.txt`.
