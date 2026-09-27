// Negative fixture for harnessPurity.test.ts: reached only through chainRoot.
import { tmpdir } from 'os';

export const leaf = (): string => `${tmpdir()} ${process.env.HOME ?? ''} ${typeof Buffer}`;
