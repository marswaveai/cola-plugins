const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

const MIME_TO_EXT: Record<string, string> = {};
for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
  if (!MIME_TO_EXT[mime]) MIME_TO_EXT[mime] = ext;
}

export function mimeFromExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

export function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? ".bin";
}

/** Map MIME type to Feishu file_type for im.file.create */
export function feishuFileType(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("word") || mime.includes("document")) return "doc";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "xls";
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "ppt";
  return "stream";
}
