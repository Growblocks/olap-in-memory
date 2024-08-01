import { assert, it, describe, beforeEach } from 'vitest';
const createTestCube = require('./helpers/create-test-cube');
const { Cube, TimeDimension } = require('../src');

describe('Drilling', () => {
  describe('drillUp', () => {
    describe('no op', () => {
      it('Should return this', () => {
        const cube = createTestCube(true, true);
        const newCube = cube.drillUp('location', 'city');
        assert.equal(cube, newCube);
      });
    });

    describe('cities to continents', () => {
      it('Drilled up cube should have summed cities by continent', () => {
        const cube = createTestCube(true, true);
        const newCube = cube.drillUp('location', 'continent');
        assert.deepEqual(newCube.getNestedArray('antennas'), [
          [5, 10],
          [16, 32],
        ]);
      });
    });

    describe('With incomplete data (data from feb missing)', () => {
      let cube;
      let newCube;

      beforeEach(() => {
        cube = new Cube([
          new TimeDimension('time', 'month', '2010-01', '2010-06'),
        ]);
        cube.createStoredMeasure('data_sum', {}, 'float32', Number.NaN);
        cube.createStoredMeasure(
          'data_avg',
          { time: 'average' },
          'float32',
          Number.NaN,
        );
        cube.hydrateFromSparseNestedObject('data_sum', {
          '2010-01': 1,
          '2010-03': 2,
        });
        cube.hydrateFromSparseNestedObject('data_avg', {
          '2010-01': 10,
          '2010-02': 0,
          '2010-03': 20,
        });

        newCube = cube.drillUp('time', 'quarter');
      });

      it('Drilled up cube should have summed', () => {
        assert.deepEqual(newCube.getNestedObject('data_sum', true), {
          '2010-Q1': 3,
          '2010-Q2': Number.NaN,
          all: 3,
        });
      });

      it('Drilled up cube should have averaged', () => {
        assert.deepEqual(newCube.getNestedObject('data_avg', true), {
          '2010-Q1': 10,
          '2010-Q2': Number.NaN,
          all: 10,
        });
      });
    });
  });

  describe('drillDown', () => {
    describe('no op', () => {
      it('Should return this', () => {
        const cube = new Cube([
          new TimeDimension('time', 'month', '2010-01', '2010-02'),
        ]);
        cube.createStoredMeasure('measure1', { time: 'sum' }, 'float32');
        cube.setNestedObject('measure1', { '2010-01': 100, '2010-02': 100 });
        const newCube = cube.drillDown('time', 'month');
        assert.equal(newCube, cube);
      });
    });

    describe('months to days', () => {
      it('both measures should not have changed when drilled down and up again 2', () => {
        const cube = new Cube([
          new TimeDimension('time', 'month', '2010-01', '2010-02'),
        ]);
        cube.createStoredMeasure('measure1', { time: 'sum' }, 'uint32');
        cube.createStoredMeasure('measure2', { time: 'average' }, 'uint32');
        cube.setNestedObject('measure1', { '2010-01': 100, '2010-02': 100 });
        cube.setNestedObject('measure2', { '2010-01': 100, '2010-02': 100 });

        const newCube = cube.drillDown('time', 'day');
        assert.deepEqual(
          newCube.drillUp('time', 'month').getNestedObject('measure1'),
          cube.getNestedObject('measure1'),
        );

        assert.deepEqual(
          newCube.drillUp('time', 'month').getNestedObject('measure2'),
          cube.getNestedObject('measure2'),
        );
      });
    });

    describe('months_week_mon to days', () => {
      it('both measures should not have changed when drilled down and up again', () => {
        const cube = new Cube([
          new TimeDimension(
            'time',
            'month_week_mon',
            '2010-01-W1-mon',
            '2010-02-W1-mon',
          ),
        ]);
        cube.createStoredMeasure('measure1', { time: 'sum' }, 'uint32');
        cube.createStoredMeasure('measure2', { time: 'average' }, 'uint32');
        cube.setNestedObject('measure1', {
          '2010-01-W1-mon': 100,
          '2010-02-W1-mon': 100,
        });
        cube.setNestedObject('measure2', {
          '2010-01-W1-mon': 100,
          '2010-02-W1-mon': 100,
        });

        const newCube = cube.drillDown('time', 'day');
        assert.deepEqual(
          newCube.drillUp('time', 'month_week_mon').getNestedObject('measure1'),
          cube.getNestedObject('measure1'),
        );

        assert.deepEqual(
          newCube.drillUp('time', 'month_week_mon').getNestedObject('measure2'),
          cube.getNestedObject('measure2'),
        );
      });
    });

    describe('quarter to month, incomplete cube', () => {
      let cube;
      let newCube;

      beforeEach(() => {
        cube = new Cube([
          new TimeDimension('time', 'quarter', '2010-Q1', '2010-Q2'),
        ]);
        cube.createStoredMeasure(
          'measure1',
          { time: 'sum' },
          'float32',
          Number.NaN,
        );
        cube.hydrateFromSparseNestedObject('measure1', { '2010-Q1': 90 });

        newCube = cube.drillDown('time', 'month');
      });

      it('check cube data', () => {
        assert.deepEqual(cube.getData('measure1'), [90, Number.NaN]);
      });

      it('newCube should drillup again to same values', () => {
        assert.deepEqual(
          newCube.drillUp('time', 'quarter').getData('measure1'),
          [90, Number.NaN],
        );
      });

      it('newCube should have divided the quarter in three month, and left the rest', () => {
        assert.deepEqual(newCube.getData('measure1'), [
          30,
          30,
          30,
          Number.NaN,
          Number.NaN,
          Number.NaN,
        ]);
      });

      it('newCube should have proper status flags', () => {
        assert.deepEqual(
          Array.from(newCube.getStatusMap('measure1').keys()),
          [0, 1, 2],
        );
      });
    });
  });
});
