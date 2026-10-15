# Plan de acción

Cómo seguir haciendo crecer el valle sin romperlo. Cada fase es independiente y se puede hacer en cualquier orden razonable; están ordenadas por lo que más conviene primero.

Estado actual (v0.2): sitio público, administración, cuentas, biblioteca con lector, progreso de lectura, grupos de lectura sincronizada con chat, lienzo personal y compartido, proyectos, libro de visitas.

---

## Fase 0 · Puesta en marcha (esta semana)

- [ ] Desplegar con `docker compose` en un VPS (ver README) y apuntar el dominio.
- [ ] Entrar a `/admin/` → Sitio y reemplazar nombre, bienvenida e influencias.
- [ ] Borrar las series y proyectos de muestra; cargar la primera traducción real.
- [ ] Probar en el celular: lector, grupos de lectura, lienzo.
- [ ] Decidir la política de derechos de autor (ver README): qué se publica, si la lectura exige cuenta, cómo se atiende un reclamo.

## Fase 1 · Robustez (1–2 semanas)

Lo mínimo para dormir tranquilo.

- [ ] **Copias de seguridad automáticas:** `pg_dump` diario + copia de `/data/uploads` a un almacenamiento externo (Backblaze B2, S3, otro VPS). Probar una restauración de verdad.
- [ ] **Miniaturas:** hoy las páginas se convierten a WebP (calidad 70, con pérdida) al subirlas; falta generar miniaturas y servir la versión adecuada al ancho de pantalla.
- [ ] **Subida en lote por ZIP:** arrastrar un `.zip` con el capítulo completo y que se ordene solo.
- [ ] **Recuperar contraseña:** hoy se resetea con `npm run create-admin`; falta un flujo por correo (requiere un proveedor de mail, por ejemplo Resend o Brevo) para las lectoras/es.
- [ ] **Límites y registros:** mover los límites de pedidos de memoria a la base (o Redis) para que sobrevivan reinicios; registro de errores en un servicio (Sentry) o al menos en archivos rotados.
- [ ] **Monitoreo:** un chequeo externo gratuito (UptimeRobot) sobre `/api/site`.

## Fase 2 · Lectura de verdad (2–4 semanas)

- [ ] **Medios firmados:** URLs de imagen con vencimiento para que no se puedan enlazar o descargar en masa (importante si la biblioteca pasa a ser privada).
- [ ] **Marcadores y “seguir leyendo”** en Inicio, con el progreso que ya se guarda por capítulo.
- [ ] **Notificaciones de capítulo nuevo** a quienes siguen una serie (correo o Web Push).
- [ ] **Modo claro para el lector** y ajustes de ancho/contraste; lectura a doble página en pantallas anchas.
- [ ] **Créditos por capítulo** (traducción, limpieza, tipografía) y enlace a la edición oficial.
- [ ] **Búsqueda** por título, autoría y etiquetas; filtros por estado.

## Fase 3 · Comunidad (1–2 meses)

- [ ] **Roles intermedios:** `editor` (sube capítulos pero no toca usuarios) para colaborar con otra gente.
- [ ] **Grupos de lectura:** fechas programadas (“leemos el domingo 20 h”), recordatorios, historial de sesiones, modo “cada quien a su ritmo” con marca de progreso del grupo.
- [ ] **Comentarios por página** (opcional, moderados) en lugar de solo el chat de grupo.
- [ ] **Moderación:** reportar mensajes, silenciar/expulsar, bloqueo de palabras.
- [ ] **Perfiles livianos:** avatar generado (una plantita por persona) y lista de series leídas.

## Fase 4 · Dibujo y proyectos (en paralelo, cuando quieras)

- [ ] **Salas de dibujo múltiples:** crear y borrar lienzos desde el admin; salas privadas con código.
- [ ] **Capas, deshacer compartido y exportación** del lienzo; galería con los dibujos que se quieran guardar.
- [ ] **Cursores y nombres** de quienes dibujan (presencia).
- [ ] **Tus proyectos web incrustados:** una pestaña por proyecto con `iframe` aislado (`sandbox`) o enlaces con capturas.
- [ ] **Bitácora:** entradas cortas tipo diario de desarrollo en “Notas”.

## Fase 5 · Escala (solo si hace falta)

El diseño actual aguanta bien cientos de personas conectadas en un servidor chico. Cuando eso se quede corto:

- [ ] **Imágenes a almacenamiento de objetos** (S3/R2/B2) detrás de un CDN; el servidor solo guarda la clave.
- [ ] **Redis pub/sub** para que varias instancias del servidor compartan las salas de WebSocket (hoy el estado de salas vive en memoria de una sola instancia).
- [ ] **Réplica de lectura** de PostgreSQL y caché de series/capítulos.
- [ ] **Integración continua:** correr `npm test` en cada cambio (GitHub Actions con un servicio PostgreSQL) y desplegar solo si pasa.

## Fase 6 · Pulido de identidad

- [ ] Tipografías propias, sonido ambiente opcional (viento, pasto) con volumen y apagado por defecto.
- [ ] Más “vida” en la escena: estaciones, clima, hora real del lugar.
- [ ] Versión impresa/descargable del libro de visitas; página 404 con alma.
- [ ] Revisión de accesibilidad con lector de pantalla y navegación por teclado (la base ya está pensada para eso).

---

## Decisiones que conviene tomar temprano

| Decisión | Opciones | Mi recomendación |
|---|---|---|
| ¿La biblioteca es pública? | Pública / solo con cuenta / solo por invitación | Con cuenta mientras no tengas permiso de las obras |
| ¿Registro abierto? | Sí / no / por código | Abierto para grupos y lienzo; reportes con moderación (Fase 3) |
| ¿Dónde viven las imágenes? | Disco del VPS / S3 con CDN | Disco al principio; pasar a S3 en la Fase 5 |
| ¿Cómo se despliega? | VPS con Docker / PaaS | VPS + Caddy: más barato y sin sorpresas con disco y WebSocket |

## Cómo agregar un módulo nuevo

La cabina se arma sola desde un registro. Un módulo nuevo es un archivo en `web/assets/mod-algo.js`:

```js
Valle.registerModule({
  id: 'bitacora', kanji: '記', label: 'Bitácora', order: 55,
  render(root, ctx) { /* dibujá con Valle.el(...) y devolvé una función de limpieza si hace falta */ },
});
```

Se agrega la etiqueta `<script>` en `web/index.html` y aparece como pestaña. Si necesita datos nuevos: una migración en `db/migrations/`, una ruta en `server/routes/`, y un método en `web/assets/api-rest.js`.
