import type { GenericDimension } from '../dimension/generic.js';
import type { TimeDimension } from '../dimension/time.js';
import { toBuffer, fromBuffer } from '../serialization.js';

// TODO: What all values are allowed?
export type MemoryType = 'int32' | 'uint32' | 'float32' | 'float64';

// Define aggregation operations
const aggregations = {
  sum: (a: number, b: number) => a + b,
  average: (a: number, b: number) => a + b, // Average will be handled after summing
  highest: (a: number, b: number) => Math.max(a, b),
  lowest: (a: number, b: number) => Math.min(a, b),
  first: (a: number, _: number) => a,
  last: (_: number, b: number) => b,
  product: (a: number, b: number) => a * b,
} as const;

type AggregationKey = keyof typeof aggregations;

/**
 * The data array can be millions of items.
 * => Avoid allocations in the loops to keep things acceptably fast.
 */
export class InMemoryStore {
  _size: number;
  _type: MemoryType;
  _defaultValue: number;
  _dataMap: Map<number, number>;

  get byteLength() {
    const typeToSize = {
      int32: 4,
      uint32: 4,
      float32: 4,
      float64: 8,
    };
    return this._size * (typeToSize[this._type] || 1);
  }

  get size() {
    return this._size;
  }

  get total() {
    let total = 0;
    for (const value of this._dataMap.values()) {
      total += value;
    }
    return total;
  }

  get data() {
    const result = new Array(this._size).fill(this._defaultValue);
    for (const [index, value] of this._dataMap.entries()) {
      result[index] = value;
    }

    return result;
  }

  set data(values) {
    if (this._size !== values.length)
      throw new Error(
        `value length is invalid: ${this._size} !== ${values.length}`,
      );

    for (let i = 0; i < this._size; ++i) this.setValue(i, values[i]);
  }

  constructor(
    size: number,
    // TODO: What other values???
    type: MemoryType = 'float32',
    defaultValue = Number.NaN,
    dataMap: Map<number, number> | undefined = undefined,
  ) {
    this._size = size;
    this._type = type;
    if (!Number.isNaN(defaultValue) && defaultValue !== 0)
      throw new Error('Invalid default value, only NaN and 0 are supported');

    if (!['int32', 'uint32', 'float32', 'float64'].includes(type))
      throw new Error('Invalid type');

    this._defaultValue = defaultValue;
    this._dataMap = new Map(dataMap);
  }

  clone() {
    return new InMemoryStore(
      this._size,
      this._type,
      this._defaultValue,
      this._dataMap,
    );
  }

  serialize() {
    let dataBuffer:
      | number[]
      | Uint32Array
      | Int32Array
      | Float32Array
      | Float64Array;

    switch (this._type) {
      case 'int32':
        dataBuffer = new Int32Array(this._dataMap.values());
        break;
      case 'uint32':
        dataBuffer = new Uint32Array(this._dataMap.values());
        break;
      case 'float32':
        dataBuffer = new Float32Array(this._dataMap.values());
        break;
      case 'float64':
        dataBuffer = new Float64Array(this._dataMap.values());
        break;
      default:
        dataBuffer = Array.from(this._dataMap.values());
    }

    return toBuffer({
      size: this._size,
      type: this._type,
      defaultValue: this._defaultValue,
      indexes: new Uint32Array(this._dataMap.keys()),
      dataBuffer: dataBuffer,
    });
  }

  static deserialize(buffer: ArrayBuffer) {
    const data = fromBuffer(buffer);
    if (!data) {
      throw new Error('Invalid buffer');
    }
    const store = new InMemoryStore(0);

    // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
    store._size = data.size;
    // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
    store._type = data.type;
    // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
    store._defaultValue = data.defaultValue;
    store._dataMap = new Map(
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      data.indexes.reduce((acc, v, i) => {
        // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
        acc.push([v, data.dataBuffer[i]]);
        return acc;
      }, []),
    );
    return store;
  }

  getValue(index: number) {
    return this._dataMap.get(index) ?? this._defaultValue;
  }

  setValue(index: number, value: number) {
    if (
      value !== undefined &&
      value !== null &&
      value !== this._defaultValue &&
      !(Number.isNaN(this._defaultValue) && Number.isNaN(value))
    ) {
      this._dataMap.set(index, value);
    } else {
      this._dataMap.delete(index);
    }
  }

  fill(value: number) {
    for (let i = 0; i < this._size; ++i) {
      this.setValue(i, value);
    }
  }

  load(
    otherStore: InMemoryStore,
    myDimensions: (TimeDimension | GenericDimension)[],
    hisDimensions: (TimeDimension | GenericDimension)[],
  ) {
    const numDimensions = myDimensions.length;
    const hisDimLengths = hisDimensions.map((dim) => dim.numItems);
    const myDimLengths = myDimensions.map((dim) => dim.numItems);
    const dimIdxHisMineMap = hisDimensions.map((hisDimension, index) => {
      const hisItems = hisDimension.getItems();
      const myItemsToIdx = myDimensions[index]?.getItemsToIdx();

      if (!myItemsToIdx) {
        throw new Error(`Dimension ${index} not found`);
      }

      return hisItems.map((newItem) => myItemsToIdx[newItem]);
    });

    const hisDimIdx = new Uint32Array(numDimensions);

    // This method cannot be optimized to iterate only over the entries of
    // 'otherStore'. Just iterating over the other store entries could be
    // a mistake in here because we can not guarantee that 'this store' has
    // the same values stored. Imagine that we have 'this store' filled with
    // '1' and the other store has a space filled with '0' (default value),
    // by skipping the default values we are not filling the store with
    // the default value of 'otherStore'.
    for (let otherIdx = 0; otherIdx < otherStore._size; ++otherIdx) {
      // Decompose new index into dimensions indexes
      let hisIdxCpy = otherIdx;
      for (let i = numDimensions - 1; i >= 0; --i) {
        const hisDimLengthsItem = hisDimLengths[i];
        if (typeof hisDimLengthsItem === 'number') {
          hisDimIdx[i] = hisIdxCpy % hisDimLengthsItem;
          hisIdxCpy = Math.floor(hisIdxCpy / hisDimLengthsItem);
        }
      }

      // Compute what the old index was
      let myIdx = 0;
      for (let i = 0; i < numDimensions; ++i) {
        const mineItem = dimIdxHisMineMap[i];
        const myDimLengthItem = myDimLengths[i];
        if (mineItem && typeof myDimLengthItem === 'number') {
          const hisItem = hisDimIdx[i];

          if (typeof hisItem === 'number') {
            const offset = mineItem[hisItem];

            if (typeof offset === 'number') {
              myIdx = myIdx * myDimLengthItem + offset;
            }
          }
        }
      }

      this.setValue(myIdx, otherStore.getValue(otherIdx));
    }
  }

  reorder(
    oldDimensions: (TimeDimension | GenericDimension)[],
    newDimensions: (TimeDimension | GenericDimension)[],
  ) {
    const newStore = new InMemoryStore(
      this._size,
      this._type,
      this._defaultValue,
    );

    const numDimensions = newDimensions.length;
    const newToOldDimIdx = newDimensions.map((newDim) =>
      oldDimensions.indexOf(newDim),
    );

    const oldDimIdx = new Uint32Array(numDimensions);

    for (const [oldIdx, oldValue] of this._dataMap.entries()) {
      // Decompose new index into dimensions indexes
      let oldIdxCopy = oldIdx;
      for (let i = numDimensions - 1; i >= 0; --i) {
        const numItems = oldDimensions[i]?.numItems;
        if (typeof numItems === 'number') {
          oldDimIdx[i] = oldIdxCopy % numItems;
          oldIdxCopy = Math.floor(oldIdxCopy / numItems);
        }
      }

      // Compute what the old index was
      let newIdx = 0;
      for (let i = 0; i < numDimensions; ++i) {
        const oldDimIndex = newToOldDimIdx[i];
        const newDimNumItems = newDimensions[i]?.numItems;
        if (
          typeof oldDimIndex === 'number' &&
          typeof newDimNumItems === 'number'
        ) {
          const oldDimIdxItem = oldDimIdx[oldDimIndex];

          if (typeof oldDimIdxItem === 'number') {
            newIdx = newIdx * newDimNumItems + oldDimIdxItem;
          }
        }
      }

      newStore.setValue(newIdx, oldValue);
    }

    return newStore;
  }

  dice(
    oldDimensions: (TimeDimension | GenericDimension)[],
    newDimensions: (TimeDimension | GenericDimension)[],
  ) {
    const newLength = newDimensions.reduce((m, d) => m * d.numItems, 1);
    const numDimensions = newDimensions.length;
    const oldDimLength = oldDimensions.map((dim) => dim.numItems);
    const newDimLength = newDimensions.map((dim) => dim.numItems);

    const dimIdxNewOldMap = newDimensions.map((dimension, index) => {
      const newItems = dimension.getItems();
      const exists = oldDimensions[index];
      if (!exists) {
        throw new Error(`Dimension ${index} not found`);
      }

      const oldItemsToIdx = exists.getItemsToIdx();

      return new Map(newItems.map((newItem, i) => [oldItemsToIdx[newItem], i]));
    });

    const newStore = new InMemoryStore(
      newLength,
      this._type,
      this._defaultValue,
    );

    const oldDimensionIndex = new Uint32Array(numDimensions);
    const newDimensionIndex = new Uint32Array(numDimensions);

    for (const [oldIdx, oldValue] of this._dataMap.entries()) {
      let oldIndexCopy = oldIdx;
      let halt = false;
      for (let i = numDimensions - 1; i >= 0; --i) {
        const oldDimItem = oldDimLength[i];
        if (typeof oldDimItem === 'number') {
          oldDimensionIndex[i] = oldIndexCopy % oldDimItem;

          const dimIdxItem = dimIdxNewOldMap[i];
          if (dimIdxItem) {
            const newDimIdx = dimIdxItem.get(oldDimensionIndex[i]);

            if (newDimIdx === undefined) {
              halt = true;
              break;
            }

            newDimensionIndex[i] = newDimIdx;

            oldIndexCopy = Math.floor(oldIndexCopy / oldDimItem);
          }
        }
      }
      if (halt) continue;

      let newIdx = 0;
      for (let i = 0; i < numDimensions; ++i) {
        const newDimLengthItem = newDimLength[i];
        const newDimensionIndexItem = newDimensionIndex[i];
        if (
          typeof newDimLengthItem === 'number' &&
          typeof newDimensionIndexItem === 'number'
        ) {
          newIdx = newIdx * newDimLengthItem + newDimensionIndexItem;
        }
      }

      newStore.setValue(newIdx, oldValue);
    }

    return newStore;
  }

  drillUp(
    oldDimensions: (TimeDimension | GenericDimension)[],
    newDimensions: (TimeDimension | GenericDimension)[],
    method: AggregationKey = 'sum',
  ) {
    const newSize = newDimensions.reduce((m, d) => m * d.numItems, 1);
    const numDimensions = newDimensions.length;
    const oldDimLength = oldDimensions.map((dim) => dim.numItems);
    const newDimLength = newDimensions.map((dim) => dim.numItems);
    const dimIdxOldNewMap: (number[] | Uint32Array)[] = [];

    newDimensions.forEach((newDim, index) => {
      const oldDimItem = oldDimensions[index];
      if (oldDimItem) {
        const result = oldDimItem.getGroupIndexFromRootIndexMap(
          newDim.rootAttribute,
        );

        if (result) {
          dimIdxOldNewMap.push(result);
        }
      }
    });

    const newStore = new InMemoryStore(newSize, this._type, this._defaultValue);

    const contributions = new Uint16Array(newSize);
    const oldDimensionIndex = new Uint32Array(numDimensions);

    const aggregate = aggregations[method];

    // Ensure the aggregate function is defined
    if (!aggregate) {
      throw new Error(`Unsupported aggregation method: ${method}`);
    }

    for (const [oldIdx, oldValue] of this._dataMap.entries()) {
      let oldIndexCopy = oldIdx;
      for (let i = numDimensions - 1; i >= 0; --i) {
        const oldDimItemLength = oldDimLength[i];
        if (typeof oldDimItemLength === 'number') {
          oldDimensionIndex[i] = oldIndexCopy % oldDimItemLength;
          oldIndexCopy = Math.floor(oldIndexCopy / oldDimItemLength);
        }
      }

      let newIdx = 0;
      for (let i = 0; i < numDimensions; ++i) {
        const dimIdxItem = dimIdxOldNewMap[i];
        const oldDimIdxItem = oldDimensionIndex[i];
        if (dimIdxItem && typeof oldDimIdxItem === 'number') {
          const offset = dimIdxItem[oldDimIdxItem];
          const newDimLengthItem = newDimLength[i];
          if (
            typeof offset === 'number' &&
            typeof newDimLengthItem === 'number'
          ) {
            newIdx = newIdx * newDimLengthItem + offset;
          }
        }
      }

      if (!newStore._dataMap.has(newIdx)) {
        newStore.setValue(newIdx, oldValue);
      } else {
        newStore.setValue(
          newIdx,
          aggregate(newStore.getValue(newIdx), oldValue),
        );
      }

      if (typeof contributions[newIdx] === 'number') {
        // @ts-ignore We checked this is a number above.
        contributions[newIdx] += 1;
      }
    }

    if (method === 'average') {
      for (let newIdx = 0; newIdx < newStore._size; ++newIdx) {
        const contributionItem = contributions[newIdx];
        if (contributionItem)
          newStore.setValue(
            newIdx,
            newStore.getValue(newIdx) / contributionItem,
          );
      }
    }

    return newStore;
  }

  drillDown(
    oldDimensions: (TimeDimension | GenericDimension)[],
    newDimensions: (TimeDimension | GenericDimension)[],
    method: AggregationKey = 'sum',
    distributions: number[] | null = null,
  ) {
    const useRounding = this._type === 'int32' || this._type === 'uint32';
    const oldSize = this._size;
    const newSize = newDimensions.reduce((m, d) => m * d.numItems, 1);
    const numDimensions = newDimensions.length;
    const oldDimLength = oldDimensions.map((dim) => dim.numItems);
    const newDimLength = newDimensions.map((dim) => dim.numItems);
    const dimIdxNewOldMap: (number[] | Uint32Array)[] = [];
    oldDimensions.forEach((oldDim, index) => {
      const newDim = newDimensions[index];
      if (newDim) {
        const newDimGroup = newDim.getGroupIndexFromRootIndexMap(
          oldDim.rootAttribute,
        );

        if (newDimGroup) {
          dimIdxNewOldMap.push(newDimGroup);
        }
      }
    });

    // Needed to keep track of number of contributions by cell
    const contributionsIds = new Uint32Array(oldSize);
    const contributionsTotal = new Uint32Array(oldSize);

    const idxNewOld = new Uint32Array(newSize); // idxNewOld[newIdx] == oldIdx
    const newDimensionIndex = new Uint32Array(numDimensions);
    for (let newIdx = 0; newIdx < newSize; ++newIdx) {
      // Decompose new index into dimensions indexes
      let newIndexCopy = newIdx;
      for (let i = numDimensions - 1; i >= 0; --i) {
        const newDimLengthItem = newDimLength[i];
        if (typeof newDimLengthItem === 'number') {
          newDimensionIndex[i] = newIndexCopy % newDimLengthItem;
          newIndexCopy = Math.floor(newIndexCopy / newDimLengthItem);
        }
      }

      // Compute corresponding old index
      let oldIdx = 0;
      for (let j = 0; j < numDimensions; ++j) {
        const oldDimIdxItem = dimIdxNewOldMap[j];
        const newDimensionIndexItem = newDimensionIndex[j];

        if (oldDimIdxItem && typeof newDimensionIndexItem === 'number') {
          const offset = oldDimIdxItem[newDimensionIndexItem];
          const oldDimLengthItem = oldDimLength[j];

          if (
            typeof offset === 'number' &&
            typeof oldDimLengthItem === 'number'
          ) {
            oldIdx = oldIdx * oldDimLengthItem + offset;
          }
        }
      }

      // Depending on aggregation method, copy value.
      idxNewOld[newIdx] = oldIdx;
      if (typeof contributionsTotal[oldIdx] === 'number') {
        // @ts-ignore We checked this is a number above.
        contributionsTotal[oldIdx] += 1;
      }
    }

    const newStore = new InMemoryStore(newSize, this._type, this._defaultValue);

    for (let newIdx = 0; newIdx < newSize; ++newIdx) {
      const oldIdx = idxNewOld[newIdx];

      if (typeof oldIdx === 'number') {
        const oldValue = this._dataMap.get(oldIdx);
        if (!oldValue) continue;

        const numContributions = contributionsTotal[oldIdx];

        if (distributions) {
          const addedDimLength = newSize / oldSize;
          const sharedDimSize = distributions.length / addedDimLength;
          const distIndex =
            Math.floor(newIdx / (newSize / sharedDimSize)) * addedDimLength +
            (newIdx % addedDimLength);
          if (distributions[distIndex] == null)
            throw new Error(`distribution missing for index ${distIndex}`);

          newStore.setValue(newIdx, oldValue * distributions[distIndex]);
        } else {
          if (method === 'sum' && typeof numContributions === 'number') {
            if (useRounding) {
              const value = Math.floor(oldValue / numContributions);
              const remainder = oldValue % numContributions;
              const contributionId = contributionsIds[oldIdx];

              if (typeof contributionId !== 'number') {
                throw new Error('Invalid contributionId');
              }

              const oneOverDistance = remainder / numContributions;
              const lastIsSame =
                Math.floor(contributionId * oneOverDistance) ===
                Math.floor((contributionId - 1) * oneOverDistance);

              const newValue = Math.floor(value);
              if (!lastIsSame) {
                newStore.setValue(newIdx, newValue + 1);
              } else {
                newStore.setValue(newIdx, newValue);
              }
            } else {
              newStore.setValue(newIdx, oldValue / numContributions);
            }
          } else {
            newStore.setValue(newIdx, oldValue);
          }
        }

        if (typeof contributionsIds[oldIdx] === 'number') {
          // @ts-ignore We checked this is a number above.
          contributionsIds[oldIdx]++;
        }
      }
    }

    return newStore;
  }
}
