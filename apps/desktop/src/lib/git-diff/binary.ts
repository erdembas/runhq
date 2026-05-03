const BINARY_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'tiff',
  'heic',
  'avif',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp3',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'wav',
  'flac',
  'ogg',
  'm4a',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  '7z',
  'rar',
  'xz',
  'lz4',
  'zst',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'o',
  'a',
  'lib',
  'jar',
  'class',
  'wasm',
  'pyc',
  'pyo',
  'sqlite',
  'db',
  'sqlite3',
  'dat',
  'pkl',
  'npy',
  'parquet',
  'psd',
  'ai',
  'sketch',
  'fig',
]);

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'tiff',
  'heic',
  'avif',
]);

export function fileExt(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTS.has(fileExt(path));
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(fileExt(path));
}

export function isBinaryDiff(raw: string, path: string): boolean {
  if (isBinaryPath(path)) return true;
  if (/^Binary files .* differ$/m.test(raw)) return true;
  if (/^GIT binary patch$/m.test(raw)) return true;
  return false;
}

export function humanKind(path: string): string {
  if (isImagePath(path)) return 'Image';
  const ext = fileExt(path);
  if (!ext) return 'Binary';
  return `${ext.toUpperCase()} file`;
}
