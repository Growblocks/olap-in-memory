import { assert, beforeEach, describe, it } from 'vitest';
const createTestCube = require('./helpers/create-test-cube');

describe('Measures', () => {
  describe('Renaming measures', () => {
    let cube;

    beforeEach(() => {
      cube = createTestCube(true, true);
    });

    it('should throw on non existent measure', () => {
      assert.throws(() => cube.renameMeasure('missing', 'missing2'));
    });

    it('should update only computed measure', () => {
      const newCube = cube.clone();
      newCube.renameMeasure('router_by_antennas', 'router_by_receivers');

      // all measures still work
      assert.doesNotThrow(() => newCube.getData('routers'));
      assert.doesNotThrow(() => newCube.getData('antennas'));
      assert.doesNotThrow(() => newCube.getData('router_by_receivers'));

      // former measure does not work any longer
      assert.throws(() => newCube.getData('router_by_antennas'));
    });

    it('should update formulas of computed measures', () => {
      const newCube = cube.clone();
      newCube.renameMeasure('antennas', 'receivers');

      // all measures still work
      assert.doesNotThrow(() => newCube.getData('routers'));
      assert.doesNotThrow(() => newCube.getData('receivers'));
      assert.doesNotThrow(() => newCube.getData('router_by_antennas'));

      // former measure does not work any longer
      assert.throws(() => newCube.getData('antennas'));
    });

    it('should not change anything when renaming twice', () => {
      const newCube = cube.clone();
      cube.renameMeasure('antennas', 'receivers');
      cube.renameMeasure('receivers', 'antennas');

      assert.deepEqual(cube, newCube);
    });
  });
});
