import type { GenericDimension } from '../dimension/generic.js';
import type { TimeDimension } from '../dimension/time.js';

export type NestedNumberObject = {
  [key: string]: number | NestedNumberObject;
};

export type NestedNumberArray = number[] | [number, number][];

export function fromNestedArray(
  values: NestedNumberArray,
  dimensions: (GenericDimension | TimeDimension)[],
) {
  const numSteps = dimensions.length - 1;
  let returnValue = values;

  for (let i = 0; i < numSteps; ++i) {
    // @ts-ignore TODO: Work on this type, it is saying never.
    returnValue = [].concat(...values);
  }

  return returnValue;
}

// TODO: utilize statusMap
export function toNestedArray(
  values: number[],
  _statusMap: unknown,
  dimensions: (GenericDimension | TimeDimension)[],
) {
  // numDimensions == 0

  if (dimensions.length === 0) {
    return values[0];
  }

  let returnValue = values;

  // numDimensions >= 1
  for (let i = dimensions.length - 1; i > 0; --i) {
    const dimItem = dimensions[i];
    if (!dimItem) {
      continue;
    }
    const chunkSize = dimItem.numItems;

    const newValues = new Array(values.length / chunkSize);
    for (let j = 0; j < newValues.length; ++j) {
      newValues[j] = values.slice(j * chunkSize, j * chunkSize + chunkSize);
    }

    returnValue = newValues;
  }

  return returnValue;
}
