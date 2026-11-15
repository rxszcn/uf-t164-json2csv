// packages/transforms/src/flatten.ts
function compareSourcePaths(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return left.length - right.length;
}
function isFlattenableObject(value, objects) {
  return objects && typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value.toJSON) !== "[object Function]";
}
function flattenStep(obj, flatDataRow, currentPath, objects, arrays, separator, state) {
  Object.keys(obj).forEach((key) => {
    const newPath = currentPath ? `${currentPath}${separator}${key}` : key;
    const value = obj[key];
    if (isFlattenableObject(value, objects)) {
      flattenStep(
        value,
        flatDataRow,
        newPath,
        objects,
        arrays,
        separator,
        state
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
        state
      );
      return;
    }
    if (newPath !== "__proto__") state.written += 1;
    flatDataRow[newPath] = value;
  });
  return flatDataRow;
}
function flatten({
  objects = true,
  arrays = false,
  separator = ".",
  onConflict = "first"
} = {}) {
  if (onConflict !== "first" && onConflict !== "last" && onConflict !== "error") {
    throw new Error(
      `Invalid flatten "onConflict" option: ${JSON.stringify(
        onConflict
      )}. Expected "first", "last" or "error".`
    );
  }
  function collect(obj, entries, currentPath, pathSegments) {
    Object.keys(obj).forEach((key) => {
      const newPath = currentPath ? `${currentPath}${separator}${key}` : key;
      const value = obj[key];
      pathSegments.push(key);
      if (isFlattenableObject(value, objects)) {
        collect(value, entries, newPath, pathSegments);
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
        value
      });
      pathSegments.pop();
    });
  }
  function resolve(entries) {
    const writers = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      const pathWriters = writers.get(entry.path);
      if (pathWriters) {
        pathWriters.push(entry);
      } else {
        writers.set(entry.path, [entry]);
      }
    }
    const conflictingPaths = [...writers.entries()].filter(([, pathWriters]) => pathWriters.length > 1).map(([path]) => path).sort();
    if (onConflict === "error" && conflictingPaths.length > 0) {
      const conflicts = conflictingPaths.map((path) => {
        const sourcePaths = writers.get(path).map((entry) => JSON.stringify(entry.sourcePath)).sort();
        return `"${path}" (from ${sourcePaths.join(", ")})`;
      });
      throw new Error(
        `Flatten conflict: ${conflicts.join(", ")} ${conflicts.length === 1 ? "is" : "are"} produced by multiple source paths. Use the "onConflict" option ("first", "last" or "error") to choose how collisions are resolved.`
      );
    }
    const winners = /* @__PURE__ */ new Map();
    for (const [path, pathWriters] of writers) {
      if (pathWriters.length === 1) {
        winners.set(path, pathWriters[0]);
        continue;
      }
      let winner = pathWriters[0];
      for (const entry of pathWriters.slice(1)) {
        const order = compareSourcePaths(entry.sourcePath, winner.sourcePath);
        if (onConflict === "first" && order < 0 || onConflict === "last" && order > 0) {
          winner = entry;
        }
      }
      winners.set(path, winner);
    }
    const flatDataRow = {};
    const orderedEntries = [...winners.values()].sort((left, right) => {
      return compareSourcePaths(left.sourcePath, right.sourcePath);
    });
    for (const entry of orderedEntries) {
      flatDataRow[entry.path] = entry.value;
    }
    return flatDataRow;
  }
  return (dataRow) => {
    const state = { written: 0 };
    const flatDataRow = flattenStep(
      dataRow,
      {},
      void 0,
      objects,
      arrays,
      separator,
      state
    );
    if (state.written === Object.keys(flatDataRow).length) {
      return flatDataRow;
    }
    const entries = [];
    collect(dataRow, entries, void 0, []);
    return resolve(entries);
  };
}
export {
  flatten as default
};
