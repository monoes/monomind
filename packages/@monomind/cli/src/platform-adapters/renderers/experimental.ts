/** Renderers whose native layouts remain discovery-gated. */

import { createPlatformRenderer, type PlatformRenderer } from './factory.js';

export const traeRenderer = createPlatformRenderer('trae');
export const hermesRenderer = createPlatformRenderer('hermes');

export const EXPERIMENTAL_RENDERERS: Readonly<Record<'trae' | 'hermes', PlatformRenderer>> =
  Object.freeze({
    trae: traeRenderer,
    hermes: hermesRenderer,
  });
