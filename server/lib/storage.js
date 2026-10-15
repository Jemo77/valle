import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { HttpError } from './http.js';
import { sniffImage } from './images.js';

// Calidad WebP con pérdida. 70 mantiene buena nitidez en páginas de manga.
export const WEBP_QUALITY = 70;

/** Deja un nombre de archivo apto para disco (sin barras ni caracteres raros). */
const safeBase = (s) => {
  const clean = String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return clean || 'imagen';
};

export function createStorage(config) {
  const tmpDir = path.join(config.uploadDir, '.tmp');

  const abs = (rel) => {
    const full = path.resolve(config.uploadDir, rel);
    if (!full.startsWith(config.uploadDir + path.sep)) throw new HttpError(400, 'Ruta inválida.');
    return full;
  };

  const upload = multer({
    dest: tmpDir,
    limits: { fileSize: config.maxUploadBytes, files: 120, fields: 20 },
  });

  /**
   * Valida una imagen subida y la guarda convertida a WebP (calidad 70, con pérdida).
   * @param file archivo temporal de multer
   * @param dirRel carpeta destino dentro de uploads/
   * @param opts.name nombre de archivo sin extensión (si no, se usa un UUID)
   */
  async function saveImage(file, dirRel, { name } = {}) {
    const handle = await fs.open(file.path, 'r');
    let head;
    try {
      head = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      head = head.subarray(0, bytesRead);
    } finally { await handle.close(); }

    const kind = sniffImage(head);
    if (!kind) {
      await fs.rm(file.path, { force: true });
      throw new HttpError(400, `"${file.originalname}" no es una imagen válida (PNG, JPG, WebP o GIF).`, 'bad_image');
    }

    const base = safeBase(name || crypto.randomUUID());
    const rel = path.posix.join(dirRel, `${base}.webp`);
    const dest = abs(rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });

    let info;
    try {
      info = await sharp(file.path, { failOn: 'error' })
        .rotate() // respeta la orientación EXIF si la hay
        .webp({ quality: WEBP_QUALITY })
        .toFile(dest);
    } catch {
      await fs.rm(dest, { force: true });
      throw new HttpError(400, `"${file.originalname}" no se pudo convertir a WebP.`, 'bad_image');
    } finally {
      await fs.rm(file.path, { force: true });
    }

    return { rel, width: info.width ?? null, height: info.height ?? null, mime: 'image/webp' };
  }

  async function discard(files) {
    await Promise.all((files || []).map((f) => fs.rm(f.path, { force: true })));
  }

  const remove = (rel) => (rel ? fs.rm(abs(rel), { force: true }) : Promise.resolve());
  const removeDir = (rel) => fs.rm(abs(rel), { recursive: true, force: true });
  const urlFor = (rel) => (rel ? `/media/${rel}` : null);

  async function init() {
    await fs.mkdir(tmpDir, { recursive: true });
  }

  return { upload, saveImage, discard, remove, removeDir, urlFor, abs, init };
}
