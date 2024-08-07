const merge = require('lodash.merge');
const TimeSlot = require('timeslot-dag');
const cloneDeep = require('lodash.clonedeep');
const DimensionFactory = require('./dimension/factory');
const CatchAllDimension = require('./dimension/catch-all');
const { fromNestedArray, toNestedArray } = require('./formatter/nested-array');
const {
  fromNestedObject,
  toNestedObject,
} = require('./formatter/nested-object');
const { toBuffer, fromBuffer, toArrayBuffer } = require('./serialization');
const InMemoryStore = require('./store/in-memory');
const getParser = require('./parser');

function mapValues(obj, fn) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

function getCombinations(options) {
  const crossproduct = (xss) =>
    xss.reduce(
      (xs, ys) =>
        xs.flatMap((x) => {
          return ys.map((y) => [...x, y]);
        }),
      [[]],
    );

  return crossproduct(Object.values(options)).map((xs) =>
    Object.fromEntries(xs.map((x, i) => [Object.keys(options)[i], x])),
  );
}

class Cube {
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

  constructor(dimensions) {
    this.dimensions = dimensions;
    this.storedMeasures = {};
    this.storedMeasuresRules = {};
    this.computedMeasures = {};
  }

  clone(measures = []) {
    const cloneCube = new Cube(cloneDeep(this.dimensions));

    const filterMeasures = (measureIds) =>
      measures.length === 0
        ? measureIds
        : measureIds.filter((measureId) => measures.includes(measureId));
    const computedMeasuresToCopy = filterMeasures(this.computedMeasureIds);
    const storedMeasuresToCopy = filterMeasures(this.storedMeasureIds);

    computedMeasuresToCopy.forEach((measureId) => {
      cloneCube.computedMeasures[measureId] = this.computedMeasures[measureId];
    });
    storedMeasuresToCopy.forEach((measureId) => {
      cloneCube.storedMeasures[measureId] =
        this.storedMeasures[measureId].clone();
      cloneCube.storedMeasuresRules[measureId] = cloneDeep(
        this.storedMeasuresRules[measureId],
      );
    });

    return cloneCube;
  }

  getDimension(dimensionId) {
    return this.dimensions.find((d) => d.id === dimensionId);
  }

  getDimensionIndex(dimensionId) {
    return this.dimensions.findIndex((d) => d.id === dimensionId);
  }

  createComputedMeasure(measureId, formula) {
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
          return acc.replace(regex, `(${expression.toString()})`);
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

  copyStoredMeasure(measureId, copyMeasureId) {
    if (!/^[a-z][_a-z0-9]+$|^[_a-z0-9]+__total$/i.test(copyMeasureId))
      throw new Error(`Invalid measureId: ${copyMeasureId}`);

    if (this.storedMeasures[measureId] === undefined)
      throw new Error(`This measure does not exists: ${measureId}`);

    if (this.storedMeasures[copyMeasureId] !== undefined)
      throw new Error(`This measure already exists: ${copyMeasureId}`);

    this.storedMeasures[copyMeasureId] = cloneDeep(
      this.storedMeasures[measureId],
    );
    this.storedMeasuresRules[copyMeasureId] = cloneDeep(
      this.storedMeasuresRules[measureId],
    );
  }

  createStoredMeasure(
    measureId,
    rules = {},
    type = 'float32',
    defaultValue = 0,
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

  cloneStoredMeasure(originCube, measureId) {
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
    computedMeasureId,
    storedMeasureId,
    rules = {},
    type = 'float32',
    defaultValue = 0,
  ) {
    const data = this.getData(computedMeasureId);
    this.createStoredMeasure(storedMeasureId, rules, type, defaultValue);
    this.setData(storedMeasureId, data);
  }

  convertToStoredMeasure(
    measureId,
    rules = {},
    type = 'float32',
    defaultValue = 0,
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

  renameMeasure(oldMeasureId, newMeasureId) {
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (oldMeasureId == newMeasureId) return;

    if (this.computedMeasures[oldMeasureId]) {
      this.computedMeasures[newMeasureId] = this.computedMeasures[oldMeasureId];
      delete this.computedMeasures[oldMeasureId];
    } else if (this.storedMeasures[oldMeasureId]) {
      this.storedMeasures[newMeasureId] = this.storedMeasures[oldMeasureId];
      this.storedMeasuresRules[newMeasureId] =
        this.storedMeasuresRules[oldMeasureId];
      delete this.storedMeasures[oldMeasureId];
      delete this.storedMeasuresRules[oldMeasureId];

      for (const computedMeasureId in this.computedMeasures) {
        const expression = this.computedMeasures[computedMeasureId];
        const regex = new RegExp(`\\b${oldMeasureId}\\b`, 'g');
        if (expression.toString().match(regex)) {
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

  replaceStoredMeasure(toKeep, toDrop) {
    if (this.storedMeasures[toKeep] === undefined)
      throw new Error(`replaceStoredMeasure: no such measure ${toKeep}`);

    if (this.storedMeasures[toDrop] === undefined)
      throw new Error(`replaceStoredMeasure: no such measure ${toDrop}`);

    for (const computedMeasureId in this.computedMeasures) {
      const expression = this.computedMeasures[computedMeasureId];
      const regex = new RegExp(`\\b${toDrop}\\b`, 'g');
      if (expression.toString().match(regex)) {
        this.computedMeasures[computedMeasureId] = expression.substitute(
          toDrop,
          toKeep,
        );
      }
    }

    this.dropMeasure(toDrop);
  }

  dropMeasure(measureId) {
    if (this.computedMeasures[measureId] !== undefined) {
      delete this.computedMeasures[measureId];
    } else if (this.storedMeasures[measureId] !== undefined) {
      delete this.storedMeasures[measureId];
      delete this.storedMeasuresRules[measureId];
      Object.keys(this.computedMeasures).forEach((computedMeasureId) => {
        const expression = this.computedMeasures[computedMeasureId];
        if (expression.variables().includes(measureId)) {
          delete this.computedMeasures[computedMeasureId];
        }
      });
    } else {
      throw new Error(`dropMeasure: no such measure: ${measureId}`);
    }
  }

  dropMeasures(measureIds) {
    measureIds.forEach((measureId) => this.dropMeasure(measureId));
  }

  keepMeasure(measureId) {
    [...this.computedMeasureIds, ...this.storedMeasureIds]
      .filter((id) => id !== measureId)
      .forEach((id) => this.dropMeasure(id));
  }

  keepMeasures(measureIds) {
    [...this.computedMeasureIds, ...this.storedMeasureIds]
      .filter((id) => !measureIds.includes(id))
      .forEach((id) => this.dropMeasure(id));
  }

  collapse() {
    return this.dimensionIds.reduce((acc, curr) => {
      return acc.slice(curr, 'all', 'all');
    }, this);
  }

  getData(measureId) {
    if (this.storedMeasures[measureId] !== undefined) {
      return this.storedMeasures[measureId].data;
    }

    if (this.computedMeasures[measureId] !== undefined) {
      const storeSize = this.storeSize;
      const params = {};

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
          params[measureId] =
            this.storedMeasures[measureId.replace('__total', '')].total;
        });

      // Fill result array
      const result = new Array(storeSize);

      for (let i = 0; i < storeSize; ++i) {
        for (let j = 0; j < storedMeasures.length; ++j) {
          params[storedMeasures[j]] =
            this.storedMeasures[storedMeasures[j]].getValue(i);
        }

        result[i] = this.computedMeasures[measureId].evaluate(params);
      }

      return result;
    }

    throw new Error(`getData: no such measure ${measureId}`);
  }

  getStatusMap(measureId) {
    if (this.storedMeasures[measureId] !== undefined) {
      return this.storedMeasures[measureId]._dataMap;
    }

    if (this.computedMeasures[measureId] !== undefined) {
      const result = new Map();
      for (const storedMeasureId in this.storedMeasures) {
        const dataMap = this.storedMeasures[storedMeasureId]._dataMap;
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

  fillData(measureId, value) {
    if (this.storedMeasures[measureId]) {
      this.storedMeasures[measureId].fill(value);
    } else
      throw new Error(
        `fillData can only be called on stored measures: ${measureId}`,
      );
  }

  setData(measureId, values) {
    if (this.storedMeasures[measureId]) {
      this.storedMeasures[measureId].data = values;
    } else
      throw new Error(
        `setData can only be called on stored measures: ${measureId}`,
      );
  }

  getNestedArray(measureId) {
    const data = this.getData(measureId);
    const statusMap = this.getStatusMap(measureId);

    return toNestedArray(data, statusMap, this.dimensions);
  }

  setNestedArray(measureId, values) {
    const data = fromNestedArray(values, this.dimensions);
    this.setData(measureId, data);
  }

  getNestedObject(measureId, withTotals = false) {
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (!withTotals || this.dimensions.length == 0) {
      const data = this.getData(measureId);
      const statusMap = this.getStatusMap(measureId);
      return toNestedObject(data, statusMap, this.dimensions);
    }

    const result = {};
    for (let j = 0; j < 2 ** this.dimensions.length; ++j) {
      let subCube = this;
      for (let i = 0; i < this.dimensions.length; ++i)
        if (j & (1 << i))
          subCube = subCube.drillUp(this.dimensions[i].id, 'all');

      merge(result, subCube.getNestedObject(measureId, false));
    }

    return result;
  }

  getNestedObjects(measureIds, withTotals = false) {
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (!withTotals || this.dimensions.length == 0) {
      return measureIds.reduce((acc, measureId) => {
        const data = this.getData(measureId);
        const statusMap = this.getStatusMap(measureId);

        acc[measureId] = toNestedObject(data, statusMap, this.dimensions);
        return acc;
      }, {});
    }

    const result = {};
    for (let j = 0; j < 2 ** this.dimensions.length; ++j) {
      let subCube = this;
      for (let i = 0; i < this.dimensions.length; ++i)
        if (j & (1 << i))
          subCube = subCube.drillUp(this.dimensions[i].id, 'all');

      merge(result, subCube.getNestedObjects(measureIds, false));
    }

    return result;
  }

  setNestedObject(measureId, value) {
    const data = fromNestedObject(value, this.dimensions);
    this.setData(measureId, data);
  }

  hydrateFromSparseNestedObject(measureId, obj, offset = 0, dimOffset = 0) {
    if (dimOffset === this.dimensions.length) {
      this.storedMeasures[measureId].setValue(offset, obj);
      return;
    }

    const dimension = this.dimensions[dimOffset];
    for (const key in obj) {
      const itemOffset = dimension.getRootIndexFromRootItem(key);
      if (itemOffset !== -1) {
        const newOffset = offset * dimension.numItems + itemOffset;
        this.hydrateFromSparseNestedObject(
          measureId,
          obj[key],
          newOffset,
          dimOffset + 1,
        );
      }
    }
  }

  setSingleData(measureId, coords, value) {
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

  getSingleData(measureId, coords) {
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

      const params = measures.reduce((acc, measureId) => {
        acc[measureId] = this.storedMeasures[measureId].getValue(position);
        return acc;
      }, {});

      return this.computedMeasures[measureId].evaluate(params);
    }

    throw new Error(`getSingleData: no such measure ${measureId}`);
  }

  /*
   * This function returns an array of all possible combinations of dimension items
   * It takes an array of dimension ids to include from the combinations generation process
   */
  scan(dimensionIds, cb) {
    const combinations = getCombinations(
      this.getDimensionItemsMap(dimensionIds),
    );

    combinations.forEach((combination) => {
      const dicedCube = this.diceByDimensionItems(combination);
      cb(dicedCube, combination);
    });
  }

  /*
   * This function takes an array of dimension ids and returns a new cube with
   * the specified dimensions sliced by the specified dimension items
   */
  aggregateByDimensions(excludeDimensionIds) {
    return this.dimensionIds
      .filter((d) => !excludeDimensionIds.includes(d))
      .reduce((acc, dimension) => {
        return acc.slice(dimension, 'all', 'all');
      }, this);
  }

  /*
   * This function returns an object with dimension id as key and dimension items as value.
   * It takes optionally an oarray of dimension ids which will be used to filter the dimensions.
   * If no dimension ids are provided, all dimensions will be used.
   */
  getDimensionItemsMap(dimensionIds) {
    const filteredDimensionIds =
      dimensionIds != null
        ? this.dimensionIds.filter((d) => dimensionIds.includes(d))
        : this.dimensionIds;

    const dimensionItemsMap = filteredDimensionIds.reduce(
      (acc, cur) => ({
        ...acc,
        [cur]: this.getDimension(cur).getItems(),
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
  diceByDimensionItems(dimensionItemsMap, measures = [], reorder = false) {
    const newDimensions = this.dimensions.slice();
    Object.entries(dimensionItemsMap).forEach(([dimensionId, items]) => {
      const dimIdx = this.getDimensionIndex(dimensionId);
      if (dimIdx === -1) return;
      const rootAttribute =
        dimensionId === 'time'
          ? TimeSlot.fromValue(items).periodicity
          : this.dimensions[dimIdx].rootAttribute;
      newDimensions[dimIdx] = newDimensions[dimIdx].dice(
        rootAttribute,
        [items].flat(),
        reorder,
      );
    });

    // early return if no dimensions were diced
    if (newDimensions.every((d, i) => d === this.dimensions[i])) {
      return this;
    }

    const newCube = new Cube(newDimensions);
    const filterMeasures = (measureIds) =>
      measures.length === 0
        ? measureIds
        : measureIds.filter((measureId) => measures.includes(measureId));
    const computedMeasuresToCopy = filterMeasures(this.computedMeasureIds);
    const storedMeasuresToCopy = filterMeasures(this.storedMeasureIds);

    computedMeasuresToCopy.forEach((measureId) => {
      newCube.computedMeasures[measureId] = this.computedMeasures[measureId];
    });
    storedMeasuresToCopy.forEach((measureId) => {
      newCube.storedMeasures[measureId] = this.storedMeasures[measureId].dice(
        this.dimensions,
        newDimensions,
      );
      newCube.storedMeasuresRules[measureId] = cloneDeep(
        this.storedMeasuresRules[measureId],
      );
    });

    return newCube;
  }

  /*
   * This function iterates over all possible combinations of dimension items and
   * calls the callback function with the sliced cube for each combination of dimension items
   */
  iterateOverDimension(dimension, cb) {
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
      cb(slicedCube, dimensionItems);
    });
  }

  getDistribution(measureId, dimensionsFilter = {}) {
    const spaceSum = this.getTotalForDimensionItems(
      measureId,
      dimensionsFilter,
    );
    const totalSum = this.getTotal(measureId);

    return totalSum === 0 ? spaceSum : spaceSum / totalSum;
  }

  getTotal(measureId) {
    return this.storedMeasures[measureId].total;
  }

  getTotalForDimensionItems(measureId, dimensionsFilter = {}) {
    const _dimensionsFilter = mapValues(dimensionsFilter, (value) => {
      if (typeof value === 'string') {
        return [value];
      }
      return value;
    });

    const unspecifiedDimensions = this.dimensionIds.filter(
      (dimensionId) => dimensionsFilter[dimensionId] === undefined,
    );

    const combinations = getCombinations(
      unspecifiedDimensions.reduce(
        (acc, dimensionId) => ({
          ...acc,
          [dimensionId]: this.getDimension(dimensionId).getItems(),
        }),
        _dimensionsFilter,
      ),
    );

    const spaceSum = combinations.reduce((acc, combination) => {
      const value = this.getSingleData(measureId, combination);
      return acc + value;
    }, 0);

    return spaceSum;
  }

  getPosition(coords) {
    let position = 0;
    for (let i = 0; i < this.dimensions.length; ++i) {
      const dimension = this.dimensions[i];
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

  hydrateFromCube(otherCube) {
    // Exception == the cubes have no overlap, it is safe to skip this one.
    let compatibleCube;
    try {
      compatibleCube = otherCube.reshape(this.dimensions);
    } catch {
      return;
    }

    for (const measureId in this.storedMeasures)
      if (compatibleCube.storedMeasures[measureId])
        this.storedMeasures[measureId].load(
          compatibleCube.storedMeasures[measureId],
          this.dimensions,
          compatibleCube.dimensions,
        );
  }

  updateStoredMeasureRules(measureId, cb) {
    const newRules = cb(this.storedMeasuresRules[measureId]);
    this.storedMeasuresRules[measureId] = newRules;
  }

  project(dimensionIds) {
    return this.keepDimensions(dimensionIds).reorderDimensions(dimensionIds);
  }

  reorderDimensions(dimensionIds) {
    // Check for no-op
    let dimIdx = 0;
    for (; dimIdx < this.dimensions.length; ++dimIdx) {
      if (dimensionIds[dimIdx] !== this.dimensions[dimIdx].id) {
        break;
      }
    }

    if (dimIdx === this.dimensions.length) {
      return this;
    }

    // Write a new cube
    const newDimensions = dimensionIds.map((id) =>
      this.dimensions.find((dim) => dim.id === id),
    );
    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures)
      newCube.storedMeasures[measureId] = this.storedMeasures[
        measureId
      ].reorder(this.dimensions, newDimensions);

    return newCube;
  }

  swapDimensions(dim1, dim2) {
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

  slice(dimensionId, attribute, value) {
    const dimIndex = this.getDimensionIndex(dimensionId);
    if (dimIndex === -1)
      throw new Error(`slice: no such dimension: ${dimensionId}`);

    return this.dice(dimensionId, attribute, [value]).removeDimension(
      dimensionId,
    );
  }

  diceRange(dimensionId, attribute, start, end) {
    const dimIdx = this.getDimensionIndex(dimensionId);
    const newDimensions = this.dimensions.slice();
    newDimensions[dimIdx] = newDimensions[dimIdx].diceRange(
      attribute,
      start,
      end,
    );
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newDimensions[dimIdx] == this.dimensions[dimIdx]) {
      return this;
    }

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures)
      newCube.storedMeasures[measureId] = this.storedMeasures[measureId].dice(
        this.dimensions,
        newDimensions,
      );

    return newCube;
  }

  dice(dimensionId, attribute, items, reorder = false) {
    const dimIdx = this.getDimensionIndex(dimensionId);
    const newDimensions = this.dimensions.slice();
    newDimensions[dimIdx] = newDimensions[dimIdx].dice(
      attribute,
      items,
      reorder,
    );
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newDimensions[dimIdx] == this.dimensions[dimIdx]) {
      return this;
    }

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures)
      newCube.storedMeasures[measureId] = this.storedMeasures[measureId].dice(
        this.dimensions,
        newDimensions,
      );

    return newCube;
  }

  copyMeasureData(sourceMeasureId, targetMeasureId, dimensionsFilter = {}) {
    const _dimensionsFilter = {};
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
      unspecifiedDimensions.reduce(
        (acc, dimensionId) => ({
          ...acc,
          [dimensionId]: this.getDimension(dimensionId).getItems(),
        }),
        _dimensionsFilter,
      ),
    );

    for (let i = 0; i < combinations.length; i++) {
      const combination = combinations[i];
      const value = this.getSingleData(sourceMeasureId, combination);
      this.setSingleData(targetMeasureId, combination, value);
    }
  }

  keepDimensions(dimensionIds) {
    let cube = this;
    for (const dimension of this.dimensions) {
      if (!dimensionIds.includes(dimension.id)) {
        cube = cube.removeDimension(dimension.id);
      }
    }

    return cube;
  }

  removeDimensions(dimensionIds) {
    let cube = this;
    for (const dimensionId of dimensionIds) {
      cube = cube.removeDimension(dimensionId);
    }

    return cube;
  }

  addDimension(
    newDimension,
    aggregation = {},
    index = null,
    distributions = {},
  ) {
    // If index is not provided, we append the dimension
    const workingIndex = index === null ? this.dimensions.length : index;

    const oldDimensions = this.dimensions.slice();
    oldDimensions.splice(
      workingIndex,
      0,
      new CatchAllDimension(newDimension.id, newDimension),
    );

    const newDimensions = oldDimensions.slice();
    newDimensions[workingIndex] = newDimension;

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    newCube.storedMeasuresRules = cloneDeep(this.storedMeasuresRules);
    for (const measureId in this.storedMeasuresRules) {
      newCube.storedMeasuresRules[measureId][newDimension.id] =
        aggregation[measureId];
    }

    for (const measureId in this.storedMeasures)
      newCube.storedMeasures[measureId] = this.storedMeasures[
        measureId
      ].drillDown(
        oldDimensions,
        newDimensions,
        aggregation[measureId],
        distributions[measureId],
      );

    return newCube;
  }

  removeDimension(dimensionId) {
    const newDimensions = this.dimensions.filter(
      (dim) => dim.id !== dimensionId,
    );
    const newCube = new Cube(newDimensions);
    newCube.storedMeasures = this.drillUp(dimensionId, 'all').storedMeasures;
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    newCube.storedMeasuresRules = cloneDeep(this.storedMeasuresRules);

    for (const measureId in newCube.storedMeasuresRules) {
      delete newCube.storedMeasuresRules[measureId][dimensionId];
    }

    return newCube;
  }

  drillDown(dimensionId, attribute) {
    const dimIdx = this.getDimensionIndex(dimensionId);
    if (this.dimensions[dimIdx].rootAttribute === attribute) return this;

    const newDimensions = this.dimensions.slice();
    newDimensions[dimIdx] = newDimensions[dimIdx].drillDown(attribute);
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newDimensions[dimIdx] == this.dimensions[dimIdx]) return this;

    const newCube = new Cube(newDimensions);
    Object.assign(newCube.computedMeasures, this.computedMeasures);
    Object.assign(newCube.storedMeasuresRules, this.storedMeasuresRules);
    for (const measureId in this.storedMeasures) {
      newCube.storedMeasures[measureId] = this.storedMeasures[
        measureId
      ].drillDown(
        this.dimensions,
        newDimensions,
        this.storedMeasuresRules[measureId][dimensionId],
      );
    }

    return newCube;
  }

  /**
   * Aggregate a dimension by group values.
   * ie: minutes by hour, or cities by region.
   */
  drillUp(dimensionId, attribute) {
    const dimIdx = this.getDimensionIndex(dimensionId);
    if (this.dimensions[dimIdx].rootAttribute === attribute) return this;

    const newDimensions = this.dimensions.slice();
    newDimensions[dimIdx] = newDimensions[dimIdx].drillUp(attribute);
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
      newCube.storedMeasures[measureId] = this.storedMeasures[
        measureId
      ].drillUp(
        this.dimensions,
        newDimensions,
        this.storedMeasuresRules[measureId][dimensionId],
      );
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
  compose(otherCube, union = false, fillWith = null) {
    const newDimensions = this.dimensions.reduce((m, myDimension) => {
      const otherDimension = otherCube.getDimension(myDimension.id);

      if (!otherDimension) {
        return m;
      }

      if (union) {
        return [...m, myDimension.union(otherDimension)];
      }

      return [...m, myDimension.intersect(otherDimension)];
    }, []);

    const newCube = new Cube(newDimensions);

    this.storedMeasureIds.forEach((measureId) => {
      newCube.createStoredMeasure(
        measureId,
        this.storedMeasuresRules[measureId],
        this.storedMeasures[measureId]._type,
        this.storedMeasures[measureId]._defaultValue,
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
        otherCube.storedMeasures[measureId]._type,
        otherCube.storedMeasures[measureId]._defaultValue,
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

  reshape(targetDims) {
    let newCube = this;

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

      if (!actualDim || actualDim.id !== targetDim.id) {
        // fixme: we're not providing aggregation rules to the dimensions that must be added.
        newCube = newCube.addDimension(targetDim, {}, dimIndex);
      }
    }

    // Drill to match root attributes
    for (let dimIndex = 0; dimIndex < targetDims.length; ++dimIndex) {
      const actualDim = newCube.dimensions[dimIndex];
      const targetDim = targetDims[dimIndex];

      if (actualDim.rootAttribute === targetDim.rootAttribute) {
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
      computedMeasures: Object.keys(this.computedMeasures).reduce(
        (acc, cur) => {
          acc[cur] = this.computedMeasures[cur].toString();
          return acc;
        },
        {},
      ),
    });
  }

  serializeToBase64String() {
    return Buffer.from(this.serialize()).toString('base64');
  }

  static deserialize(buffer) {
    const data = fromBuffer(buffer);
    const dimensions = data.dimensions.map((data) =>
      DimensionFactory.deserialize(data),
    );

    const cube = new Cube(dimensions);
    cube.storedMeasures = {};
    cube.storedMeasuresRules = data.storedMeasuresRules;
    data.storedMeasuresKeys.forEach((key, i) => {
      cube.storedMeasures[key] = InMemoryStore.deserialize(
        data.storedMeasures[i],
      );
    });
    cube.computedMeasures = Object.keys(data.computedMeasures).reduce(
      (acc, cur) => {
        acc[cur] = getParser().parse(data.computedMeasures[cur]);
        return acc;
      },
      {},
    );
    return cube;
  }

  static deserializeFromBase64String(serializedBase64) {
    const buffer = Buffer.from(serializedBase64, 'base64');
    // biome-ignore lint/complexity/noThisInStatic: <explanation>
    return this.deserialize(toArrayBuffer(buffer));
  }
}

module.exports = Cube;
