# Valle Interior

Sitio personal con una cabina flotante sobre un valle infinito: biblioteca de mangas traducidos con lector, lienzo de dibujo (solo o compartido en tiempo real), proyectos, libro de visitas y **grupos de lectura sincronizada** con chat. Incluye un **panel de administración** aparte (`/admin/`) para subir series, capítulos y páginas, y para agregar o sacar proyectos.

- **Backend:** Node 22 + Express 5 + PostgreSQL + WebSocket (`ws`).
- **Frontend:** JavaScript sin framework ni build, servido tal cual desde `web/`.
- **Vista pública:** `/` · **Administración:** `/admin/` (solo cuentas con rol `admin`).

> “Valle Interior”, los textos de bienvenida, las influencias y las series de muestra son marcadores de posición: se cambian desde `/admin/` → Sitio.

## Probarlo en tu máquina (5 minutos)

Necesitás Docker.

```bash
cp .env.example .env        # completá POSTGRES_PASSWORD, ADMIN_USERNAME y ADMIN_PASSWORD
docker compose up -d --build
```

Abrí <http://localhost:3000>. La cuenta de administración se crea sola la primera vez con `ADMIN_USERNAME` / `ADMIN_PASSWORD`; entrá en <http://localhost:3000/admin/> para subir tu propio contenido.

## Sin Docker

```bash
npm install
createdb valle                      # o usá un Postgres existente
export DATABASE_URL=postgres://usuario:clave@localhost:5432/valle
export ADMIN_USERNAME=vos ADMIN_PASSWORD=una-clave-larga
npm start                           # aplica las migraciones y arranca en :3000
```

Otros comandos: `npm run create-admin` (crear o resetear un admin), `npm run migrate`, `npm test` (necesita un Postgres; ver `test/helpers.js`).

## Publicarlo en internet

Cualquier lugar que corra Node + PostgreSQL sirve. Lo más directo:

**VPS con Docker + Caddy** (unos 5 USD/mes). En el servidor: clonás el repo, completás `.env` con `PUBLIC_ORIGIN=https://tu-dominio` y `TRUST_PROXY=true`, `docker compose up -d --build`, y ponés Caddy delante:

```
valle.tudominio.com {
    reverse_proxy localhost:3000
}
```

Caddy saca el certificado HTTPS solo. WebSocket funciona sin configuración extra.

**Render / Railway / Fly.io.** Creás un servicio web desde el `Dockerfile`, una base PostgreSQL gestionada y un **disco persistente** montado en `/data/uploads` (sin disco, las imágenes subidas se pierden en cada despliegue). Variables: `DATABASE_URL` (la que da el proveedor), `PUBLIC_ORIGIN`, `TRUST_PROXY=true`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.

### Antes de abrirlo al público

- Entrá a `/admin/` y cambiá lo de muestra (Sitio, series, proyectos).
- Hacé copias de seguridad: base de datos (`pg_dump`) **y** la carpeta de imágenes (`/data/uploads`). Mirá `PLAN.md`.
- Si no querés registro abierto: `ALLOW_REGISTRATION=false` y creá cuentas a mano.

## Un aviso sobre los derechos de autor

Traducir y publicar un manga que tiene editorial o licencia es, en general, una **obra derivada que necesita autorización**, aunque sea por gusto y sin cobrar. Esto no es un consejo legal, pero conviene tenerlo presente:

- Publicar sin permiso puede traer pedidos de retiro (DMCA) o cierre del hosting.
- Si alguien reclama, **despublicá** la serie desde `/admin/` (un clic, no la borra).
- En `/admin/` → Sitio podés activar **“Pedir cuenta para leer”**: la biblioteca deja de ser pública y solo la ve quien se registró.
- Lo más sano: traducir obras que estén abandonadas, sean de dominio público o cuyos autores te den permiso, y enlazar a la edición oficial cuando exista.

## Seguridad: qué ya está resuelto

Contraseñas con scrypt; sesiones en base con token hasheado y cookie `HttpOnly` + `SameSite=Lax`; verificación de origen en pedidos que cambian datos; límites de pedidos para login y libro de visitas; cabeceras CSP; subidas validadas por contenido real (no por extensión) y servidas sin ejecutar; rutas de `/media` a prueba de path traversal; WebSocket con verificación de origen y topes por conexión. Lo que falta está en `PLAN.md` (Fase 1).

## Estructura

```
db/migrations/     esquema SQL (se aplica solo al arrancar)
server/            Express, rutas, WebSocket, scripts
web/               frontend (index.html, admin/, assets/)
tools/             build de la versión de una sola página
test/              pruebas con node:test contra PostgreSQL real
PLAN.md            plan de acción para seguir expandiéndolo
```

La interfaz solo habla con `Valle.api` (`web/assets/api-rest.js`). Si algún día cambiás el servidor, reemplazás ese archivo y el resto sigue igual.
