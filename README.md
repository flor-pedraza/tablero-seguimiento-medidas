# Tablero de Seguimiento de Medidas

Reemplazo de los dos Looker ("Medidas / Personas / Casos" y "Gestión / Alertas").
Lee **en vivo** la planilla *Control Medidas 2 - TABLERO* (hojas `importación 2` y `Alertas`)
con una cuenta de servicio de Google, y muestra las 5 páginas con sus filtros.

## Cómo funciona

```
Google Sheet ──(cuenta de servicio, solo lectura)──► /api/data (Vercel) ──► tablero en el navegador
```

- `api/data.js`: lee solo las columnas que usa el tablero, las compacta y las manda comprimidas.
  Vercel guarda el resultado en cache **5 minutos** (`CACHE_SECONDS`): un cambio en la planilla aparece en el tablero en ese plazo, sin redeployar.
- `middleware.js`: pide **usuario y contraseña** para entrar a todo el sitio (incluido `/api/data`).
- `public/`: el tablero (HTML + JS). Los cálculos y filtros se hacen en el navegador.

Las columnas se buscan **por nombre de encabezado**, no por posición: se pueden mover o agregar columnas en la planilla sin romper nada. Si se **renombra** una columna que usa el tablero, arriba a la derecha aparece "Columnas no encontradas: …".

## Deploy (una sola vez)

1. **Subir el código a GitHub**: crear un repositorio **privado** y subir el contenido de esta carpeta (sin el `.json` de la cuenta de servicio).
2. En **vercel.com/new**, importar ese repositorio. Framework: *Other*. No hace falta build command.
3. Antes de darle Deploy, en **Environment Variables** cargar:

| Variable | Valor |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | El contenido completo del archivo `.json` de la cuenta de servicio (abrirlo con el Bloc de notas, copiar todo y pegar) |
| `DASHBOARD_PASSWORD` | La contraseña para entrar al tablero |
| `DASHBOARD_USER` | (opcional) Usuario, por defecto `medidas` |

4. **Deploy**. Al entrar, el navegador pide usuario y contraseña.

Opcionales: `SHEET_ID`, `SHEET_MEDIDAS` (por defecto `importación 2`), `SHEET_ALERTAS` (por defecto `Alertas`), `CACHE_SECONDS` (por defecto 300).

Si se cambia una variable de entorno en Vercel, hay que hacer **Redeploy** para que tome efecto.

## Reglas de cálculo (iguales a la planilla / Looker)

- **Medidas registradas**: Nro ASM únicos. **Medidas MPF**: Nro ASM únicos con Origen = INTERNO.
- **Personas únicas**: documentos únicos. **Total personas**: nombres de destinatario únicos. **Casos únicos**: legajos únicos.
- **Medidas gestionadas**: filas con Nro ASM y Fecha de carga. **Hoy**: fecha de carga = hoy (hora Argentina).
- **Promedios** (por agente / día / semana / mes): ASM gestionados únicos ÷ agentes / días / semanas / meses distintos.
- **Tipos de gestión por agente**: suma de Acc. Gest. 1, 2 y 3.
- **Alertas**: se cuentan registros (filas), como en el Looker.
- "Período (fecha de carga)" filtra por la columna *Fecha de carga*.

## Mapa por comuna

Por defecto muestra un círculo por comuna (tamaño y color según la cantidad).
Para ver los polígonos de las comunas, descargar el GeoJSON de comunas de BA Data
(data.buenosaires.gob.ar → "Comunas"), guardarlo como `public/comunas.geojson` y redeployar. El tablero lo detecta solo.

## Seguridad

La planilla tiene datos personales sensibles. Por eso:
- La cuenta de servicio tiene **solo lectura** y solo ve lo que se le comparte.
- Todo el sitio está detrás de usuario y contraseña, y no se indexa en buscadores.
- Los números de documento **no** se envían al navegador: solo se usan para contar.
- Nunca subir el `.json` de la cuenta de servicio a GitHub (`.gitignore` ya lo excluye). Si se filtra, borrar esa clave en Google Cloud y crear una nueva.
