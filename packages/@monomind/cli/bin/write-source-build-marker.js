import { fileURLToPath } from 'node:url';
import { writeSourceBuildMarker } from './source-build.js';

writeSourceBuildMarker(fileURLToPath(new URL('..', import.meta.url)));
