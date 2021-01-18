// Keep these definitions in sync with internals.ts from the compiler package
//
export type NonEmptySkeleton<Shape> = { shape: Shape, members: Skeleton<Shape>[] };
export type Skeleton<Shape> = null | NonEmptySkeleton<Shape>;
export type Path = Array<number>;
