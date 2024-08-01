import { assert, it, describe, beforeEach } from 'vitest';
const createTestCube = require('./helpers/create-test-cube');

describe('Filtering', () => {
  let cube;

  beforeEach(() => {
    cube = createTestCube(true, true);
  });

  describe('slice', () => {
    it('should remove cities', () => {
      const parisCube = cube.slice('location', 'city', 'paris');

      assert.deepEqual(parisCube.getNestedArray('antennas'), [1, 2]);
      assert.equal(parisCube.dimensions.length, 1);
      assert.equal(parisCube.dimensions[0].id, 'period');
    });

    it('should remove seasons', () => {
      const winterCube = cube.slice('period', 'season', 'winter');

      assert.deepEqual(winterCube.getNestedArray('antennas'), [2, 8, 32]);
      assert.equal(winterCube.dimensions.length, 1);
      assert.equal(winterCube.dimensions[0].id, 'location');
    });

    it('should remove both cities and seasons', () => {
      const tolWinCube = cube
        .slice('period', 'season', 'winter')
        .slice('location', 'city', 'toledo');

      assert.deepEqual(tolWinCube.getNestedArray('antennas'), 8);
      assert.equal(tolWinCube.dimensions.length, 0);
    });

    it('should remove all dimensions', () => {
      const emptyCube = cube
        .slice('period', 'all', 'all')
        .slice('location', 'all', 'all');

      assert.deepEqual(emptyCube.getNestedArray('antennas'), 63);
      assert.equal(emptyCube.dimensions.length, 0);
    });
  });

  describe('dice', () => {
    it('should work on noop', () => {
      let newCube = cube.dice('location', 'city', ['paris', 'toledo', 'tokyo']);

      assert.equal(newCube, cube);
    });

    it('should dice on cities', () => {
      const parTolCube = cube.dice('location', 'city', ['paris', 'toledo']);

      assert.deepEqual(parTolCube.getNestedArray('antennas'), [
        [1, 2],
        [4, 8],
      ]);
    });

    it('should dice on cities conserving order', () => {
      const parTolCube = cube.dice('location', 'city', ['toledo', 'paris']);

      assert.deepEqual(parTolCube.getNestedArray('antennas'), [
        [1, 2],
        [4, 8],
      ]);
    });

    it('should dice on continents', () => {
      const parTolCube = cube.dice('location', 'continent', ['europe']);

      assert.deepEqual(parTolCube.getNestedArray('antennas'), [
        [1, 2],
        [4, 8],
      ]);
    });

    it('should filter the other dimension', () => {
      const winterCube = cube.dice('period', 'season', ['winter']);

      assert.deepEqual(winterCube.getNestedArray('antennas'), [[2], [8], [32]]);
    });

    it('should work dicing on non existent item', () => {
      assert.equal(
        cube.dice('location', 'city', ['nonexisting', 'paris']).storeSize,
        cube.storeSize / 3,
      );
    });

    it('should work dicing on empty array', () => {
      assert.equal(cube.dice('location', 'city', []).storeSize, 0);
    });

    it('should dice on cities reversed', () => {
      const parTolCube = cube.dice(
        'location',
        'city',
        ['toledo', 'paris'],
        true,
      );

      assert.deepEqual(parTolCube.getNestedArray('antennas'), [
        [4, 8],
        [1, 2],
      ]);
    });

    it('should not allow reordering on continents', () => {
      assert.throws(() => cube.dice('location', 'continent', ['europe'], true));
    });
  });
});
