import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('frontend/vendor', { recursive: true });
copyFileSync('node_modules/lucide/dist/umd/lucide.min.js', 'frontend/vendor/lucide.min.js');
copyFileSync('node_modules/chart.js/dist/chart.umd.js', 'frontend/vendor/chart.umd.js');
for (const weight of [400, 500, 600, 700]) {
  copyFileSync(`node_modules/@fontsource/dm-sans/files/dm-sans-latin-${weight}-normal.woff2`, `frontend/vendor/dm-sans-${weight}.woff2`);
}
copyFileSync('node_modules/@fontsource/manrope/files/manrope-latin-700-normal.woff2', 'frontend/vendor/manrope-700.woff2');
