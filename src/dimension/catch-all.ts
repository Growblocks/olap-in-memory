import { AbstractDimension } from './abstract.js';
import type { GenericDimension } from './generic.js';
import type { TimeDimension } from './time.js';
import { TimeSlotPeriodicity } from './TimeSlotPeriodicity.enum.js';

export class CatchAll extends AbstractDimension {
  childDimension: TimeDimension | GenericDimension | null;

  override get attributes(): string[] {
    throw new Error('Unsupported');
  }

  /**
   * Create a simple dimension
   */
  constructor(
    id: string,
    childDimension: TimeDimension | GenericDimension | null = null,
  ) {
    super(id, TimeSlotPeriodicity.All);
    this.childDimension = childDimension;
  }

  serialize() {
    throw new Error('Unsupported');
  }

  override getItems(_attribute?: TimeSlotPeriodicity) {
    return ['_total'];
  }

  getEntries(_attribute?: TimeSlotPeriodicity, _language = 'en') {
    return [['_total', 'Total']];
  }

  override drillUp(_newAttribute: TimeSlotPeriodicity) {
    return this;
  }

  drillDown(newAttribute: TimeSlotPeriodicity) {
    if (this.childDimension) {
      return this.childDimension.drillUp(newAttribute);
    }

    throw new Error('Must set child dimension.');
  }

  override dice(
    attribute: TimeSlotPeriodicity,
    items: string[],
    _reorder = false,
  ) {
    if (attribute === this.rootAttribute && items.includes('_total')) {
      return this;
    }

    throw new Error('Unsupported');
  }

  override diceRange(
    _attribute: TimeSlotPeriodicity,
    _start: string,
    _end: string,
  ): GenericDimension {
    throw new Error('Unsupported');
  }

  /**
   * @param   attribute eg: month
   * @param   index     32
   * @return            2
   */
  override getGroupIndexFromRootIndex(
    _attribute: TimeSlotPeriodicity,
    _index: number,
  ) {
    return 0;
  }

  intersect(otherDimension: CatchAll) {
    return otherDimension;
  }

  union(_otherDimension: CatchAll) {
    return this;
  }
}
