const { Cube, GenericDimension } = require('../../src');

module.exports = (numOfDimensions, dimensionSize, numOfMeasures, sparseDataRate = 1.0) => {
    const dimensions = [];

    for (let i = 0; i < numOfDimensions; i++) {
        const dimension = new GenericDimension(
            `dimension${i}`,
            'root',
            Array.from({ length: dimensionSize }, (_, j) => `dimension${i}-item${j}`)
        );
        dimensions.push(dimension);
    }

    const cube = new Cube(dimensions);

    for (let i = 0; i < numOfMeasures; i++) {
        cube.createStoredMeasure(`measure${i}`, {}, 'float32', 0);
    }

    const sizeToFillDataRandomly = sparseDataRate * cube.storeSize;

    const usedIndexes = {};
    for (let i = 0; i < sizeToFillDataRandomly; i++) {
        let currIndex = 0;

        while (usedIndexes[currIndex]) {
            currIndex = Math.floor(Math.random() * cube.storeSize);
        }

        usedIndexes[currIndex] = true;

        cube.storedMeasureIds.forEach(measureId => {
            cube.storedMeasures[measureId].setValue(currIndex, 1);
        });
    }

    return cube;
};
