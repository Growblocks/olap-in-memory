import type { GenericDimension } from '../dimension/generic.js';
import type { TimeDimension } from '../dimension/time.js';
import type { NestedNumberArray } from './nested-array.js';

// TODO: Move this
export type StatusMap = Map<number, number>; // Record<string, Record<string, string>>;

type NestedNumberObject = {
  [key: string]: number | NestedNumberObject;
};

// TODO: utilize statusMap
function toNestedObjectRec(
  values: NestedNumberArray,
  statusMap: StatusMap,
  dimensions: (GenericDimension | TimeDimension)[],
  dimOffset: number,
  offset: number,
) {
  if (dimOffset >= dimensions.length) {
    return values[offset];
  }

  const result: Record<string, unknown> = {};
  const items = dimensions[dimOffset]?.getItems() ?? [];
  items.forEach((item, itemIndex) => {
    const childOffset = offset * items.length + itemIndex;
    result[item] = toNestedObjectRec(
      values,
      statusMap,
      dimensions,
      dimOffset + 1,
      childOffset,
    );
  });

  return result;
}

export function fromNestedObject(
  value: NestedNumberObject,
  dimensions: (GenericDimension | TimeDimension)[],
) {
  let returnValue = [value];

  for (let i = 0; i < dimensions.length; ++i) {
    const upperDimItem = dimensions[i];
    if (!upperDimItem) {
      continue;
    }
    const dimItems = upperDimItem.getItems();
    const newValue = new Array(returnValue.length * upperDimItem.numItems);

    for (let j = 0; j < newValue.length; ++j) {
      const chunkIndex = Math.floor(j / dimItems.length);
      const dimItem = dimItems[j % dimItems.length];

      const chunkItem = returnValue[chunkIndex];
      if (chunkItem && dimItem) {
        newValue[j] = chunkItem[dimItem];
      }
    }

    returnValue = newValue;
  }

  return returnValue;
}

export function toNestedObject(
  values: NestedNumberArray,
  statusMap: StatusMap,
  dimensions: (TimeDimension | GenericDimension)[],
) {
  return toNestedObjectRec(values, statusMap, dimensions, 0, 0);
}
