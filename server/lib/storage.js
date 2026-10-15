import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { HttpError } from './http.js';
import { imageSize, sniffImage } from './images.js';

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

  /** Valida una imagen subida a la carpeta temporal y la mueve a su destino. */
  async function saveImage(file, dirRel, prefix = '') {
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
    const { width, height } = imageSize(head, kind.ext);
    const rel = path.posix.join(dirRel, `${prefix}${crypto.randomUUID()}.${kind.ext}`);
    await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
    await fs.rename(file.path, abs(rel));
    return { rel, width, height, mime: kind.mime };
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
