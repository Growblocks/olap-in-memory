const assert = require('chai').assert;
const { Cube, GenericDimension, TimeDimension } = require('../src');
const createLargeTestCube = require('./helpers/create-large-test-cube');

function batchRun(func, times = 30) {
    const results = [];

    for (let i = 0; i < times; i++) {
        const start = Date.now();
        func();
        const end = Date.now();
        results.push(end - start);
    }

    return (results.reduce((acc, curr) => acc + curr, 0) / results.length).toFixed(2);
}

describe('Cube benchmark', function () {
    this.timeout(0);

    describe('slice of large cubes', function () {
        it('test time taken for slicing a large cube', function () {
            const largeCube = createLargeTestCube(10, 4, 3); // size 100^3 = 1 million cells -> 4 * 1e6 = 4MB

            const avgTime = batchRun(() => largeCube.slice('dimension0', 'all', 'all'));

            console.log(`Time taken for slicing a large cube: ${avgTime}ms`);
        });
        it('test time taken for collapsing a large cube', function () {
            const largeCube = createLargeTestCube(10, 4, 3); // size 100^3 = 1 million cells -> 4 * 1e6 = 4MB

            const avgTime = batchRun(() => largeCube.collapse());

            console.log(`Time taken for collapsing a large cube: ${avgTime}ms`);
        });
        it('test time taken for slicing a large cube with sparse data', function () {
            const largeCube = createLargeTestCube(10, 4, 3, NaN, 0.1); // size 100^3 = 1 million cells -> 4 * 1e6 = 4MB, only 10% of cells are filled

            const avgTime = batchRun(() => largeCube.collapse());

            console.log(`Time taken for collapsing a large cube with sparse data: ${avgTime}ms`);
        });
    });
});
