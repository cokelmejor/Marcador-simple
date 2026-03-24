# Marcador Simple — En Vivo

Marcador de un solo partido en directo conectado a API-Football.

## Setup en Vercel

### 1. Sube a GitHub
Sube esta carpeta a un repo nuevo en GitHub.

### 2. Importa en Vercel
Importa el repo en vercel.com.

### 3. Añade la API Key (obligatorio)
En Vercel → Project → Settings → Environment Variables:

| Name | Value |
|------|-------|
| `RAPIDAPI_KEY` | tu_api_key_aqui |

### 4. Redeploy
Deployments → ··· → Redeploy

## Funcionamiento
- Se actualiza automáticamente cada 30 segundos
- Muestra el primer partido en vivo que encuentre
- Si no hay partidos en vivo, muestra un mensaje
- Estadísticas: posesión, tiros, faltas, córners, tarjetas
