import { assert, it, describe, beforeEach } from 'vitest';
const createTestCube = require('./helpers/create-test-cube');
const { Cube, GenericDimension } = require('../src');

describe('Accessors', () => {
  describe('getting data', () => {
    let cube;

    beforeEach(() => {
      cube = createTestCube(true, true);
    });

    it('should have a storeSize of 6', () => {
      assert.equal(cube.storeSize, 6);
    });

    it('should have a byteLength of 48', () => {
      assert.equal(cube.byteLength, 48);
    });

    it('should retrieve flat array', () => {
      assert.deepEqual(cube.getData('antennas'), [1, 2, 4, 8, 16, 32]);
    });

    it('should retrieve nested array', () => {
      assert.deepEqual(cube.getNestedArray('antennas'), [
        [1, 2],
        [4, 8],
        [16, 32],
      ]);
    });

    it('should retrieve nested object', () => {
      assert.deepEqual(cube.getNestedObject('antennas'), {
        paris: { summer: 1, winter: 2 },
        toledo: { summer: 4, winter: 8 },
        tokyo: { summer: 16, winter: 32 },
      });
    });

    it('should retrieve nested object w/ totals', () => {
      assert.deepEqual(cube.getNestedObject('antennas', true), {
        paris: { summer: 1, winter: 2, all: 3 },
        toledo: { summer: 4, winter: 8, all: 12 },
        tokyo: { summer: 16, winter: 32, all: 48 },
        all: { summer: 21, winter: 42, all: 63 },
      });
    });

    it('should retrieve nested object w/ totals on a cube with no dimensions', () => {
      const myCube = new Cube([]);
      myCube.createStoredMeasure('antennas');
      myCube.setData('antennas', [32]);

      assert.deepEqual(myCube.getNestedObject('antennas', true), 32);
    });

    it('should compute flat array', () => {
      assert.deepEqual(cube.getData('router_by_antennas'), [
        3 / 1,
        2 / 2,
        4 / 4,
        9 / 8,
        16 / 16,
        32 / 32,
      ]);
    });
  });

  describe('setting data', () => {
    let cube;

    beforeEach(() => {
      cube = createTestCube(true, false);
    });

    it('should set flat array', () => {
      cube.setData('antennas', [1, 2, 4, 8, 16, 32]);
      assert.deepEqual(cube.getData('antennas'), [1, 2, 4, 8, 16, 32]);
    });

    it('should set nested array', () => {
      cube.setNestedArray('antennas', [
        [1, 2],
        [4, 8],
        [16, 32],
      ]);
      assert.deepEqual(cube.getData('antennas'), [1, 2, 4, 8, 16, 32]);
    });

    it('should set nested object', () => {
      cube.setNestedObject('antennas', {
        paris: { summer: 1, winter: 2 },
        toledo: { summer: 4, winter: 8 },
        tokyo: { summer: 16, winter: 32 },
      });

      assert.deepEqual(cube.getData('antennas'), [1, 2, 4, 8, 16, 32]);
    });
  });

  describe('hydrateFromSparseNestedObject', () => {
    it('should work on a simple case', () => {
      const cube = new Cube([
        new GenericDimension('period', 'season', ['summer', 'winter']),
        new GenericDimension('location', 'city', ['paris', 'toledo', 'tokyo']),
      ]);

      cube.createStoredMeasure('antennas', {}, 'float32', 0);
      cube.hydrateFromSparseNestedObject('antennas', { winter: { toledo: 1 } });

      assert.deepEqual(cube.getNestedObject('antennas'), {
        summer: { paris: 0, toledo: 0, tokyo: 0 },
        winter: { paris: 0, toledo: 1, tokyo: 0 },
      });
    });

    it('should work with data which needs ignoring', () => {
      const cube = new Cube([
        new GenericDimension('period', 'season', ['summer', 'winter']),
        new GenericDimension('location', 'city', ['paris', 'toledo', 'tokyo']),
      ]);

      cube.createStoredMeasure('antennas', {}, 'float32', 0);
      cube.hydrateFromSparseNestedObject('antennas', {
        winter: { toledo: 1, losangeles: 2 },
      });

      assert.deepEqual(cube.getNestedObject('antennas'), {
        summer: { paris: 0, toledo: 0, tokyo: 0 },
        winter: { paris: 0, toledo: 1, tokyo: 0 },
      });
    });

    it('Setting a value to null orNumber.NaN should unset it', () => {
      const cube = createTestCube(true, true);
      cube.hydrateFromSparseNestedObject('antennas', {
        toledo: { summer: null },
      });

      assert.equal(cube.getData('antennas')[2], 0);
      assert.equal(cube.getStatusMap('antennas').get(2), undefined);
    });
  });
});
