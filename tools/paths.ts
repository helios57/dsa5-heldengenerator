import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT: string = fileURLToPath(new URL('..', import.meta.url));
export const APP_DIR: string = join(ROOT, 'app');
export const DATA_DIR: string = join(APP_DIR, 'data');
export const BUILD_DIR: string = join(ROOT, 'build');
export const JS_DIR: string = join(BUILD_DIR, 'js');
export const SOURCE_PDF: string = join(
  ROOT,
  '423187-Charakterbogen_V2_13_(ausfuellbar_selbstrechnend_ohne_Hintergrund)_korr_V2.pdf',
);
