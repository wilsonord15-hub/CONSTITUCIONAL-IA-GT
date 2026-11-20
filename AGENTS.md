# Despliegues en Vercel

Para todo despliegue autorizado de este repositorio en Vercel, compila localmente y
sube el resultado precompilado. El proyecto de destino es
`wisegt/constitucional-ia-gt`.

1. Comprueba el proyecto vinculado, los archivos que se van a publicar y el entorno.
2. Compila con `vercel build` para Preview o `vercel build --prod` para Production.
3. Revisa el resultado en `.vercel/output`.
4. Sube ese resultado con `vercel deploy --prebuilt` para Preview o
   `vercel deploy --prebuilt --prod` para Production.
5. Confirma que el despliegue esté listo y verifica las rutas afectadas en su URL.

Conserva este flujo si el build falla. Diagnostica el fallo local antes de volver a
intentar la publicación. Mantén `.vercel/` fuera del control de versiones.
