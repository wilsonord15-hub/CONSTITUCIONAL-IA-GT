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
