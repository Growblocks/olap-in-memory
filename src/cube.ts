import merge from 'lodash.merge';
import TimeSlot from 'timeslot-dag';
import cloneDeep from 'lodash.clonedeep';
import {
  fromNestedArray,
  toNestedArray,
  type NestedNumberArray,
  type NestedNumberObject,
} from './formatter/nested-array.js';
import {
  fromNestedObject,
  toNestedObject,
  type StatusMap,
} from './formatter/nested-object.js';
import { toBuffer, fromBuffer, toArrayBuffer } from './serialization.js';
import type { GenericDimension } from './dimension/generic.js';
import type { TimeDimension } from './dimension/time.js';
import { InMemoryStore, type MemoryType } from './store/in-memory.js';
import type { Expression } from '@growblocks/expr-eval';
import { CatchAll } from './dimension/catch-all.js';
import type { TimeSlotPeriodicity } from './dimension/TimeSlotPeriodicity.enum.js';
import { getParser } from './parser.js';
import { deserialize } from './dimension/factory.js';

const mapFn = (value: string[]) => {
  if (typeof value === 'string') {
    return [value];
  }
  return value;
};

function mapValues(obj: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => {
      return [k, mapFn(v)];
    }),
  );
}

function getCombinations(options: Record<string, string[]>) {
  const optionsValues = Object.values(options);

  const crossproduct = (xss: string[][]) =>
    xss.reduce(
      (xs, ys) => {
        const foo = xs.flatMap((x) => {
          return ys.map((y) => [...x, y]);
        });

        return foo;
      },
      // TODO: See if we can remove this casting.
      [[]] as string[][],
    );

  return crossproduct(optionsValues).map((xs) =>
    Object.fromEntries(xs.map((x, i) => [Object.keys(options)[i], x])),
  );
}

const filterMeasures = (measureIds: string[], measures: string[]) =>
  measures.length === 0
    ? measureIds
    : measureIds.filter((measureId) => measures.includes(measureId));

export class Cube {
  dimensions: (CatchAll | GenericDimension | TimeDimension)[];
  storedMeasures: Record<string, InMemoryStore>;
  storedMeasuresRules: Record<string, Record<string, string>>;
  computedMeasures: Record<string, Expression>;

  get storeSize() {
    return this.dimensions.reduce((m, d) => m * d.numItems, 1);
  }

  get byteLength() {
    return Object.values(this.storedMeasures).reduce(
      (m, store) => m + store.byteLength,
      0,
    );
  }

  get dimensionIds() {
    return this.dimensions.map((d) => d.id);
  }

  get storedMeasureIds() {
    return Object.keys(this.storedMeasures);
  }

  get computedMeasureIds() {
    return Object.keys(this.computedMeasures);
  }

  constructor(dimensions: (CatchAll | GenericDimension | TimeDimension)[]) {
    this.dimensions = dimensions;
    this.storedMeasures = {};
    this.storedMeasuresRules = {};
    this.computedMeasures = {};
  }

  clone(measures: string[] | undefined = []) {
    const cloneCube = new Cube(cloneDeep(this.dimensions));

    const computedMeasuresToCopy = filterMeasures(
      this.computedMeasureIds,
      measures,
    );
    const storedMeasuresToCopy = filterMeasures(
      this.storedMeasureIds,
      measures,
    );

    computedMeasuresToCopy.forEach((measureId) => {
      if (this.computedMeasures[measureId]) {
        cloneCube.computedMeasures[measureId] =
          this.computedMeasures[measureId];
      }
    });
    storedMeasuresToCopy.forEach((measureId) => {
      if (
        this.storedMeasures[measureId] &&
        this.storedMeasuresRules[measureId]
      ) {
        cloneCube.storedMeasures[measureId] =
          this.storedMeasures[measureId].clone();
        cloneCube.storedMeasuresRules[measureId] = cloneDeep(
          this.storedMeasuresRules[measureId],
        );
      }
    });

    return cloneCube;
  }

  getDimension(dimensionId: string) {
    return this.dimensions.find((d) => d.id === dimensionId);
  }

  getDimensionIndex(dimensionId: string) {
    return this.dimensions.findIndex((d) => d.id === dimensionId);
  }

  createComputedMeasure(measureId: string, formula: string) {
    if (!/^[a-z][_a-z0-9]+$|^[_a-z0-9]+__total$/i.test(measureId))
      throw new Error(`Invalid measureId: ${measureId}`);

    if (
      this.storedMeasures[measureId] !== undefined ||
      this.computedMeasures[measureId] !== undefined
    )
      throw new Error(`This measure already exists ${measureId}`);

    // check if formula contains any of the computed measures
    // for example a = b + c, where c is a computed measure with formula c = d + e
    // then this formula will be processed as a = b + d + e
    // NOTE: make sure to match only strings that are not part of a longer string
    const processedFormula = this.computedMeasureIds.reduce(
      (acc, computedMeasureId) => {
        const regex = new RegExp(`\\b${computedMeasureId}\\b`, 'g');
        if (acc.match(regex)) {
          const expression = this.computedMeasures[computedMeasureId];
          return acc.replace(regex, `(${expression?.toString()})`);
        }
        return acc;
      },
      formula,
    );

    const expression = getParser().parse(processedFormula);
    const variables = expression.variables({ withMembers: true });
    if (
      !variables.every((variable) =>
        [
          ...this.storedMeasureIds,
          ...this.storedMeasureIds.map((m) => `${m}__total`),
        ].includes(variable),
      )
    )
      throw new Error(
        `Unknown measure(s): ${variables.filter(
          (variable) => !this.storedMeasureIds.includes(variable),
        )}`,
      );

    this.computedMeasures[measureId] = expression;
  }

  copyStoredMeasure(measureId: string, copyMeasureId: string) {
    if (!/^[a-z][_a-z0-9]+$|^[_a-z0-9]+__total$/i.test(copyMeasureId))
      throw new Error(`Invalid measureId: ${copyMeasureId}`);

    if (this.storedMeasures[measureId] === undefined)
      throw new Error(`This measure does not exists: ${measureId}`);

    if (this.storedMeasures[copyMeasureId] !== undefined)
      throw new Error(`This measure already exists: ${copyMeasureId}`);

    this.storedMeasures[copyMeasureId] = cloneDeep(
      this.storedMeasures[measureId],
    );
    if (this.storedMeasuresRules[measureId]) {
      this.storedMeasuresRules[copyMeasureId] = cloneDeep(
        this.storedMeasuresRules[measureId],
      );
    }
  }

  createStoredMeasure(
    measureId: string,
    rules: Record<string, string> | undefined = {},
    type: MemoryType | undefined = 'float32',
    defaultValue: number | undefined = 0,
  ) {
    if (!/^[a-z][_a-z0-9]+$|^[_a-z0-9]+__total$/i.test(measureId))
      throw new Error(`Invalid measureId: ${measureId}`);

    if (this.storedMeasures[measureId] !== undefined)
      throw new Error(`This measure already exists: ${measureId}`);

    this.storedMeasures[measureId] = new InMemoryStore(
      this.storeSize,
      type,
      defaultValue,
    );
    this.storedMeasuresRules[measureId] = rules;
  }

  cloneStoredMeasure(originCube: Cube, measureId: string) {
    if (!/^[a-z][_a-z0-9]+$|^[_a-z0-9]+__total$/i.test(measureId))
      throw new Error(`Invalid measureId: ${measureId}`);

    if (this.storedMeasures[measureId] !== undefined)
      throw new Error(`This measure already exists: ${measureId}`);

    if (originCube.storedMeasures[measureId] === undefined)
      throw new Error(
        `This measure does not exists in originCube: ${measureId}`,
      );

    this.storedMeasuresRules[measureId] = {};
    Object.assign(
      this.storedMeasuresRules[measureId],
      originCube.storedMeasuresRules[measureId],
    );
    const originMemoryStore = originCube.storedMeasures[measureId];
    this.storedMeasures[measureId] = new InMemoryStore(
      this.storeSize,
      originMemoryStore._type,
      originMemoryStore._defaultValue,
    );
  }

  copyToStoredMeasure(
    computedMeasureId: string,
    storedMeasureId: string,
    rules: Record<string, string> | undefined = {},
    type: MemoryType | undefined = 'float32',
    defaultValue: number | undefined = 0,
  ) {
    const data = this.getData(computedMeasureId);
    this.createStoredMeasure(storedMeasureId, rules, type, defaultValue);
    this.setData(storedMeasureId, data);
  }

  convertToStoredMeasure(
    measureId: string,
    rules: Record<string, string> | undefined = {},
    type: MemoryType | undefined = 'float32',
    defaultValue: number | undefined = 0,
  ) {
    if (!this.computedMeasures[measureId]) {
      throw new Error(
        `convertToStoredMeasure: no such computed measure: ${measureId}`,
      );
    }

    const data = this.getData(measureId);
    this.dropMeasure(measureId);
    this.createStoredMeasure(measureId, rules, type, defaultValue);
    this.setData(measureId, data);
  }

  renameMeasure(oldMeasureId: string, newMeasureId: string) {
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (oldMeasureId == newMeasureId) return;

    if (this.computedMeasures[oldMeasureId]) {
      this.computedMeasures[newMeasureId] = this.computedMeasures[oldMeasureId];
      delete this.computedMeasures[oldMeasureId];
    } else if (this.storedMeasures[oldMeasureId]) {
      this.storedMeasures[newMeasureId] = this.storedMeasures[oldMeasureId];
      if (this.storedMeasuresRules[oldMeasureId]) {
        this.storedMeasuresRules[newMeasureId] =
          this.storedMeasuresRules[oldMeasureId];
      }
      delete this.storedMeasures[oldMeasureId];
      delete this.storedMeasuresRules[oldMeasureId];

      for (const computedMeasureId in this.computedMeasures) {
        const expression = this.computedMeasures[computedMeasureId];
        const regex = new RegExp(`\\b${oldMeasureId}\\b`, 'g');
        if (expression?.toString().match(regex)) {
          this.computedMeasures[computedMeasureId] = expression.substitute(
            oldMeasureId,
            newMeasureId,
          );
        }
      }
    } else {
      throw new Error(
        `renameMeasure: no such measure ${oldMeasureId} -> ${newMeasureId}`,
      );
    }
  }

  replaceStoredMeasure(toKeep: string, toDrop: string) {
    if (this.storedMeasures[toKeep] === undefined)
      throw new Error(`replaceStoredMeasure: no such measure ${toKeep}`);

    if (this.storedMeasures[toDrop] === undefined)
      throw new Error(`replaceStoredMeasure: no such measure ${toDrop}`);

    for (const computedMeasureId in this.computedMeasures) {
      const expression = this.computedMeasures[computedMeasureId];
      const regex = new RegExp(`\\b${toDrop}\\b`, 'g');
      if (expression?.toString().match(regex)) {
        this.computedMeasures[computedMeasureId] = expression.substitute(
          toDrop,
          toKeep,
        );
      }
    }

    this.dropMeasure(toDrop);
  }

  dropMeasure(measureId: string) {
    if (this.computedMeasures[measureId] !== undefined) {
      delete this.computedMeasures[measureId];
    } else if (this.storedMeasures[measureId] !== undefined) {
      delete this.storedMeasures[measureId];
      delete this.storedMeasuresRules[measureId];
      Object.keys(this.computedMeasures).forEach((computedMeasureId) => {
        const expression = this.computedMeasures[computedMeasureId];
        if (expression?.variables().includes(measureId)) {
          delete this.computedMeasures[computedMeasureId];
        }
      });
    } else {
      throw new Error(`dropMeasure: no such measure: ${measureId}`);
    }
  }

  dropMeasures(measureIds: string[]) {
    measureIds.forEach((measureId) => this.dropMeasure(measureId));
  }

  keepMeasure(measureId: string) {
    [...this.computedMeasureIds, ...this.storedMeasureIds]
      .filter((id) => id !== measureId)
      .forEach((id) => this.dropMeasure(id));
  }

  keepMeasures(measureIds: string[]) {
    [...this.computedMeasureIds, ...this.storedMeasureIds]
      .filter((id) => !measureIds.includes(id))
      .forEach((id) => this.dropMeasure(id));
  }

  collapse() {
    // @ts-ignore See if this is simple to fix in future.
    const collapsedCube = this.dimensionIds.reduce((acc, curr) => {
      // @ts-ignore Figure out if `TimeSlotPeriodicity` is the correct type
      return acc.slice(curr, 'all', 'all');
    }, this);

    return collapsedCube;
  }

  getData(measureId: string): number[] {
    if (this.storedMeasures[measureId] !== undefined) {
      return this.storedMeasures[measureId].data;
    }

    if (this.computedMeasures[measureId] !== undefined) {
      const storeSize = this.storeSize;
      const params: Record<string, number> = {};

      // Collect needed measures
      const measures = this.computedMeasures[measureId].variables({
        withMembers: true,
      });
      const storedMeasures = measures.filter(
        (measureId) => !measureId.includes('__total'),
      );
      // Fill params with stored measures total values
      measures
        .filter((measureId) => measureId.includes('__total'))
        .forEach((measureId) => {
          const storedItem =
            this.storedMeasures[measureId.replace('__total', '')]?.total;
          if (storedItem) {
            params[measureId] = storedItem;
          }
        });

      // Fill result array
      const result = new Array(storeSize);

      for (let i = 0; i < storeSize; ++i) {
        for (let j = 0; j < storedMeasures.length; ++j) {
          const storedMeasureItem = storedMeasures[j];
          if (storedMeasureItem) {
            const value = this.storedMeasures[storedMeasureItem]?.getValue(i);
            if (typeof value === 'number') {
              params[storedMeasureItem] = value;
            }
          }
        }

        result[i] = this.computedMeasures[measureId].evaluate(params);
      }

      return result;
    }

    throw new Error(`getData: no such measure ${measureId}`);
  }

  getStatusMap(measureId: string): StatusMap {
    if (this.storedMeasures[measureId] !== undefined) {
      return this.storedMeasures[measureId]._dataMap;
    }

    if (this.computedMeasures[measureId] !== undefined) {
      const result = new Map();
      for (const storedMeasureId in this.storedMeasures) {
        const dataMap =
          this.storedMeasures[storedMeasureId]?._dataMap ?? new Map();
        for (const key of dataMap.keys())
          result.set(
            key,
            result.get(key)
              ? result.get(key) | dataMap.get(key)
              : dataMap.get(key),
          );
      }
      return result;
    }

    throw new Error(`getStatusMap: no such measure ${measureId}`);
  }

  fillData(measureId: string, value: number) {
    if (this.storedMeasures[measureId]) {
      this.storedMeasures[measureId].fill(value);
    } else
      throw new Error(
        `fillData can only be called on stored measures: ${measureId}`,
      );
  }

  setData(measureId: string, values: [number, number][] | number[]) {
    if (this.storedMeasures[measureId]) {
      this.storedMeasures[measureId].data = values;
    } else
      throw new Error(
        `setData can only be called on stored measures: ${measureId}`,
      );
  }

  getNestedArray(measureId: string) {
    const data = this.getData(measureId);
    const statusMap = this.getStatusMap(measureId);

    // @ts-ignore We are ignoring the `CatchAll` class here...
    return toNestedArray(data, statusMap, this.dimensions);
  }

  setNestedArray(measureId: string, values: NestedNumberArray) {
    // @ts-ignore We are ignoring the `CatchAll` class here...
    const data = fromNestedArray(values, this.dimensions);
    this.setData(measureId, data);
  }

  getNestedObject(measureId: string, withTotals: boolean | undefined = false) {
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (!withTotals || this.dimensions.length == 0) {
      const data = this.getData(measureId);
      const statusMap = this.getStatusMap(measureId);
      // @ts-ignore We are ignoring the `CatchAll` class here...
      return toNestedObject(data, statusMap, this.dimensions);
    }

    const result = {};
    for (let j = 0; j < 2 ** this.dimensions.length; ++j) {
      let subCube: Cube = this;
      for (let i = 0; i < this.dimensions.length; ++i)
        if (j & (1 << i)) {
          if (this.dimensions[i]) {
            // @ts-ignore We are ignoring the `CatchAll` class here and the `TimeSlotPeriodicity` type...
            subCube = subCube.drillUp(this.dimensions[i].id, 'all');
          }
        }

      merge(result, subCube.getNestedObject(measureId, false));
    }

    return result;
  }

  // TODO: Make this not unknown return type...
  getNestedObjects(
    measureIds: string[],
    withTotals: boolean | undefined = false,
  ) {
    if (!withTotals || this.dimensions.length === 0) {
      return measureIds.reduce<Record<string, unknown>>((acc, measureId) => {
        const data = this.getData(measureId);
        const statusMap = this.getStatusMap(measureId);

        // @ts-ignore We are ignoring the `CatchAll` class here...
        const val = toNestedObject(data, statusMap, this.dimensions);
        if (val && acc[measureId]) {
          acc[measureId] = val;
        }
        return acc;
      }, {});
    }

    const result: Record<string, unknown> = {};
    for (let j = 0; j < 2 ** this.dimensions.length; ++j) {
      let subCube: Cube = this;
      for (let i = 0; i < this.dimensions.length; ++i)
        if (j & (1 << i)) {
          const dimId = this.dimensions[i]?.id;
          if (dimId) {
            // @ts-ignore Ensure correct type for `TimeSlotPeriodicity`
            subCube = subCube.drillUp(dimId, 'all');
          }
        }

      merge(result, subCube.getNestedObjects(measureIds, false));
    }

    return result;
  }

  setNestedObject(measureId: string, value: NestedNumberObject) {
    // @ts-ignore We are ignoring the `CatchAll` class here...
    const data = fromNestedObject(value, this.dimensions);
    // @ts-ignore TODO: figure out return type of fromNestedObject
    this.setData(measureId, data);
  }

  hydrateFromSparseNestedObject(
    measureId: string,
    obj: number | NestedNumberObject,
    offset: number | undefined = 0,
    dimOffset: number | undefined = 0,
  ) {
    if (dimOffset === this.dimensions.length && typeof obj === 'number') {
      this.storedMeasures[measureId]?.setValue(offset, obj);
      return;
    }

    if (typeof obj === 'number') {
      throw new Error("Invalid object type. Expected 'object', got 'number'");
    }

    const dimension = this.dimensions[dimOffset];
    for (const key in obj) {
      const itemOffset = dimension?.getRootIndexFromRootItem(key);
      const numItems = dimension?.numItems;
      if (
        typeof numItems === 'number' &&
        typeof itemOffset === 'number' &&
        itemOffset !== -1
      ) {
        const newOffset = offset * numItems + itemOffset;
        const value = obj[key];
        if (value) {
          this.hydrateFromSparseNestedObject(
            measureId,
            value,
            newOffset,
            dimOffset + 1,
          );
        }
      }
    }
  }

  setSingleData(
    measureId: string,
    coords: Record<string, string>,
    value: number,
  ) {
    if (this.dimensionIds.some((dimensionId) => !coords[dimensionId])) {
      throw new Error(
        `setSingleData: no value for all dimensions. Dimensions: ${
          this.dimensionIds
        }, Coords: ${JSON.stringify(coords)}`,
      );
    }

    if (this.storedMeasures[measureId] === undefined) {
      throw new Error(`setSingleData: no such stored measure ${measureId}`);
    }

    const position = this.getPosition(coords);
    this.storedMeasures[measureId].setValue(position, value);
  }

  getSingleData(measureId: string, coords: Record<string, string>) {
    if (this.dimensionIds.some((dimensionId) => !coords[dimensionId])) {
      throw new Error(
        `getSingleData: no value for all dimensions. Dimensions: ${
          this.dimensionIds
        }, Coords: ${JSON.stringify(coords)}`,
      );
    }

    const position = this.getPosition(coords);

    if (this.storedMeasures[measureId] !== undefined) {
      return this.storedMeasures[measureId].getValue(position);
    }

    if (this.computedMeasures[measureId] !== undefined) {
      const measures = this.computedMeasures[measureId].variables({
        withMembers: true,
      });

      const params = measures.reduce<Record<string, number>>(
        (acc, measureId) => {
          const val = this.storedMeasures[measureId]?.getValue(position);
          if (typeof val === 'number') {
            acc[measureId] = val;
          }
          return acc;
        },
        {},
      );

      return this.computedMeasures[measureId].evaluate(params);
    }

    throw new Error(`getSingleData: no such measure ${measureId}`);
  }

  /*
   * This function returns an array of all possible combinations of dimension items
   * It takes an array of dimension ids to include from the combinations generation process
   */
  scan(
    dimensionIds: string[],
    cb: (dicedCube: Cube, dimensionItems: Record<string, string>) => void,
  ) {
    const combinations = getCombinations(
      this.getDimensionItemsMap(dimensionIds),
    );

    combinations.forEach((combination: Record<string, string>) => {
      const dicedCube = this.diceByDimensionItems(combination);
      cb(dicedCube, combination);
    });
  }

  /*
   * This function takes an array of dimension ids and returns a new cube with
   * the specified dimensions sliced by the specified dimension items
   */
  aggregateByDimensions(excludeDimensionIds: string[]) {
    return (
      this.dimensionIds
        .filter((d) => !excludeDimensionIds.includes(d))
        // @ts-ignore See if this is simple to fix later...
        .reduce((acc, dimension) => {
          // @ts-ignore Figure out if `TimeSlotPeriodicity` is the correct type
          return acc.slice(dimension, 'all', 'all');
        }, this)
    );
  }

  /*
   * This function returns an object with dimension id as key and dimension items as value.
   * It takes optionally an oarray of dimension ids which will be used to filter the dimensions.
   * If no dimension ids are provided, all dimensions will be used.
   */
  getDimensionItemsMap(dimensionIds: string[]) {
    const filteredDimensionIds =
      dimensionIds != null
        ? this.dimensionIds.filter((d) => dimensionIds.includes(d))
        : this.dimensionIds;

    const dimensionItemsMap: Record<string, string[]> =
      filteredDimensionIds.reduce(
        (acc, cur) => ({
          ...acc,
          [cur]: this.getDimension(cur)?.getItems(),
        }),
        {},
      );

    return dimensionItemsMap;
  }

  /*
   * This function takes dimensionItemsMap as arguments and returns a new cube with diced dimensions.
   * Dimensions here is an object with dimension id as key and dimension items as value.
   * (similar to the output of getDimensionItemsMap)
   */
  diceByDimensionItems(
    dimensionItemsMap: Record<string, string | string[]>,
    measures: string[] | undefined = [],
    reorder: boolean | undefined = false,
  ) {
    const newDimensions = this.dimensions.slice();
    Object.entries(dimensionItemsMap).forEach(([dimensionId, items]) => {
      const dimIdx = this.getDimensionIndex(dimensionId);
      if (dimIdx === -1) return;
      const rootAttribute =
        dimensionId === 'time'
          ? // @ts-expect-error TODO: This is passing the incorrect data type of `string[]` possibly
            TimeSlot.fromValue(items).periodicity
          : this.dimensions[dimIdx]?.rootAttribute;

      if (rootAttribute) {
        const dicedDimItem = newDimensions[dimIdx]?.dice(
          rootAttribute,
          [items].flat(),
          reorder,
        );
        if (dicedDimItem) {
          newDimensions[dimIdx] = dicedDimItem;
        }
      }
    });

    // early return if no dimensions were diced
    if (newDimensions.every((d, i) => d === this.dimensions[i])) {
      return this;
    }

    const newCube = new Cube(newDimensions);
    const computedMeasuresToCopy = filterMeasures(
      this.computedMeasureIds,
      measures,
    );
    const storedMeasuresToCopy = filterMeasures(
      this.storedMeasureIds,
      measures,
    );

    computedMeasuresToCopy.forEach((measureId) => {
      const val = this.computedMeasures[measureId];
      if (val) {
        newCube.computedMeasures[measureId] = val;
      }
    });
    storedMeasuresToCopy.forEach((measureId) => {
      const val = this.storedMeasures[measureId]?.dice(
        // @ts-ignore We are ignoring the `CatchAll` class here...
        this.dimensions,
        newDimensions,
      );
      if (val) {
        newCube.storedMeasures[measureId] = val;
      }
      if (this.storedMeasuresRules[measureId]) {
        newCube.storedMeasuresRules[measureId] = cloneDeep(
          this.storedMeasuresRules[measureId],
        );
      }
    });

    return newCube;
  }

  /*
   * This function iterates over all possible combinations of dimension items and
   * calls the callback function with the sliced cube for each combination of dimension items
   */
  iterateOverDimension(
    dimension: string,
    cb: (cube: Cube, dimensionItems: Record<string, string>) => void,
  ) {
    const excludeDimensionIds = this.dimensionIds.filter(
      (id) => id !== dimension,
    );
    if (excludeDimensionIds.length === this.dimensionIds.length) {
      throw new Error(
        `Cube has no ${dimension} dimension. Dimensions: ${this.dimensionIds}`,
      );
    }

    if (excludeDimensionIds.length === 0) {
      cb(this, {});
      return;
    }

    this.scan(excludeDimensionIds, (dicedCube, dimensionItems) => {
      const slicedCube = dicedCube.aggregateByDimensions([dimension]);
      // @ts-ignore Figure out the type of aggregateByDimensions
      cb(slicedCube, dimensionItems);
    });
  }

  getDistribution(
    measureId: string,
    dimensionsFilter: Record<string, string[]> | undefined = {},
  ) {
    const spaceSum = this.getTotalForDimensionItems(
      measureId,
      dimensionsFilter,
    );
    const totalSum = this.getTotal(measureId);

    return totalSum === 0 ? spaceSum : spaceSum / totalSum;
  }

  getTotal(measureId: string) {
    const value = this.storedMeasures[measureId]?.total;
    if (typeof value !== 'number') {
      throw new Error(`getTotal: no such measure ${measureId}`);
    }

    return value;
  }

  getTotalForDimensionItems(
    measureId: string,
    dimensionsFilter: Record<string, string[]> | undefined = {},
  ) {
    const _dimensionsFilter = mapValues(dimensionsFilter);

    const unspecifiedDimensions = this.dimensionIds.filter(
      (dimensionId) => dimensionsFilter[dimensionId] === undefined,
    );

    const combinations = getCombinations(
      unspecifiedDimensions.reduce((acc, dimensionId) => {
        const val = this.getDimension(dimensionId)?.getItems();
        if (val) {
          return {
            ...acc,
            [dimensionId]: val,
          };
        }

        return acc;
      }, _dimensionsFilter),
    );

    const spaceSum = combinations.reduce((acc, combination) => {
      const value = this.getSingleData(measureId, combination);
      return acc + value;
    }, 0);

    return spaceSum;
  }

  getPosition(coords: Record<string, string>) {
    let position = 0;
    for (let i = 0; i < this.dimensions.length; ++i) {
      const dimension = this.dimensions[i];
      if (!dimension) {
        throw new Error(
          `getPosition: no such dimension ${this.dimensionIds[i]}`,
        );
      }

      const item = coords[dimension.id];
      if (item === undefined)
        throw new Error(
          `getPosition: no such dimension ${dimension.id}. Coords: ${JSON.stringify(
            coords,
          )}`,
        );
      const itemIndex = dimension.getRootIndexFromRootItem(item);
      if (itemIndex === -1)
        throw new Error(
          `getPosition: no such item ${item}. Dimension items: ${dimension.getItems()}`,
        );
      position = position * dimension.numItems + itemIndex;
    }
    return position;
  }

  hydrateFromCube(otherCube: Cube) {
    // Exception == the cubes have no overlap, it is safe to skip this one.
    let compatibleCube: Cube;
    try {
      compatibleCube = otherCube.reshape(this.dimensions);
    } catch {
      return;
    }

    for (const measureId in this.storedMeasures)
      if (compatibleCube.storedMeasures[measureId])
        this.storedMeasures[measureId]?.load(
          compatibleCube.storedMeasures[measureId],
          // @ts-ignore We are ignoring the `CatchAll` class here...
          this.dimensions,
          compatibleCube.dimensions,
        );
  }

  updateStoredMeasureRules(
    measureId: string,
    cb: (rules: Record<string, string>) => Record<string, string>,
  ) {
    const existing = this.storedMeasuresRules[measureId];
    if (existing) {
      const newRules = cb(existing);
      this.storedMeasuresRules[measureId] = newRules;
    }
  }

  project(dimensionIds: string[]) {
    return this.keepDimensions(dimensionIds).reorderDimensions(dimensionIds);
  }

  reorderDimensions(dimensionIds: string[]) {
    // Check for no-op
    let dimIdx = 0;
    for (; dimIdx < this.dimensions.length; ++dimIdx) {
      if (dimensionIds[dimIdx] !== this.dimensions[dimIdx]?.id) {
        break;
      }
    }

    if (dimIdx === this.dimensions.length) {
      return this;
    }

    // Write a new cube
    const newDimensions: (GenericDimension | TimeDimension)[] = [];

    dimensionIds.forEach((id) => {
      const found = this.dimensions.find((dim) => dim.id === id);
      if (found) {
        // @ts-ignore We are ignoring the `CatchAll` class here...
        newDimensions.push(found as GenericDimension | TimeDimension);
      }
    });
    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures) {
      const value = this.storedMeasures[measureId];
      if (value) {
        newCube.storedMeasures[measureId] = value.reorder(
          // @ts-ignore We are ignoring the `CatchAll` class here...
          this.dimensions,
          newDimensions,
        );
      }
    }

    return newCube;
  }

  swapDimensions(dim1: string, dim2: string) {
    if (this.dimensionIds.indexOf(dim1) === -1)
      throw new Error(`swapDimensions: no such dimension ${dim1}`);

    if (this.dimensionIds.indexOf(dim2) === -1)
      throw new Error(`swapDimensions: no such dimension ${dim2}`);

    return this.reorderDimensions(
      this.dimensionIds.map((id) =>
        id === dim1 ? dim2 : id === dim2 ? dim1 : id,
      ),
    );
  }

  slice(
    dimensionId: string,
    // TODO: This type is probably wrong...
    attribute: TimeSlotPeriodicity,
    value: string,
  ) {
    const dimIndex = this.getDimensionIndex(dimensionId);
    if (dimIndex === -1)
      throw new Error(`slice: no such dimension: ${dimensionId}`);

    return this.dice(dimensionId, attribute, [value]).removeDimension(
      dimensionId,
    );
  }

  diceRange(
    dimensionId: string,
    attribute: string,
    start: string,
    end: string,
  ) {
    const dimIdx = this.getDimensionIndex(dimensionId);
    const newDimensions = this.dimensions.slice();
    const item = newDimensions[dimIdx];

    if (item) {
      const value = item.diceRange(
        // @ts-ignore `TimeSlotPeriodicity` is the correct type
        attribute,
        start,
        end,
      );
      if (value) {
        newDimensions[dimIdx] = value;
      }
    }
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newDimensions[dimIdx] == this.dimensions[dimIdx]) {
      return this;
    }

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures) {
      const value = this.storedMeasures[measureId]?.dice(
        // @ts-ignore We are ignoring the `CatchAll` class here...
        this.dimensions,
        newDimensions,
      );
      if (value) {
        newCube.storedMeasures[measureId] = value;
      }
    }

    return newCube;
  }

  dice(
    dimensionId: string,
    // TODO: This type is wrong...
    attribute: TimeSlotPeriodicity,
    items: string[],
    reorder: boolean | undefined = false,
  ) {
    const dimIdx = this.getDimensionIndex(dimensionId);
    const newDimensions = this.dimensions.slice();
    const value = newDimensions[dimIdx]?.dice(attribute, items, reorder);
    if (value) {
      newDimensions[dimIdx] = value;
    }
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newDimensions[dimIdx] == this.dimensions[dimIdx]) {
      return this;
    }

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures) {
      const value = this.storedMeasures[measureId]?.dice(
        // @ts-ignore We are ignoring the `CatchAll` class here...
        this.dimensions,
        newDimensions,
      );
      if (value) {
        newCube.storedMeasures[measureId] = value;
      }
    }

    return newCube;
  }

  copyMeasureData(
    sourceMeasureId: string,
    targetMeasureId: string,
    dimensionsFilter: Record<string, string | string[]> | undefined = {},
  ) {
    const _dimensionsFilter: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(dimensionsFilter)) {
      if (typeof value === 'string') {
        _dimensionsFilter[key] = [value];
      } else {
        _dimensionsFilter[key] = value;
      }
    }

    const unspecifiedDimensions = this.dimensionIds.filter(
      (dimensionId) => dimensionsFilter[dimensionId] === undefined,
    );

    const combinations = getCombinations(
      unspecifiedDimensions.reduce((acc, dimensionId) => {
        const value = this.getDimension(dimensionId)?.getItems();
        if (value) {
          return {
            ...acc,
            [dimensionId]: value,
          };
        }

        return acc;
      }, _dimensionsFilter),
    );

    for (let i = 0; i < combinations.length; i++) {
      const combination = combinations[i];
      const value = this.getSingleData(sourceMeasureId, combination);
      this.setSingleData(targetMeasureId, combination, value);
    }
  }

  keepDimensions(dimensionIds: string[]) {
    let cube: Cube = this;
    for (const dimension of this.dimensions) {
      if (!dimensionIds.includes(dimension.id)) {
        cube = cube.removeDimension(dimension.id);
      }
    }

    return cube;
  }

  removeDimensions(dimensionIds: string[]) {
    let cube: Cube = this;
    for (const dimensionId of dimensionIds) {
      cube = cube.removeDimension(dimensionId);
    }

    return cube;
  }

  addDimension(
    newDimension: GenericDimension | TimeDimension,
    aggregation:
      | Record<string, string | Record<string, string>>
      | undefined = {},
    index: number | null = null,
    distributions: Record<string, number[]> | undefined = {},
  ) {
    // If index is not provided, we append the dimension
    const workingIndex = index === null ? this.dimensions.length : index;

    const oldDimensions: (CatchAll | GenericDimension | TimeDimension)[] =
      this.dimensions.slice();
    oldDimensions.splice(
      workingIndex,
      0,
      new CatchAll(newDimension.id, newDimension),
    );

    const newDimensions = oldDimensions.slice();
    newDimensions[workingIndex] = newDimension;

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    newCube.storedMeasuresRules = cloneDeep(this.storedMeasuresRules);
    for (const measureId in this.storedMeasuresRules) {
      const aggregatedItem = aggregation[measureId];
      if (
        aggregatedItem &&
        newCube.storedMeasuresRules[measureId] &&
        newCube.storedMeasuresRules[measureId][newDimension.id]
      ) {
        // @ts-ignore We verified the values should exist above.
        newCube.storedMeasuresRules[measureId][newDimension.id] =
          aggregatedItem;
      }
    }

    for (const measureId in this.storedMeasures) {
      const storedMeasure = this.storedMeasures[measureId];
      if (storedMeasure) {
        newCube.storedMeasures[measureId] = storedMeasure.drillDown(
          // @ts-ignore We are ignoring the `CatchAll` class here...
          oldDimensions,
          newDimensions,
          aggregation[measureId],
          distributions[measureId],
        );
      }
    }

    return newCube;
  }

  removeDimension(dimensionId: string) {
    const newDimensions = this.dimensions.filter(
      (dim) => dim.id !== dimensionId,
    );
    const newCube = new Cube(newDimensions);
    // @ts-ignore Figure out if `TimeSlotPeriodicity` is the correct type
    newCube.storedMeasures = this.drillUp(dimensionId, 'all').storedMeasures;
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    newCube.storedMeasuresRules = cloneDeep(this.storedMeasuresRules);

    for (const measureId in newCube.storedMeasuresRules) {
      if (newCube.storedMeasuresRules[measureId]) {
        delete newCube.storedMeasuresRules[measureId][dimensionId];
      }
    }

    return newCube;
  }

  drillDown(dimensionId: string, attribute: TimeSlotPeriodicity) {
    const dimIdx = this.getDimensionIndex(dimensionId);
    if (this.dimensions[dimIdx]?.rootAttribute === attribute) return this;

    const newDimensions = this.dimensions.slice();
    const value = newDimensions[dimIdx]?.drillDown(attribute);
    if (value) {
      newDimensions[dimIdx] = value;
    }
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newDimensions[dimIdx] == this.dimensions[dimIdx]) return this;

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures) {
      const value = this.storedMeasures[measureId];
      if (value && this.storedMeasuresRules[measureId]) {
        newCube.storedMeasures[measureId] = value.drillDown(
          // @ts-ignore We are ignoring the `CatchAll` class here...
          this.dimensions,
          newDimensions,
          this.storedMeasuresRules[measureId][dimensionId],
        );
      }
    }

    return newCube;
  }

  /**
   * Aggregate a dimension by group values.
   * ie: minutes by hour, or cities by region.
   */
  drillUp(dimensionId: string, attribute: TimeSlotPeriodicity) {
    const dimIdx = this.getDimensionIndex(dimensionId);
    if (this.dimensions[dimIdx]?.rootAttribute === attribute) return this;

    const newDimensions = this.dimensions.slice();
    const value = newDimensions[dimIdx]?.drillUp(attribute);
    if (value) {
      newDimensions[dimIdx] = value;
    }
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newDimensions[dimIdx] == this.dimensions[dimIdx]) {
      console.info(
        `drillUp: no such attribute: ${attribute} in dimension: ${dimensionId} in cube: ${this.dimensions.map((d) => d.id).join(', ')}`,
      );
      return this;
    }

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures) {
      const value = this.storedMeasures[measureId];
      if (value && this.storedMeasuresRules[measureId]) {
        newCube.storedMeasures[measureId] = value.drillUp(
          // @ts-ignore We are ignoring the `CatchAll` class here...
          this.dimensions,
          newDimensions,
          this.storedMeasuresRules[measureId][dimensionId],
        );
      }
    }

    return newCube;
  }

  /**
   * Create a new cube that contains the union of the measures
   *
   * This is useful when we want to create computed measures from different sources.
   * For instance, composing a cube with sells by day, and number of open hour per week,
   * to compute average sell by opening hour per week.
   */
  compose(
    otherCube: Cube,
    union: boolean | undefined = false,
    fillWith: Record<string, number> | null = null,
  ) {
    // @ts-ignore We are ignoring the `CatchAll` class here...
    const newDimensions: (GenericDimension | TimeDimension)[] =
      // @ts-ignore We are ignoring the `CatchAll` class here...
      this.dimensions.reduce((m, myDimension) => {
        const otherDimension = otherCube.getDimension(myDimension.id);

        if (!otherDimension) {
          return m;
        }

        if (union) {
          // @ts-ignore We are ignoring the `CatchAll` class here...
          return [...m, myDimension.union(otherDimension)] as (
            | GenericDimension
            | TimeDimension
          )[];
        }

        // @ts-ignore We are ignoring the `CatchAll` class here...
        return [...m, myDimension.intersect(otherDimension)] as (
          | GenericDimension
          | TimeDimension
        )[];
      }, []);

    const newCube = new Cube(newDimensions);

    this.storedMeasureIds.forEach((measureId) => {
      newCube.createStoredMeasure(
        measureId,
        this.storedMeasuresRules[measureId],
        this.storedMeasures[measureId]?._type,
        this.storedMeasures[measureId]?._defaultValue,
      );
      if (fillWith?.[measureId]) {
        newCube.fillData(measureId, fillWith[measureId]);
      }
      newCube.hydrateFromCube(this);
    });
    otherCube.storedMeasureIds.forEach((measureId) => {
      newCube.createStoredMeasure(
        measureId,
        otherCube.storedMeasuresRules[measureId],
        otherCube.storedMeasures[measureId]?._type,
        otherCube.storedMeasures[measureId]?._defaultValue,
      );
      if (fillWith?.[measureId]) {
        newCube.fillData(measureId, fillWith[measureId]);
      }
      newCube.hydrateFromCube(otherCube);
    });

    Object.assign(
      newCube.computedMeasures,
      this.computedMeasures,
      otherCube.computedMeasures,
    );
    return newCube;
  }

  reshape(targetDims: (CatchAll | GenericDimension | TimeDimension)[]) {
    let newCube: Cube = this;

    // Remove unneeded dimensions, and reorder.
    {
      const newCubeDimensionIds = newCube.dimensionIds;
      const commonDimensionIds = targetDims
        .filter((dim) => newCubeDimensionIds.includes(dim.id))
        .map((dim) => dim.id);

      newCube = newCube.project(commonDimensionIds);
    }

    // Add missing dimensions.
    for (let dimIndex = 0; dimIndex < targetDims.length; ++dimIndex) {
      const actualDim = newCube.dimensions[dimIndex];
      const targetDim = targetDims[dimIndex];

      if (!actualDim || (targetDim && actualDim.id !== targetDim.id)) {
        // fixme: we're not providing aggregation rules to the dimensions that must be added.
        // @ts-ignore We are ignoring the `CatchAll` class here...
        newCube = newCube.addDimension(targetDim, {}, dimIndex);
      }
    }

    // Drill to match root attributes
    for (let dimIndex = 0; dimIndex < targetDims.length; ++dimIndex) {
      const actualDim = newCube.dimensions[dimIndex];
      const targetDim = targetDims[dimIndex];

      if (!actualDim || !targetDim) {
        continue;
      }

      if (actualDim?.rootAttribute === targetDim?.rootAttribute) {
        continue;
      }

      if (actualDim.attributes.includes(targetDim.rootAttribute)) {
        newCube = newCube.drillUp(targetDim.id, targetDim.rootAttribute);
      } else if (targetDim.attributes.includes(actualDim.rootAttribute)) {
        newCube = newCube.drillDown(targetDim.id, targetDim.rootAttribute);
      } else {
        const err = `The cube dimensions '${targetDim.id}' are not compatible.`;
        throw new Error(err);
      }

      newCube = newCube.dice(
        targetDim.id,
        targetDim.rootAttribute,
        targetDim.getItems(),
        true,
      );
    }

    return newCube;
  }

  serialize() {
    return toBuffer({
      dimensions: this.dimensions.map((dim) => dim.serialize()),
      storedMeasuresKeys: Object.keys(this.storedMeasures),
      storedMeasures: Object.values(this.storedMeasures).map((measure) =>
        measure.serialize(),
      ),
      storedMeasuresRules: this.storedMeasuresRules,
      computedMeasures: Object.keys(this.computedMeasures).reduce<
        Record<string, string>
      >((acc, cur) => {
        const value = this.computedMeasures[cur]?.toString();
        if (value) {
          acc[cur] = value;
        }
        return acc;
      }, {}),
    });
  }

  serializeToBase64String() {
    return Buffer.from(this.serialize()).toString('base64');
  }

  static deserialize(buffer: ArrayBuffer) {
    const data = fromBuffer(buffer);
    // @ts-ignore Figure out correct fromBuffer type...
    const dimensions = data?.dimensions?.map((data) => deserialize(data));

    const cube = new Cube(dimensions);
    cube.storedMeasures = {};
    // @ts-ignore Figure out correct fromBuffer type...
    cube.storedMeasuresRules = data.storedMeasuresRules;
    // @ts-ignore Figure out correct fromBuffer type...
    data.storedMeasuresKeys.forEach((key, i) => {
      cube.storedMeasures[key] = InMemoryStore.deserialize(
        // @ts-ignore Figure out correct fromBuffer type...
        data.storedMeasures[i],
      );
    });
    // @ts-ignore Figure out correct fromBuffer type...
    cube.computedMeasures = Object.keys(data.computedMeasures).reduce<
      Record<string, Expression>
    >((acc, cur) => {
      // @ts-ignore Figure out correct fromBuffer type...
      const value = getParser().parse(data.computedMeasures[cur]);
      if (value) {
        acc[cur] = value;
      }
      return acc;
    }, {});
    return cube;
  }

  static deserializeFromBase64String(serializedBase64: string) {
    const buffer = Buffer.from(serializedBase64, 'base64');
    // biome-ignore lint/complexity/noThisInStatic: <explanation>
    return this.deserialize(toArrayBuffer(buffer));
  }
}
