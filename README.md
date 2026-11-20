# CONSTITUCIONAL-IA-GT
Agente de inteligencia artificial para exposiciones y diálogo académico en Derecho Constitucional.

## Acceso local

Con Node.js 22 o superior, instala las dependencias con `npm ci`, inicia el proyecto
con `pnpm dev` desde su carpeta y abre
[http://localhost:3001/](http://localhost:3001/). El puerto 3001 debe estar libre.
La página usa una API local para las consultas, por lo que debe abrirse desde esa URL.

Si cambias las clases de Tailwind o su hoja fuente, ejecuta `npm run css:build`
para actualizar `public/tailwind.css`.

1. Abre **Configuración**, guarda una clave de tu proyecto de OpenAI y elige la voz y el acento.
2. Abre **Biblioteca**, elige o arrastra uno o varios archivos PDF, DOCX, TXT o Markdown y pulsa **Subir archivos**. Espera a que cada documento indique **Listo para consultar**.
3. Pulsa **Conversar**. Puedes escribir o usar **Dictar** para grabar, revisar la transcripción y enviarla.

En el primer ingreso se ofrece un perfil opcional. Puedes actualizarlo desde
**Mi perfil**. Se guarda en el navegador y se envía junto con las consultas
para adaptar las explicaciones. Usa un nombre o apodo y evita incluir datos sensibles.

En **Modo y fecha de consulta**, puedes elegir **Audiencia o exposición** para obtener
un guion oral, o fijar una fecha de referencia. Desde la lista de la biblioteca,
**Editar vigencia** permite registrar el estado, la versión y el rango de vigencia de cada documento.
Al indicar una fecha, la búsqueda usa solo rangos registrados que la cubran. Sin
fecha de referencia, también están disponibles los documentos anteriores sin metadatos.
Las respuestas con fuentes muestran fragmentos recuperados de los archivos citados.

Las voces Vesper, Stone y Ripple se generan con GPT-Live de OpenAI. El proyecto
asociado a la clave debe tener acceso a GPT-Live. La lectura puede variar ligeramente;
la respuesta escrita conserva el texto de la consulta y sus citas.

Para sincronizar los labios, la app obtiene tiempos por palabra del audio generado
con una segunda llamada a OpenAI. Estima la posición de cada sonido dentro de su
palabra y la traduce a formas de boca. Si faltan los tiempos, sigue el nivel del audio.
**Escuchar voz** usa archivos MP3 estáticos precargados al abrir Preferencias.
Antes de publicar las muestras, ejecuta `npm run voice:previews` con
`OPENAI_API_KEY` configurada en el entorno y con acceso a GPT-Live. El comando
genera los seis MP3 en `public/voice-previews/v1/`. Incluye esos archivos en la
publicación. La reproducción de las muestras no requiere una clave en el navegador.

El saludo de la conversación por voz tiene su propia caché en `.data/speech/` en
local. En Vercel usa Blob privado si está configurado `BLOB_READ_WRITE_TOKEN`.

La clave queda en `.data/settings.json` en el servidor local, en un archivo con permisos
`0600` excluido de Git. Si la cambias después de crear una biblioteca, la nueva clave
debe tener acceso al mismo índice. El historial y el número de WhatsApp se guardan en el
navegador. El botón de WhatsApp abre un mensaje preparado para que lo revises y lo envíes.
OpenAI recibe los archivos, el audio dictado y las consultas con contexto reciente.
El servidor está diseñado para uso local en un solo equipo.

## Producción en Vercel

Importa el repositorio como un proyecto con preset **Other**. El archivo
`vercel.json` conecta la interfaz y la API con la función Node.js. Usa Node.js 22
o superior. Prueba la rama en un Preview antes de elegir qué rama publicará en
producción.

Configura estas variables en **Settings → Environment Variables** para cada entorno:

La biblioteca en Supabase usa el bucket privado `dr-constitucional-biblioteca` y el esquema `dr_constitucional`. La función `dr-library` verifica la identidad OIDC del proyecto de producción `wisegt/constitucional-ia-gt`. El rol general de Supabase permanece dentro de la función. La biblioteca de Supabase se habilita en ese despliegue de producción.

Al cargar un PDF se conserva la página de cada pasaje. Para indexar documentos escaneados, sube un PDF con OCR y texto seleccionable.

| Variable | Uso |
| --- | --- |
| `APP_ACCESS_PASSWORD` | Contraseña privada de 24 caracteres o más para ingresar a **Configuración**. |
| `APP_CONFIG_SECRET` | 32 bytes aleatorios, representados por 64 caracteres hexadecimales. Cifra las claves de OpenAI guardadas desde la app. Puedes generarla con `openssl rand -hex 32`. |
| `OPENAI_VECTOR_STORE_ID` | ID del índice jurídico en OpenAI, del mismo proyecto que la clave de la app. Habilita el modo de biblioteca anterior cuando Supabase no está configurado. |

La página y el perfil son públicos. Marca la contraseña y el secreto de cifrado como
secretos. Ingresa a **Configuración** con la contraseña y guarda allí la **clave de OpenAI**.
El servidor cifra la clave y la guarda en una cookie
`HttpOnly`, `Secure` y `SameSite=Strict` durante 30 días. Cada navegador y dominio
tiene su propia configuración. Si cambias el secreto de cifrado o borras las cookies,
tendrás que volver a ingresar la clave. En esta versión, las llamadas a OpenAI
requieren una sesión de Configuración y una clave guardada. El historial, el número de WhatsApp y las
preferencias de voz se mantienen en el navegador.

Con Supabase configurado, la biblioteca acepta documentos de hasta 20 MiB por archivo. Sin Supabase, el límite de carga en Vercel es de 4 MiB. El dictado admite hasta
dos minutos por grabación y un máximo de 4 MiB de audio. Los archivos y sus fragmentos vectoriales se guardan en Supabase cuando está configurado. OpenAI genera los vectores y redacta las respuestas. Cuando la biblioteca esté configurada y se haya guardado una clave de OpenAI,
verifica **Biblioteca → Elegir archivos** con un documento de
prueba autorizado. Cuando el documento indique **Listo para consultar**, haz una consulta que deba citarlo.

Fuentes: [Funciones Node.js](https://vercel.com/docs/functions/runtimes/node-js),
[límites](https://vercel.com/docs/functions/limitations) y
[variables de entorno](https://vercel.com/docs/environment-variables).
