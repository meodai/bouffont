// One worker pool for the whole page: titles, figures and the playground.
import { createPool } from '../src/pool.js';

export const pool = createPool();
