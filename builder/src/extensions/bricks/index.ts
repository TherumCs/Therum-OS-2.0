import type { BuilderExtension } from '../types.js';
import { ToolbarExtra } from './ToolbarExtra.js';

export const bricksExtension: BuilderExtension = {
  id: 'bricks',
  foundationId: 'bricks',
  label: 'Bricks compatibility',
  ToolbarExtra,
};
