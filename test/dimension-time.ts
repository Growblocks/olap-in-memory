import { assert, beforeEach, describe, it } from 'vitest';
import { TimeDimension } from '../src/dimension/time.js';
import { TimeSlotPeriodicity } from '../src/dimension/TimeSlotPeriodicity.enum.js';

describe('TimeDimension', () => {
  let dimension: TimeDimension;

  beforeEach(() => {
    dimension = new TimeDimension(
      'time',
      TimeSlotPeriodicity.Month,
      '2009-12',
      '2010-02',
    );
  });

  it('should give proper sizes', () => {
    assert.equal(dimension.numItems, 3);
  });

  it('should give proper attributes', () => {
    assert.equal(dimension.rootAttribute, 'month');
    assert.sameMembers(dimension.attributes, [
      'month',
      'quarter',
      'semester',
      'year',
      'all',
    ]);
  });

  it('should compute items for all attributes', () => {
    assert.deepEqual(dimension.getItems(), ['2009-12', '2010-01', '2010-02']);
    assert.deepEqual(dimension.getItems(TimeSlotPeriodicity.Month), [
      '2009-12',
      '2010-01',
      '2010-02',
    ]);
    assert.deepEqual(dimension.getItems(TimeSlotPeriodicity.Year), [
      '2009',
      '2010',
    ]);
  });

  it('should compute child items for all attributes', () => {
    const mo = dimension.getGroupItemFromRootItem(
      TimeSlotPeriodicity.Month,
      '2010-01',
    );
    console.log('mo:', mo);
    assert.equal(mo, '2010-01');
    assert.equal(
      dimension.getGroupItemFromRootItem(TimeSlotPeriodicity.Year, '2010-01'),
      '2010',
    );
  });

  it('should compute child indexes for all attributes', () => {
    assert.equal(
      dimension.getGroupIndexFromRootIndex(TimeSlotPeriodicity.Month, 0),
      0,
    );
    assert.equal(
      dimension.getGroupIndexFromRootIndex(TimeSlotPeriodicity.Month, 1),
      1,
    );

    assert.equal(
      dimension.getGroupIndexFromRootIndex(TimeSlotPeriodicity.Year, 0),
      0,
    );
    assert.equal(
      dimension.getGroupIndexFromRootIndex(TimeSlotPeriodicity.Year, 1),
      1,
    );
  });

  it('should drill up', () => {
    const childDim = dimension.drillUp(TimeSlotPeriodicity.Quarter);
    assert.sameMembers(childDim.attributes, [
      'quarter',
      'semester',
      'year',
      'all',
    ]);
    assert.deepEqual(childDim.getItems(), ['2009-Q4', '2010-Q1']);
  });

  it('should drill down', () => {
    const childDim = dimension.drillDown(TimeSlotPeriodicity.WeekMon);
    assert.sameMembers(childDim.attributes, [
      'week_mon',
      'month',
      'quarter',
      'semester',
      'year',
      'all',
    ]);
    assert.deepEqual(childDim.getItems(), [
      '2009-W49-mon',
      '2009-W50-mon',
      '2009-W51-mon',
      '2009-W52-mon',
      '2009-W53-mon',
      '2010-W01-mon',
      '2010-W02-mon',
      '2010-W03-mon',
      '2010-W04-mon',
      '2010-W05-mon',
      '2010-W06-mon',
      '2010-W07-mon',
      '2010-W08-mon',
    ]);
  });

  it('should intersect to dimensions with the same rootAttribute', () => {
    const otherDimension = new TimeDimension(
      'time',
      TimeSlotPeriodicity.Month,
      '2010-01',
      '2010-02',
    );

    const intersection = dimension.intersect(otherDimension);
    assert.equal(intersection.rootAttribute, 'month');
    assert.deepEqual(intersection.getItems(), ['2010-01', '2010-02']);
  });

  it('should intersect to dimensions with different rootAttribute', () => {
    const otherDimension = new TimeDimension(
      'time',
      TimeSlotPeriodicity.Quarter,
      '2010-Q1',
      '2010-Q2',
    );

    const intersection = dimension.intersect(otherDimension);
    assert.equal(intersection.rootAttribute, 'quarter');
    assert.deepEqual(intersection.getItems(), ['2010-Q1']);
  });

  it('should raise when intersecting dimensions with no common items', () => {
    const otherDimension = new TimeDimension(
      'time',
      TimeSlotPeriodicity.Quarter,
      '2010-Q3',
      '2010-Q4',
    );

    const intersection = dimension.intersect(otherDimension);
    assert.equal(intersection.numItems, 0);
    assert.deepEqual(intersection.getItems(), []);
  });

  it('should union two dimensions', () => {
    const otherDimension = new TimeDimension(
      'time',
      TimeSlotPeriodicity.Quarter,
      '2010-Q3',
      '2010-Q4',
    );

    const union = dimension.union(otherDimension);
    assert.equal(union.rootAttribute, 'quarter');
    assert.deepEqual(union.getItems(), [
      '2009-Q4',
      '2010-Q1',
      '2010-Q2',
      '2010-Q3',
      '2010-Q4',
    ]);
  });

  it('should work when serialized', () => {
    const newDimension = TimeDimension.deserialize(dimension.serialize());
    assert.deepEqual(dimension.getItems(), newDimension.getItems());
    assert.deepEqual(
      dimension.getItems(TimeSlotPeriodicity.Quarter),
      newDimension.getItems(TimeSlotPeriodicity.Quarter),
    );
  });

  it('should allow dice on both start and end', () => {
    const newDimension = dimension.diceRange(
      TimeSlotPeriodicity.Month,
      '2010-01',
      '2010-01',
    );
    assert.deepEqual(newDimension.getItems(), ['2010-01']);
  });

  it('should allow dice when going further with start', () => {
    const newDimension = dimension.diceRange(
      TimeSlotPeriodicity.Month,
      '2000-01',
      '2020-01',
    );
    assert.deepEqual(newDimension.getItems(), [
      '2009-12',
      '2010-01',
      '2010-02',
    ]);
  });

  it('should allow dice when going further with end', () => {
    const newDimension = dimension.diceRange(
      TimeSlotPeriodicity.Month,
      '2010-01',
      '2020-01',
    );
    assert.deepEqual(newDimension.getItems(), ['2010-01', '2010-02']);
  });

  it('should allow dice when providing only begin', () => {
    const newDimension = dimension.diceRange(
      TimeSlotPeriodicity.Month,
      '2010-01',
    );
    assert.deepEqual(newDimension.getItems(), ['2010-01', '2010-02']);
  });

  it('should allow dice when providing only end', () => {
    const newDimension = dimension.diceRange(
      TimeSlotPeriodicity.Month,
      undefined,
      '2010-01',
    );
    assert.deepEqual(newDimension.getItems(), ['2009-12', '2010-01']);
  });

  it('should be able to humanize root attribute labels', () => {
    assert.deepEqual(dimension.getEntries(), [
      ['2009-12', 'December 2009'],
      ['2010-01', 'January 2010'],
      ['2010-02', 'February 2010'],
    ]);
  });

  it('should be able to humanize other labels', () => {
    assert.deepEqual(dimension.getEntries(TimeSlotPeriodicity.Quarter, 'fr'), [
      ['2009-Q4', '4ème trim. 2009'],
      ['2010-Q1', '1er trim. 2010'],
    ]);
  });

  it('should be able to humanize labels after drillingUp', () => {
    const newDimension = dimension.drillUp(TimeSlotPeriodicity.Quarter);

    assert.deepEqual(newDimension.getEntries(unde, 'fr'), [
      ['2009-Q4', '4ème trim. 2009'],
      ['2010-Q1', '1er trim. 2010'],
    ]);
  });

  it('should be able to humanize labels after dice', () => {
    const newDimension = dimension.dice(TimeSlotPeriodicity.Quarter, [
      '2010-Q1',
    ]);

    assert.deepEqual(newDimension.getEntries(), [
      ['2010-01', 'January 2010'],
      ['2010-02', 'February 2010'],
    ]);

    assert.deepEqual(
      newDimension.getEntries(TimeSlotPeriodicity.Quarter, 'fr'),
      [['2010-Q1', '1er trim. 2010']],
    );
  });
});
