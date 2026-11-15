import type Transform from './Transform.js';

export type FlattenConflictStrategy = 'first' | 'last' | 'error';

export interface FlattenOptions {
  objects?: boolean | undefined;
  arrays?: boolean | undefined;
  separator?: string | undefined;
  onConflict?: FlattenConflictStrategy | undefined;
}

interface FlattenEntry {
  path: string;
  sourcePath: Array<string>;
  value: unknown;
}

/**
 * Compares two source paths using the canonical order used to resolve
 * flattened key collisions.
 *
 * The order is the one produced by a depth-first traversal that visits the
 * keys of every object sorted by UTF-16 code unit order, compared segment by
 * segment. It only looks at the path segments, never at the insertion order
 * of the row keys nor at the values themselves, so the same record data
 * always resolves a collision the same way.
 *
 * @param {String[]} left First source path
 * @param {String[]} right Second source path
 * @returns {Number} Negative if `left` sorts first, positive if `right` does
 */
function compareSourcePaths(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): number {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }

  // Two different source paths that flatten to the same key can never be
  // prefixes of each other (a key cannot be both a leaf and an object), so
  // this only orders paths that do not collide.
  /* c8 ignore next */
  return left.length - right.length;
}

function isFlattenableObject(value: unknown, objects: boolean): boolean {
  return (
    objects &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call((value as any).toJSON) !==
      '[object Function]'
  );
}

/**
 * Original recursive flattening.
 *
 * It also counts the flattened leaf values it writes. A key is only ever
 * produced by a single source path unless two source paths collide, so when
 * the number of writes equals the number of distinct output keys no
 * collision happened and the output is exactly the pre-existing behavior.
 */
function flattenStep<T extends object, FT extends object>(
  obj: T,
  flatDataRow: FT,
  currentPath: string | undefined,
  objects: boolean,
  arrays: boolean,
  separator: string,
  state: { written: number },
): FT {
  Object.keys(obj).forEach((key) => {
    const newPath = currentPath ? `${currentPath}${separator}${key}` : key;
    const value = obj[key as keyof T];

    if (isFlattenableObject(value, objects)) {
      flattenStep(
        value as object,
        flatDataRow,
        newPath,
        objects,
        arrays,
        separator,
        state,
      );
      return;
    }

    if (arrays && Array.isArray(value)) {
      flattenStep(
        value,
        flatDataRow,
        newPath,
        objects,
        arrays,
        separator,
        state,
      );
      return;
    }

    // `__proto__` assignments don't create own properties, so they can't be
    // counted as an output key. Writing it is a no-op, exactly as before.
    if (newPath !== '__proto__') state.written += 1;
    (flatDataRow[newPath as keyof FT] as any) = value;
  });

  return flatDataRow;
}

/**
 * Performs the flattening of a data row recursively
 *
 * A key produced by more than one source path (for example a literal
 * `user.id` key next to a nested `user: { id }`) is resolved using the
 * canonical source path order, so the surviving value never depends on the
 * insertion order of the row keys. Keys that do not collide keep the exact
 * behavior, value and position they had before.
 *
 * @param {String} separator Separator to be used as the flattened field name
 * @param {String} onConflict Strategy used when two different source paths
 * flatten to the same key: 'first' (default) keeps the value of the path that
 * comes first in the canonical order, 'last' keeps the one that comes last
 * and 'error' throws. Defaults to 'first'.
 * @returns {Object => Object} Flattened object
 */
export default function flatten<
  I extends object = object,
  O extends object = object,
>({
  objects = true,
  arrays = false,
  separator = '.',
  onConflict = 'first',
}: FlattenOptions = {}): Transform<I, O> {
  if (
    onConflict !== 'first' &&
    onConflict !== 'last' &&
    onConflict !== 'error'
  ) {
    throw new Error(
      `Invalid flatten "onConflict" option: ${JSON.stringify(
        onConflict,
      )}. Expected "first", "last" or "error".`,
    );
  }

  function collect<T extends object>(
    obj: T,
    entries: Array<FlattenEntry>,
    currentPath: string | undefined,
    pathSegments: Array<string>,
  ): void {
    Object.keys(obj).forEach((key) => {
      const newPath = currentPath ? `${currentPath}${separator}${key}` : key;
      const value = obj[key as keyof T];
      pathSegments.push(key);

      if (isFlattenableObject(value, objects)) {
        collect(value as object, entries, newPath, pathSegments);
        pathSegments.pop();
        return;
      }

      if (arrays && Array.isArray(value)) {
        collect(value, entries, newPath, pathSegments);
        pathSegments.pop();
        return;
      }

      entries.push({
        path: newPath,
        sourcePath: pathSegments.slice(),
        value,
      });
      pathSegments.pop();
    });
  }

  function resolve(entries: Array<FlattenEntry>): object {
    const writers = new Map<string, Array<FlattenEntry>>();
    for (const entry of entries) {
      const pathWriters = writers.get(entry.path);
      if (pathWriters) {
        pathWriters.push(entry);
      } else {
        writers.set(entry.path, [entry]);
      }
    }

    const conflictingPaths = [...writers.entries()]
      .filter(([, pathWriters]) => pathWriters.length > 1)
      .map(([path]) => path)
      .sort();

    if (onConflict === 'error' && conflictingPaths.length > 0) {
      const conflicts = conflictingPaths.map((path) => {
        const sourcePaths = (writers.get(path) as Array<FlattenEntry>)
          .map((entry) => JSON.stringify(entry.sourcePath))
          .sort();
        return `"${path}" (from ${sourcePaths.join(', ')})`;
      });
      throw new Error(
        `Flatten conflict: ${conflicts.join(', ')} ${
          conflicts.length === 1 ? 'is' : 'are'
        } produced by multiple source paths. Use the "onConflict" option ("first", "last" or "error") to choose how collisions are resolved.`,
      );
    }

    const winners = new Map<string, FlattenEntry>();
    for (const [path, pathWriters] of writers) {
      if (pathWriters.length === 1) {
        winners.set(path, pathWriters[0]);
        continue;
      }

      let winner = pathWriters[0];
      for (const entry of pathWriters.slice(1)) {
        const order = compareSourcePaths(entry.sourcePath, winner.sourcePath);
        if (
          (onConflict === 'first' && order < 0) ||
          (onConflict === 'last' && order > 0)
        ) {
          winner = entry;
        }
      }
      winners.set(path, winner);
    }

    // Once the row contains a collision, the whole row is emitted in the
    // canonical source path order. That makes the CSV (values and column
    // positions) a function of the record's data only, never of the order in
    // which its keys happened to be inserted.
    const flatDataRow: Record<string, unknown> = {};
    const orderedEntries = [...winners.values()].sort((left, right) => {
      // Distinct output keys can only share a source path prefix when one of
      // them was produced by a nested path; the tie-break below makes the
      // order total, and is deterministic either way.
      /* c8 ignore next */
      return compareSourcePaths(left.sourcePath, right.sourcePath);
    });

    for (const entry of orderedEntries) {
      flatDataRow[entry.path] = entry.value;
    }

    return flatDataRow;
  }

  return (dataRow: I) => {
    const state = { written: 0 };
    const flatDataRow = flattenStep(
      dataRow,
      {},
      undefined,
      objects,
      arrays,
      separator,
      state,
    );

    // One write per distinct key means no source path collided, so the result
    // is exactly the pre-existing flattening behavior.
    if (state.written === Object.keys(flatDataRow as object).length) {
      return flatDataRow as any;
    }

    const entries: Array<FlattenEntry> = [];
    collect(dataRow, entries, undefined, []);
    // Like the original implementation, a single flattened row object is
    // returned; the Transform type is shared with array-producing transforms.
    return resolve(entries) as any;
  };
}
