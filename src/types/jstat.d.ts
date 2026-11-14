declare module 'jstat' {
  interface ContinuousDist {
    cdf(x: number, ...params: number[]): number;
    pdf(x: number, ...params: number[]): number;
    inv(p: number, ...params: number[]): number;
  }

  export const jStat: {
    studentt: ContinuousDist;
    centralF: ContinuousDist;
    chisquare: ContinuousDist;
    normal: ContinuousDist;
  };
  export default jStat;
}
