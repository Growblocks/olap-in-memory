import { describe, it } from 'vitest';
const { GenericDimension } = require('../src');
const createLargeTestCube = require('./helpers/create-large-test-cube');

function batchRun(func, times = 10) {
  const results = [];

  for (let i = 0; i < times; i++) {
    const start = Date.now();
    func();
    const end = Date.now();
    results.push(end - start);
  }

  return (
    results.reduce((acc, curr) => acc + curr, 0) / results.length
  ).toFixed(2);
}

describe('Cube benchmark', () => {
  // size 10^4 for 3 measures ==> 10^4 * 3 = 120,000 cells -> 4 * 120,000 = 480,000 bytes = 480KB
  const largeCube = createLargeTestCube(10, 4, 3);
  // size 10^4 for 3 measures ==> 10^4 * 3 = 120,000 cells, but only 10% of them are filled with data
  // 120,000 * 0.1 = 12,000 cells -> 4 * 12,000 = 48,000 bytes = 48KB
  const sparseLargeCube50 = createLargeTestCube(10, 4, 3, 0.5);
  const sparseLargeCube25 = createLargeTestCube(10, 4, 3, 0.25);
  const sparseLargeCube10 = createLargeTestCube(10, 4, 3, 0.1, 3);
  const testCubes = [
    largeCube,
    sparseLargeCube50,
    sparseLargeCube25,
    sparseLargeCube10,
  ];

  describe('slice of large cubes', () => {
    it('test time taken for slicing a whole dimension of a large cube', () => {
      for (const cube of testCubes) {
        const avgTime = batchRun(() => cube.slice('dimension0', 'all', 'all'));
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(`Time taken for slicing a whole dimension: ${avgTime}ms`);
      }
    });

    it('test time taken for slicing a dimension item of a large cube', () => {
      for (const cube of testCubes) {
        const avgTime = batchRun(() =>
          cube.slice('dimension3', 'root', 'dimension3-item2'),
        );

        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(`Time taken for slicing a dimension item: ${avgTime}ms`);
      }
    });
  });

  describe('collapse of large cubes', () => {
    it('test time taken for collapsing a large cube', () => {
      for (const cube of testCubes) {
        const avgTime = batchRun(() => cube.collapse());
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(`Time taken for collapse: ${avgTime}ms`);
      }
    });
  });

  describe('reorder of large cubes', () => {
    it('test time taken for reordering a large cube', () => {
      for (const cube of testCubes) {
        const reorderedDimensions = cube.dimensionIds.slice().reverse();
        const avgTime = batchRun(() =>
          cube.reorderDimensions(reorderedDimensions),
        );
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(`Time taken for reordering: ${avgTime}ms`);
      }
    });
  });

  describe('dice of large cubes', () => {
    it('test time taken for dice a large cube', () => {
      for (const cube of testCubes) {
        const avgTime = batchRun(() =>
          cube.dice('dimension2', 'root', [
            'dimension2-item2',
            'dimension2-item3',
          ]),
        );
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(`Time taken for dice: ${avgTime}ms`);
      }
    });
  });

  describe('add dimension to large cubes', () => {
    it('test time taken for adding new dimension to a large cube', () => {
      const newDimension = new GenericDimension(
        'dimension-new',
        'root',
        Array.from({ length: 5 }, (_, j) => `dimension-new-item${j}`),
      );

      for (const cube of testCubes) {
        const avgTime = batchRun(() => cube.addDimension(newDimension));
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(`Time taken for adding new dimension: ${avgTime}ms`);
      }
    });
  });

  describe('remove dimension to large cubes', () => {
    it('test time taken for removing a dimension from a large cube', () => {
      for (const cube of testCubes) {
        const avgTime = batchRun(() => cube.removeDimension('dimension4'));
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(`Time taken for removing a dimension: ${avgTime}ms`);
      }
    });
  });

  describe('compose of large cubes', () => {
    it('test time taken for composing two large cube', () => {
      const avgTime = batchRun(() =>
        sparseLargeCube10.compose(sparseLargeCube50),
      );
      // biome-ignore lint/suspicious/noConsoleLog: <explanation>
      console.log(`Time taken for composing two large cubes: ${avgTime}ms`);
    });
  });
});
