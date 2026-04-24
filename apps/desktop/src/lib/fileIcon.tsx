import { Icon, addCollection } from '@iconify/react';
import materialIconTheme from '@iconify-json/material-icon-theme/icons.json';
import { File } from 'lucide-react';
import { cn } from '@/lib/cn';

// Register the full Material Icon Theme (PKief) set once at module
// load. This is the same icon theme most modern VSCode users enable —
// flat, colourful tiles like a purple "C#" square, a blue "TS" square,
// etc. The JSON is about 1.5 MB and bundles offline-first (desktop
// app, no Iconify-API roundtrips).
let registered = false;
function ensureRegistered() {
  if (registered) return;
  addCollection(materialIconTheme as Parameters<typeof addCollection>[0]);
  registered = true;
}

/**
 * Mapping of filename patterns → material-icon-theme icon name.
 *
 * Checked in order:
 *  1. Exact basename match (case-insensitive) — `Dockerfile`,
 *     `package.json`, `tsconfig.json`, `README.md`, lockfiles, etc.
 *  2. Extension match — generic fallback per file type.
 *
 * Names come from https://icon-sets.iconify.design/material-icon-theme/
 * (PKief's Material Icon Theme).
 */
const BASENAME_ICONS: Record<string, string> = {
  dockerfile: 'docker',
  '.dockerignore': 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  makefile: 'makefile',
  rakefile: 'ruby',
  gemfile: 'gemfile',
  'gemfile.lock': 'gemfile',
  'package.json': 'nodejs',
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'tsconfig.json': 'tsconfig',
  'jsconfig.json': 'jsconfig',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'vitest.config.ts': 'vitest',
  'vitest.config.js': 'vitest',
  'webpack.config.js': 'webpack',
  'webpack.config.ts': 'webpack',
  'next.config.js': 'next',
  'next.config.ts': 'next',
  'next.config.mjs': 'next',
  'nuxt.config.ts': 'nuxt',
  'nuxt.config.js': 'nuxt',
  'tailwind.config.js': 'tailwindcss',
  'tailwind.config.ts': 'tailwindcss',
  'postcss.config.js': 'postcss',
  'postcss.config.cjs': 'postcss',
  'eslint.config.js': 'eslint',
  'eslint.config.cjs': 'eslint',
  'eslint.config.mjs': 'eslint',
  '.eslintrc': 'eslint',
  '.eslintrc.js': 'eslint',
  '.eslintrc.cjs': 'eslint',
  '.eslintrc.json': 'eslint',
  '.prettierrc': 'prettier',
  '.prettierrc.json': 'prettier',
  '.prettierrc.js': 'prettier',
  'prettier.config.js': 'prettier',
  'biome.json': 'biome',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.editorconfig': 'editorconfig',
  '.env': 'tune',
  '.env.local': 'tune',
  '.env.development': 'tune',
  '.env.production': 'tune',
  '.env.example': 'tune',
  'cargo.toml': 'rust',
  'cargo.lock': 'rust',
  'rustfmt.toml': 'rust',
  'tauri.conf.json': 'tauri',
  'tauri.conf.json5': 'tauri',
  'readme.md': 'readme',
  readme: 'readme',
  license: 'license',
  'license.md': 'license',
  'license.txt': 'license',
  'changelog.md': 'changelog',
  changelog: 'changelog',
  'go.mod': 'go-mod',
  'go.sum': 'go-mod',
  cmakelists: 'cmake',
  'cmakelists.txt': 'cmake',
  'build.gradle': 'gradle',
  'build.gradle.kts': 'gradle',
  'settings.gradle': 'gradle',
  'pom.xml': 'maven',
  'build.zig': 'zig',
  'directory.build.props': 'settings',
  'directory.packages.props': 'settings',
};

const EXTENSION_ICONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'react-ts',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'react',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  py: 'python',
  pyc: 'python',
  pyi: 'python',
  ipynb: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  csproj: 'visualstudio',
  sln: 'visualstudio',
  vb: 'visualstudio',
  fs: 'fsharp',
  fsx: 'fsharp',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  h: 'h',
  hpp: 'cpp',
  m: 'objective-c',
  mm: 'objective-cpp',
  dart: 'dart',
  scala: 'scala',
  clj: 'clojure',
  ex: 'elixir',
  exs: 'elixir',
  elm: 'elm',
  erl: 'erlang',
  hs: 'haskell',
  lua: 'lua',
  r: 'r',
  sql: 'database',
  zig: 'zig',
  nim: 'nim',
  v: 'vlang',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'svg',
  css: 'css',
  scss: 'sass',
  sass: 'sass',
  less: 'less',
  styl: 'stylus',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'settings',
  conf: 'settings',
  cfg: 'settings',
  env: 'tune',
  props: 'settings',
  sh: 'console',
  bash: 'console',
  zsh: 'console',
  fish: 'console',
  ps1: 'powershell',
  bat: 'powershell',
  cmd: 'powershell',
  dockerfile: 'docker',
  proto: 'proto',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  bmp: 'image',
  tiff: 'image',
  avif: 'image',
  pdf: 'pdf',
  zip: 'zip',
  tar: 'zip',
  gz: 'zip',
  '7z': 'zip',
  rar: 'zip',
  txt: 'document',
  log: 'log',
  csv: 'table',
  tsv: 'table',
  xlsx: 'table',
  xls: 'table',
  doc: 'word',
  docx: 'word',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  webm: 'video',
  mkv: 'video',
  ttf: 'font',
  otf: 'font',
  woff: 'font',
  woff2: 'font',
  eot: 'font',
};

/**
 * Resolves the material-icon-theme icon name for a given path, or null
 * when we have no specific match (caller should render the generic
 * file icon). Kept module-private — exporting it next to the
 * `FileTypeIcon` component would trip eslint's react-refresh rule and
 * the function only exists to feed the component below.
 */
function resolveFileIcon(path: string): string | null {
  if (!path) return null;
  const basename = path.split('/').pop() ?? path;
  const lower = basename.toLowerCase();
  const hit = BASENAME_ICONS[lower];
  if (hit) return hit;
  const dot = lower.lastIndexOf('.');
  if (dot <= 0 || dot === lower.length - 1) return null;
  const ext = lower.slice(dot + 1);
  return EXTENSION_ICONS[ext] ?? null;
}

interface FileTypeIconProps {
  path: string;
  size?: number;
  className?: string;
  /**
   * Fallback tint applied to the generic Lucide icon when no match
   * exists. Lets Git status colour show through on unmapped filetypes
   * without staining the proper brand glyphs from Material Icon Theme.
   */
  fallbackColor?: string;
}

/**
 * File-type icon matching PKief's Material Icon Theme (the de-facto
 * modern VSCode icon theme). Falls back to a tinted Lucide `<File />`
 * for anything unmapped, so the tree never renders a blank slot.
 */
export function FileTypeIcon({ path, size = 14, className, fallbackColor }: FileTypeIconProps) {
  ensureRegistered();
  const iconName = resolveFileIcon(path);
  if (!iconName) {
    return (
      <File
        size={size}
        className={cn('shrink-0', fallbackColor ?? 'text-fg/50', className)}
        strokeWidth={1.6}
      />
    );
  }
  return (
    <Icon
      icon={`material-icon-theme:${iconName}`}
      width={size}
      height={size}
      className={cn('shrink-0', className)}
    />
  );
}
