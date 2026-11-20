# CONSTITUCIONAL-IA-GT
Agente de inteligencia artificial para exposiciones y diálogo académico en Derecho Constitucional.

## Acceso local

Con Node.js 22 o superior, inicia el proyecto con `pnpm dev` desde su carpeta y abre
[http://localhost:3001/](http://localhost:3001/). El puerto 3001 debe estar libre.
La página usa una API local para las consultas, por lo que debe abrirse desde esa URL.

1. Abre **Configuración**, guarda una clave de tu proyecto de OpenAI y elige la voz y el acento.
2. Usa **Biblioteca** para cargar PDF, DOCX, TXT o Markdown. Pulsa **Actualizar estado** para comprobar la indexación.
3. Pulsa **Conversar**. Puedes escribir o usar **Dictar** para grabar, revisar la transcripción y enviarla.

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

| Variable | Uso |
| --- | --- |
| `APP_ACCESS_PASSWORD` | Contraseña privada de 24 caracteres o más. El navegador la solicita con el usuario `dr`. |
| `APP_CONFIG_SECRET` | 32 bytes aleatorios, representados por 64 caracteres hexadecimales. Cifra las claves de OpenAI guardadas desde la app. Puedes generarla con `openssl rand -hex 32`. |
| `OPENAI_VECTOR_STORE_ID` | ID del índice jurídico en OpenAI, del mismo proyecto que la clave de la app. Habilita la biblioteca y la carga de documentos. Usa un índice separado si habilitas la biblioteca en Preview. |

Marca la contraseña y el secreto de cifrado como secretos. Ingresa la **clave de OpenAI
desde Configuración** en la app. El servidor la cifra y la guarda en una cookie
`HttpOnly`, `Secure` y `SameSite=Strict` durante 30 días. Cada navegador y dominio
tiene su propia configuración. Si cambias el secreto de cifrado o borras las cookies,
tendrás que volver a ingresar la clave. El historial, el número de WhatsApp y las
preferencias de voz se mantienen en el navegador.

La biblioteca acepta documentos de hasta 4 MiB en Vercel. El dictado admite hasta
dos minutos por grabación y un máximo de 4 MiB de audio. Los documentos y el índice
persisten en OpenAI. Cuando el índice esté configurado y la clave tenga acceso a él,
verifica **Biblioteca → Indexar documento → Actualizar estado** con un archivo de
prueba autorizado y haz una consulta que deba citarlo.

Fuentes: [Funciones Node.js](https://vercel.com/docs/functions/runtimes/node-js),
[límites](https://vercel.com/docs/functions/limitations) y
[variables de entorno](https://vercel.com/docs/environment-variables).
