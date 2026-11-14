/**
 * Deterministic PRNG (Mulberry32) for reproducible Monte Carlo simulations (seed 42).
 */
export function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller standard normal sampler N(0, 1).
 */
export function sampleNormal(rng: () => number): number {
  let u1 = rng();
  let u2 = rng();
  if (u1 < 1e-12) u1 = 1e-12;
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Lower-triangular Cholesky decomposition L such that A = L * L^T.
 * Adds tiny jitter on diagonal if numerical rounding causes near-zero eigenvalue.
 */
export function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        const val = matrix[i][i] - sum;
        L[i][j] = Math.sqrt(Math.max(val, 1e-14));
      } else {
        const denom = L[j][j] > 1e-14 ? L[j][j] : 1e-14;
        L[i][j] = (matrix[i][j] - sum) / denom;
      }
    }
  }
  return L;
}
