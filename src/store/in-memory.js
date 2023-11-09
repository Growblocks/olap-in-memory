const { toBuffer, fromBuffer } = require('../serialization');

/**
 * The data array can be millions of items.
 * => Avoid allocations in the loops to keep things acceptably fast.
 */
class InMemoryStore {
    get byteLength() {
        const typeToSize = {
            int32: 4,
            uint32: 4,
            float32: 4,
            float64: 8,
        };
        return this._size * (typeToSize[this._type] || 1);
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
            throw new Error(`value length is invalid: ${this._size} !== ${values.length}`);

        for (let i = 0; i < this._size; ++i) this.setValue(i, values[i]);
    }

    constructor(size, type = 'float32', defaultValue = NaN, dataMap = undefined) {
        this._size = size;
        this._type = type;
        if (!isNaN(defaultValue) && defaultValue !== 0)
            throw new Error('Invalid default value, only NaN and 0 are supported');

        if (!['int32', 'uint32', 'float32', 'float64'].includes(type))
            throw new Error('Invalid type');

        this._defaultValue = defaultValue;
        this._dataMap = new Map(dataMap);
    }

    clone() {
        return new InMemoryStore(this._size, this._type, this._defaultValue, this._dataMap);
    }

    serialize() {
        let dataBuffer;
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

    static deserialize(buffer) {
        const data = fromBuffer(buffer);
        const store = new InMemoryStore(0);
        store._size = data.size;
        store._type = data.type;
        store._defaultValue = data.defaultValue;
        store._dataMap = new Map(
            data.indexes.reduce((acc, v, i) => {
                acc.push([v, data.dataBuffer[i]]);
                return acc;
            }, [])
        );
        return store;
    }

    getValue(index) {
        return this._dataMap.get(index) ?? this._defaultValue;
    }

    setValue(index, value) {
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

    fill(value) {
        for (let i = 0; i < this._size; ++i) this.setValue(i, value);
    }

    load(otherStore, myDimensions, hisDimensions) {
        const numDimensions = myDimensions.length;
        const hisDimLengths = hisDimensions.map(dim => dim.numItems);
        const myDimLengths = myDimensions.map(dim => dim.numItems);
        const dimIdxHisMineMap = hisDimensions.map((hisDimension, index) => {
            const hisItems = hisDimension.getItems();
            const myItemsToIdx = myDimensions[index].getItemsToIdx();

            return hisItems.map(newItem => myItemsToIdx[newItem]);
        });

        const hisDimIdx = new Uint32Array(numDimensions);
        for (const [hisIdx, hisValue] of otherStore._dataMap.entries()) {
            // Decompose new index into dimensions indexes
            let hisIdxCpy = hisIdx;
            for (let i = numDimensions - 1; i >= 0; --i) {
                hisDimIdx[i] = hisIdxCpy % hisDimLengths[i];
                hisIdxCpy = Math.floor(hisIdxCpy / hisDimLengths[i]);
            }

            // Compute what the old index was
            let myIdx = 0;
            for (let i = 0; i < numDimensions; ++i) {
                let offset = dimIdxHisMineMap[i][hisDimIdx[i]];
                myIdx = myIdx * myDimLengths[i] + offset;
            }

            this.setValue(myIdx, hisValue);
        }
    }

    reorder(oldDimensions, newDimensions) {
        const newStore = new InMemoryStore(this._size, this._type, this._defaultValue);

        const numDimensions = newDimensions.length;
        const newToOldDimIdx = newDimensions.map(newDim => oldDimensions.indexOf(newDim));

        const oldDimIdx = new Uint32Array(numDimensions);

        for (const [oldIdx, oldValue] of this._dataMap.entries()) {
            // Decompose new index into dimensions indexes
            let oldIdxCopy = oldIdx;
            for (let i = numDimensions - 1; i >= 0; --i) {
                oldDimIdx[i] = oldIdxCopy % oldDimensions[i].numItems;
                oldIdxCopy = Math.floor(oldIdxCopy / oldDimensions[i].numItems);
            }

            // Compute what the old index was
            let newIdx = 0;
            for (let i = 0; i < numDimensions; ++i) {
                let oldDimIndex = newToOldDimIdx[i];
                newIdx = newIdx * newDimensions[i].numItems + oldDimIdx[oldDimIndex];
            }

            newStore.setValue(newIdx, oldValue);
        }

        return newStore;
    }

    dice(oldDimensions, newDimensions) {
        const newLength = newDimensions.reduce((m, d) => m * d.numItems, 1);
        const numDimensions = newDimensions.length;
        const oldDimLength = oldDimensions.map(dim => dim.numItems);
        const newDimLength = newDimensions.map(dim => dim.numItems);

        const dimIdxNewOldMap = newDimensions.map((dimension, index) => {
            const newItems = dimension.getItems();
            const oldItemsToIdx = oldDimensions[index].getItemsToIdx();

            return new Map(newItems.map((newItem, i) => [oldItemsToIdx[newItem], i]));
        });

        const newStore = new InMemoryStore(newLength, this._type, this._defaultValue);

        let oldDimensionIndex = new Uint32Array(numDimensions);
        let newDimensionIndex = new Uint32Array(numDimensions);

        for (const [oldIdx, oldValue] of this._dataMap.entries()) {
            let oldIndexCopy = oldIdx;
            let halt = false;
            for (let i = numDimensions - 1; i >= 0; --i) {
                oldDimensionIndex[i] = oldIndexCopy % oldDimLength[i];

                const newDimIdx = dimIdxNewOldMap[i].get(oldDimensionIndex[i]);

                if (newDimIdx === undefined) {
                    halt = true;
                    break;
                }

                newDimensionIndex[i] = newDimIdx;

                oldIndexCopy = Math.floor(oldIndexCopy / oldDimLength[i]);
            }
            if (halt) continue;

            let newIdx = 0;
            for (let i = 0; i < numDimensions; ++i) {
                newIdx = newIdx * newDimLength[i] + newDimensionIndex[i];
            }

            newStore.setValue(newIdx, oldValue);
        }

        return newStore;
    }

    drillUp(oldDimensions, newDimensions, method = 'sum') {
        const newSize = newDimensions.reduce((m, d) => m * d.numItems, 1);
        const numDimensions = newDimensions.length;
        const oldDimLength = oldDimensions.map(dim => dim.numItems);
        const newDimLength = newDimensions.map(dim => dim.numItems);
        const dimIdxOldNewMap = newDimensions.map((newDim, index) => {
            return oldDimensions[index].getGroupIndexFromRootIndexMap(newDim.rootAttribute);
        });

        const newStore = new InMemoryStore(newSize, this._type, this._defaultValue);

        const contributions = new Uint16Array(newSize);
        let oldDimensionIndex = new Uint32Array(numDimensions);

        // Define aggregation operations
        const aggregations = {
            sum: (a, b) => a + b,
            average: (a, b) => a + b, // Average will be handled after summing
            highest: (a, b) => Math.max(a, b),
            lowest: (a, b) => Math.min(a, b),
            first: (a, _) => a,
            last: (_, b) => b,
            product: (a, b) => a * b,
        };
        const aggregate = aggregations[method];

        // Ensure the aggregate function is defined
        if (!aggregate) {
            throw new Error(`Unsupported aggregation method: ${method}`);
        }

        for (const [oldIdx, oldValue] of this._dataMap.entries()) {
            let oldIndexCopy = oldIdx;
            for (let i = numDimensions - 1; i >= 0; --i) {
                oldDimensionIndex[i] = oldIndexCopy % oldDimLength[i];
                oldIndexCopy = Math.floor(oldIndexCopy / oldDimLength[i]);
            }

            let newIdx = 0;
            for (let i = 0; i < numDimensions; ++i) {
                let offset = dimIdxOldNewMap[i][oldDimensionIndex[i]];
                newIdx = newIdx * newDimLength[i] + offset;
            }

            if (!newStore._dataMap.has(newIdx)) {
                newStore.setValue(newIdx, oldValue);
            } else {
                newStore.setValue(newIdx, aggregate(newStore.getValue(newIdx), oldValue));
            }

            contributions[newIdx] += 1;
        }

        if (method === 'average') {
            for (let newIdx = 0; newIdx < newStore._size; ++newIdx) {
                if (contributions[newIdx])
                    newStore.setValue(newIdx, newStore.getValue(newIdx) / contributions[newIdx]);
            }
        }

        return newStore;
    }

    drillDown(oldDimensions, newDimensions, method = 'sum', distributions) {
        const useRounding = this._type == 'int32' || this._type == 'uint32';
        const oldSize = this._size;
        const newSize = newDimensions.reduce((m, d) => m * d.numItems, 1);
        const numDimensions = newDimensions.length;
        const oldDimLength = oldDimensions.map(dim => dim.numItems);
        const newDimLength = newDimensions.map(dim => dim.numItems);
        const dimIdxNewOldMap = oldDimensions.map((oldDim, index) => {
            return newDimensions[index].getGroupIndexFromRootIndexMap(oldDim.rootAttribute);
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
                newDimensionIndex[i] = newIndexCopy % newDimLength[i];
                newIndexCopy = Math.floor(newIndexCopy / newDimLength[i]);
            }

            // Compute corresponding old index
            let oldIdx = 0;
            for (let j = 0; j < numDimensions; ++j) {
                let offset = dimIdxNewOldMap[j][newDimensionIndex[j]];
                oldIdx = oldIdx * oldDimLength[j] + offset;
            }

            // Depending on aggregation method, copy value.
            idxNewOld[newIdx] = oldIdx;
            contributionsTotal[oldIdx] += 1;
        }

        const newStore = new InMemoryStore(newSize, this._type, this._defaultValue);

        for (let newIdx = 0; newIdx < newSize; ++newIdx) {
            const oldIdx = idxNewOld[newIdx];

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
                    throw new Error('distribution missing for index ' + distIndex);

                newStore.setValue(newIdx, oldValue * distributions[distIndex]);
            } else {
                if (method === 'sum') {
                    if (useRounding) {
                        const value = Math.floor(oldValue / numContributions);
                        const remainder = oldValue % numContributions;
                        const contributionId = contributionsIds[oldIdx];
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

            contributionsIds[oldIdx]++;
        }

        return newStore;
    }
}

module.exports = InMemoryStore;
