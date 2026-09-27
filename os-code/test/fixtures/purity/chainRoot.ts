// Negative fixture for harnessPurity.test.ts: this file is clean, but the file
// it imports is not, so only a transitive walk catches it.
import { leaf } from './chainLeaf.js';

export const root = (): string => leaf();
