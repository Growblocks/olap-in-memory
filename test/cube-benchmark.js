const assert = require('chai').assert;
const createLargeTestCube = require('./helpers/create-large-test-cube');

function batchRun(func, times = 10) {
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

    // size 10^4 for 3 measures ==> 10^4 * 3 = 120,000 cells -> 4 * 120,000 = 480,000 bytes = 480KB
    const largeCube = createLargeTestCube(10, 4, 3);
    // size 10^4 for 3 measures ==> 10^4 * 3 = 120,000 cells, but only 10% of them are filled with data
    // 120,000 * 0.1 = 12,000 cells -> 4 * 12,000 = 48,000 bytes = 48KB
    const sparseLargeCube50 = createLargeTestCube(10, 4, 3, 0.5);
    const sparseLargeCube25 = createLargeTestCube(10, 4, 3, 0.25);
    const sparseLargeCube10 = createLargeTestCube(10, 4, 3, 0.1);
    const testCubes = [largeCube, sparseLargeCube50, sparseLargeCube25, sparseLargeCube10];

    describe('slice of large cubes', function () {
        it('test time taken for slicing a whole dimension of a large cube', function () {
            for (const cube of testCubes) {
                const avgTime = batchRun(() => cube.slice('dimension0', 'all', 'all'));
                console.log(`Time taken for slicing a whole dimension: ${avgTime}ms`);
            }
        });

        it('test time taken for slicing a dimension item of a large cube', function () {
            for (const cube of testCubes) {
                const avgTime = batchRun(() =>
                    cube.slice('dimension3', 'root', `dimension3-item2`)
                );
                console.log(`Time taken for slicing a dimension item: ${avgTime}ms`);
            }
        });
    });

    describe('collapse of large cubes', function () {
        it('test time taken for collapsing a large cube', function () {
            for (const cube of testCubes) {
                const avgTime = batchRun(() => cube.collapse());
                console.log(`Time taken for collapse: ${avgTime}ms`);
            }
        });
    });
});
