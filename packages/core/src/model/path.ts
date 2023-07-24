/**
 * Position to a node in a tree.
 */
export type Path = number[];

/**
 * Range between an anchor position and a head position in a tree.
 */
export interface Range {
    anchor: Path;
    head: Path;
}

/**
 * Compares two positions.
 * @param path1 The first position to compare.
 * @param path2 The second position to compare.
 * @returns `true` if the two positions are equal, `false` otherwise.
 */
export function comparePaths(path1: Path, path2: Path) {
    if (path1.length !== path2.length) {
        return false;
    }
    return path1.every((n, i) => n === path2[i]);
}
