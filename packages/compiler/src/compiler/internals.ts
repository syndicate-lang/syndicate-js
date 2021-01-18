export const BootProc = '__SYNDICATE__bootProc';

// Keep these definitions in sync with api.ts from the core package
//
export type NonEmptySkeleton<Shape> = { shape: Shape, members: Skeleton<Shape>[] };
export type Skeleton<Shape> = null | NonEmptySkeleton<Shape>;
export type Path = Array<number>;
