// Cute little type, found at
// https://mstn.github.io/2018/06/08/fixed-size-arrays-in-typescript/
export type FixedSizeArray<N extends number, T> = N extends 0
  ? never[]
  : {
      0: T;
      length: N;
    } & ReadonlyArray<T>;
