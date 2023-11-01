const { toBuffer, fromBuffer } = require('../serialization');

/**
 * The data array can be millions of items.
 * => Avoid allocations in the loops to keep things acceptably fast.
 */
class InMemoryStore {
    get byteLength() {
        return this._data.byteLength;
    }

    get data() {
        const result = new Array(this._data.length).fill(this._defaultValue);
        for (let index of this._statusMap.keys()) {
            result[index] = this._data[index];
        }

        return result;
    }

    set data(values) {
        if (this._size !== values.length)
            throw new Error(`value length is invalid: ${this._size} !== ${values.length}`);

        for (let i = 0; i < this._size; ++i) this.setValue(i, values[i]);
    }

    constructor(
        size,
        type = 'float32',
        defaultValue = NaN,
        data = undefined,
        statusMap = undefined
    ) {
        this._size = size;
        this._type = type;
        this._defaultValue = defaultValue;
        this._statusMap = typeof statusMap === 'undefined' ? new Map() : statusMap;

        if (type == 'int32') this._data = new Int32Array(size);
        else if (type == 'uint32') this._data = new Uint32Array(size);
        else if (type == 'float32') this._data = new Float32Array(size);
        else if (type == 'float64') this._data = new Float64Array(size);
        else throw new Error('Invalid type');

        data ? (this._data = data.slice()) : this._data.fill(defaultValue);
    }

    clone() {
        return new InMemoryStore(
            this._size,
            this._type,
            this._defaultValue,
            this._data,
            this._statusMap
        );
    }

    serialize() {
        return toBuffer({
            size: this._size,
            type: this._type,
            data: this._data,
            defaultValue: this._defaultValue,
            // transform status map in an object
            statusMap: Object.fromEntries(this._statusMap),
        });
    }

    static deserialize(buffer) {
        const data = fromBuffer(buffer);
        const store = new InMemoryStore(0);
        store._size = data.size;
        store._type = data.type;
        store._data = data.data;
        store._defaultValue = data.defaultValue;
        store._statusMap = new Map(
            Object.entries(data.statusMap).map(([k, v]) => [parseInt(k), v])
        );
        return store;
    }

    getValue(index) {
        return this._statusMap.get(index) ? this._data[index] : this._defaultValue;
    }

    setValue(index, value) {
        if (value != null && value !== this._defaultValue) {
            this._data[index] = value;
            this._statusMap.set(index, true);
        } else {
            this._statusMap.delete(index);
        }
    }

    load(otherStore, myDimensions, hisDimensions) {
        const hisLength = otherStore._size;
        const numDimensions = myDimensions.length;
        const hisDimLengths = hisDimensions.map(dim => dim.numItems);
        const myDimLengths = myDimensions.map(dim => dim.numItems);
        const dimIdxHisMineMap = hisDimensions.map((hisDimension, index) => {
            const hisItems = hisDimension.getItems();
            const myItemsToIdx = myDimensions[index].getItemsToIdx();

            return hisItems.map(newItem => myItemsToIdx[newItem]);
        });

        const hisDimIdx = new Uint32Array(numDimensions);
        // TODO: optimize this later
        // for (let hisIdx of otherStore._statusMap.keys()) {
        for (let hisIdx = 0; hisIdx < hisLength; ++hisIdx) {
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

            this.setValue(myIdx, otherStore._data[hisIdx]);
        }
    }

    reorder(oldDimensions, newDimensions) {
        const newStore = new InMemoryStore(this._size, this._type, this._defaultValue);

        const numDimensions = newDimensions.length;
        const newToOldDimIdx = newDimensions.map(newDim => oldDimensions.indexOf(newDim));

        const oldDimIdx = new Uint32Array(numDimensions);

        for (let oldIdx of this._statusMap.keys()) {
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

            newStore.setValue(newIdx, this._data[oldIdx]);
        }

        return newStore;
    }

    dice(oldDimensions, newDimensions) {
        // Cache
        const newLength = newDimensions.reduce((m, d) => m * d.numItems, 1);
        const numDimensions = newDimensions.length;
        const oldDimLength = oldDimensions.map(dim => dim.numItems);
        const newDimLength = newDimensions.map(dim => dim.numItems);
        const dimIdxNewOldMap = newDimensions.map((dimension, index) => {
            const newItems = dimension.getItems();
            const oldItemsToIdx = oldDimensions[index].getItemsToIdx();

            return newItems.map(newItem => oldItemsToIdx[newItem]);
        });

        // Rewrite data vector.
        const newStore = new InMemoryStore(newLength, this._type, this._defaultValue);
        const newDimIdx = new Uint32Array(numDimensions);
        for (let newIdx = 0; newIdx < newLength; ++newIdx) {
            // Decompose new index into dimensions indexes
            let newIdxCpy = newIdx;
            for (let i = numDimensions - 1; i >= 0; --i) {
                newDimIdx[i] = newIdxCpy % newDimLength[i];
                newIdxCpy = Math.floor(newIdxCpy / newDimLength[i]);
            }

            // Compute what the old index was
            let oldIdx = 0;
            for (let i = 0; i < numDimensions; ++i) {
                let offset = dimIdxNewOldMap[i][newDimIdx[i]];
                oldIdx = oldIdx * oldDimLength[i] + offset;
            }

            newStore.setValue(newIdx, this._data[oldIdx]);
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

        // TODO: consider the contributions of cells which are not in the map and the default value is not NaN or 0
        for (const oldIdx of this._statusMap.keys()) {
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

            let oldValue = this._data[oldIdx];

            if (contributions[newIdx] === 0) newStore._data[newIdx] = oldValue;
            else {
                if (method == 'last') newStore._data[newIdx] = oldValue;
                else if (method == 'highest')
                    newStore._data[newIdx] =
                        newStore._data[newIdx] < oldValue ? oldValue : newStore._data[newIdx];
                else if (method == 'lowest')
                    newStore._data[newIdx] =
                        newStore._data[newIdx] < oldValue ? newStore._data[newIdx] : oldValue;
                else if (method == 'sum' || method == 'average') newStore._data[newIdx] += oldValue;
                else if (method == 'product') newStore._data[newIdx] *= oldValue;
            }

            // TODO: maybe using newStore.setValue() would be faster?
            newStore._statusMap.set(newIdx, true);
            contributions[newIdx] += 1;
        }

        if (method === 'average') {
            for (let newIdx = 0; newIdx < newStore._data.length; ++newIdx)
                newStore._data[newIdx] /= contributions[newIdx];
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

                newStore.setValue(newIdx, this._data[oldIdx] * distributions[distIndex]);
            } else {
                if (method === 'sum') {
                    if (useRounding) {
                        const value = Math.floor(this._data[oldIdx] / numContributions);
                        const remainder = this._data[oldIdx] % numContributions;
                        const contributionId = contributionsIds[oldIdx];
                        const oneOverDistance = remainder / numContributions;
                        const lastIsSame =
                            Math.floor(contributionId * oneOverDistance) ===
                            Math.floor((contributionId - 1) * oneOverDistance);

                        newStore.setValue(newIdx, Math.floor(value));
                        if (!lastIsSame) {
                            newStore.setValue(newIdx, ++newStore._data[newIdx]);
                        }
                    } else {
                        newStore.setValue(newIdx, this._data[oldIdx] / numContributions);
                    }
                } else {
                    newStore.setValue(newIdx, this._data[oldIdx]);
                }
            }

            contributionsIds[oldIdx]++;
        }

        return newStore;
    }
}

module.exports = InMemoryStore;
