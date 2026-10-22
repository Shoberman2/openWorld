// Europe and the Middle East: every landmark builder (catalog entries in eu-catalog.ts).
import { LONDON_BUILDERS } from './eu-london.ts';
import { PARIS_BUILDERS } from './eu-paris.ts';
import { MORE_BUILDERS } from './eu-more.ts';

export const EU_BUILDERS = { ...LONDON_BUILDERS, ...PARIS_BUILDERS, ...MORE_BUILDERS };
