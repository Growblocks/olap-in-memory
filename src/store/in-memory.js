const { toBuffer, fromBuffer } = require('../serialization');

/**
 * The data array can be millions of items.
 * => Avoid allocations in the loops to keep things acceptably fast.
 */
class InMemoryStore {
    get byteLength() {
        if (this._type == 'int32' || this._type == 'uint32' || this._type == 'float32')
            return this._size * 4;
        else if (this._type == 'float64') return this._size * 8;
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
        this._dataMap = typeof dataMap === 'undefined' ? new Map() : dataMap;
    }

    clone() {
        return new InMemoryStore(this._size, this._type, this._defaultValue, this._dataMap);
    }

    serialize() {
        return toBuffer({
            size: this._size,
            type: this._type,
            defaultValue: this._defaultValue,
            dataMap: Object.fromEntries(this._dataMap),
        });
    }

    static deserialize(buffer) {
        const data = fromBuffer(buffer);
        const store = new InMemoryStore(0);
        store._size = data.size;
        store._type = data.type;
        store._defaultValue = data.defaultValue;
        store._dataMap = new Map(Object.entries(data.dataMap).map(([k, v]) => [parseInt(k), v]));
        return store;
    }

    getValue(index) {
        return this._dataMap.get(index) || this._defaultValue;
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

            return newItems.map(newItem => oldItemsToIdx[newItem]);
        });

        const newStore = new InMemoryStore(newLength, this._type, this._defaultValue);

        let oldDimensionIndex = new Uint32Array(numDimensions);
        let newDimensionIndex = new Uint32Array(numDimensions);

        for (const [oldIdx, oldValue] of this._dataMap.entries()) {
            let oldIndexCopy = oldIdx;
            let halt = false;
            for (let i = numDimensions - 1; i >= 0; --i) {
                oldDimensionIndex[i] = oldIndexCopy % oldDimLength[i];

                const newDimIdx = dimIdxNewOldMap[i].indexOf(oldDimensionIndex[i]);

                if (newDimIdx === -1) {
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

            const newValue = newStore.getValue(newIdx);

            if (isNaN(newValue) || newValue === this._defaultValue) {
                newStore.setValue(newIdx, oldValue);
            } else {
                if (method == 'last') newStore.setValue(newIdx, oldValue);
                else if (method == 'highest')
                    newStore.setValue(newIdx, newValue < oldValue ? oldValue : newValue);
                else if (method == 'lowest')
                    newStore.setValue(newIdx, newValue < oldValue ? newValue : oldValue);
                else if (method == 'sum' || method == 'average')
                    newStore.setValue(newIdx, newValue + oldValue);
                else if (method == 'product') newStore.setValue(newIdx, newValue * oldValue);
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

    /** fixme: This could be more memory efficient by doing like the other, instead of mapping all indexes */
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
            const oldValue = this.getValue(oldIdx);

            const numContributions = contributionsTotal[oldIdx];
            // TODO: optimize this later

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

                        newStore.setValue(newIdx, Math.floor(value));
                        if (!lastIsSame) {
                            const newValue = newStore.getValue(newIdx);
                            newStore.setValue(newIdx, newValue + 1);
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
