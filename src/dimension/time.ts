import TimeSlot from 'timeslot-dag';
import { AbstractDimension } from './abstract.js';
import { toBuffer, fromBuffer } from '../serialization.js';
import { TimeSlotPeriodicity } from './TimeSlotPeriodicity.enum.js';

export class TimeDimension extends AbstractDimension {
  _start;
  _end;
  _items: Record<string, string[]>;
  _rootIdxToGroupIdx: Record<string, number[]>;

  override get attributes() {
    // @ts-ignore We are accessing a `@private` attribute on this object.
    return [this._rootAttribute, ...TimeSlot.upperSlots[this._rootAttribute]];
  }

  /**
   *
   * @param {TimeSlotPeriodicity} rootAttribute
   * @param {string} start
   * @param {string} end
   */
  constructor(
    id: string,
    rootAttribute: TimeSlotPeriodicity,
    start: string,
    end: string,
    label: string | null = null,
  ) {
    super(id, rootAttribute, label);

    this._start = TimeSlot.fromDate(
      TimeSlot.fromValue(start).firstDate,
      TimeSlotPeriodicity.Day,
    );
    this._end = TimeSlot.fromDate(
      TimeSlot.fromValue(end).lastDate,
      TimeSlotPeriodicity.Day,
    );
    this._items = {};
    this._rootIdxToGroupIdx = {};

    if (
      this._start.periodicity !== TimeSlotPeriodicity.Day ||
      this._end.periodicity !== TimeSlotPeriodicity.Day
    )
      throw new Error('Start and end must be dates.');
  }

  static deserialize(buffer: ArrayBuffer) {
    const data = fromBuffer(buffer);
    if (!data) {
      throw new Error('Invalid buffer');
    }
    return new TimeDimension(
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      data.id,
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      data.rootAttribute,
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      data.start,
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      data.end,
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      data.label,
    );
  }

  serialize() {
    return toBuffer({
      id: this.id,
      label: this.label,
      rootAttribute: this.rootAttribute,
      start: this._start.value,
      end: this._end.value,
    });
  }

  override getItems(attribute?: TimeSlotPeriodicity) {
    if (this._start.value > this._end.value) return [];

    const useableAttribute = attribute || this._rootAttribute;

    if (!this._items[useableAttribute]) {
      const end = this._end.toParentPeriodicity(useableAttribute);
      let period = this._start.toParentPeriodicity(useableAttribute);

      this._items[useableAttribute] = [period.value];
      while (period.value < end.value) {
        period = period.next();
        this._items[useableAttribute].push(period.value);
      }
    }

    return this._items[useableAttribute];
  }

  getEntries(attribute?: TimeSlotPeriodicity, language = 'en') {
    return this.getItems(attribute).map((item) => [
      item,
      TimeSlot.fromValue(item).humanizeValue(language),
    ]);
  }

  override drillUp(newAttribute: TimeSlotPeriodicity) {
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newAttribute == this.rootAttribute) return this;

    return new TimeDimension(
      this.id,
      newAttribute,
      this._start.value,
      this._end.value,
      this.label,
    );
  }

  drillDown(newAttribute: TimeSlotPeriodicity) {
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newAttribute == this.rootAttribute) return this;

    // @ts-ignore We are accessing a `@private` attribute on this object.
    if (!TimeSlot.upperSlots[newAttribute].includes(this._rootAttribute)) {
      throw new Error('Invalid periodicity.');
    }

    return new TimeDimension(
      this.id,
      newAttribute,
      this._start.value,
      this._end.value,
      this.label,
    );
  }

  override dice(
    attribute: TimeSlotPeriodicity,
    items: string[],
    reorder = false,
  ) {
    if (items.length === 1)
      return this.diceRange(attribute, items[0], items[0]);

    let workingItems = items;

    // if reorder is true, it means we are supposed to keep the order
    // provided in the item list, otherwise we'll keep our chronological order.
    if (!reorder) {
      workingItems = workingItems.slice().sort();
    }

    // Check that items are ordered, have the good period, and that there are no gaps.
    const firstItem = items[0];
    if (!firstItem) {
      throw new Error('Unsupported: empty items');
    }

    let last = TimeSlot.fromValue(firstItem);
    if (last.periodicity !== attribute)
      throw new Error('Unsupported: wrong periodicity');

    for (let i = 1; i < workingItems.length; ++i) {
      const item = workingItems[i];
      if (!item) {
        throw new Error('Unsupported: empty items');
      }
      const current = TimeSlot.fromValue(item);
      if (
        current.periodicity !== attribute ||
        current.value !== last.next().value
      ) {
        throw new Error('Unsupported: follow');
      }

      last = current;
    }

    return this.diceRange(
      attribute,
      workingItems[0],
      workingItems[workingItems.length - 1],
    );
  }

  override diceRange(
    attribute: TimeSlotPeriodicity,
    start?: string,
    end?: string,
  ) {
    if (attribute === 'all') {
      return this;
    }

    let newStart: string | undefined;
    let newEnd: string | undefined;

    if (start) {
      const startTs = TimeSlot.fromValue(start);
      if (startTs.periodicity !== attribute)
        throw new Error(
          `${start} is not a valid slot of periodicity ${attribute}`,
        );

      newStart = TimeSlot.fromDate(
        startTs.firstDate,
        TimeSlotPeriodicity.Day,
      ).value;
    } else newStart = this._start.value;

    if (end) {
      const endTs = TimeSlot.fromValue(end);
      if (endTs.periodicity !== attribute)
        throw new Error(
          `${end} is not a valid slot of periodicity ${attribute}`,
        );

      newEnd = TimeSlot.fromDate(endTs.lastDate, TimeSlotPeriodicity.Day).value;
    } else newEnd = this._end.value;

    if (newStart <= this._start.value && this._end.value <= newEnd) {
      return this;
    }

    return new TimeDimension(
      this.id,
      this._rootAttribute,
      newStart < this._start.value ? this._start.value : newStart,
      newEnd < this._end.value ? newEnd : this._end.value,
      this.label,
    );
  }

  getGroupIndexFromRootIndexMap(groupAttr: TimeSlotPeriodicity) {
    if (!this._rootIdxToGroupIdx[groupAttr]) {
      this._checkAttribute(groupAttr);

      const rootItems = this.getItems();
      const groupItemsToIdx = this.getItemsToIdx(groupAttr);

      const newValues: number[] = [];
      rootItems.forEach((rootItem) => {
        const groupItem =
          TimeSlot.fromValue(rootItem).toParentPeriodicity(groupAttr).value;
        if (groupItemsToIdx[groupItem]) {
          newValues.push(groupItemsToIdx[groupItem]);
        }
      });

      this._rootIdxToGroupIdx[groupAttr] = newValues;
    }

    return this._rootIdxToGroupIdx[groupAttr];
  }

  override getGroupIndexFromRootIndex(
    groupAttr: TimeSlotPeriodicity,
    rootIdx: number,
  ) {
    if (undefined === this._rootIdxToGroupIdx[groupAttr]) {
      this.getGroupIndexFromRootIndexMap(groupAttr);
    }

    const groupAttrVal = this._rootIdxToGroupIdx[groupAttr];
    // console.log('_rootIdxToGroupIdx:', this._rootIdxToGroupIdx);
    // console.log('groupAttrVal:', groupAttrVal);

    if (!groupAttrVal || !groupAttrVal?.[rootIdx]) {
      throw new Error('Invalid root index');
    }
    const val = groupAttrVal[rootIdx];
    console.log('val:', val);

    return val;
  }

  union(otherDimension: TimeDimension) {
    if (this.id !== otherDimension.id)
      throw new Error('Not the same dimension');

    let rootAttribute: TimeSlotPeriodicity;
    if (this.attributes.includes(otherDimension.rootAttribute))
      rootAttribute = otherDimension._rootAttribute;
    else if (otherDimension.attributes.includes(this.rootAttribute))
      rootAttribute = this._rootAttribute;
    else throw new Error('The dimensions are not compatible');

    const start =
      this._start.value < otherDimension._start.value
        ? this._start.value
        : otherDimension._start.value;
    const end =
      otherDimension._end.value < this._end.value
        ? this._end.value
        : otherDimension._end.value;
    return new TimeDimension(this.id, rootAttribute, start, end, this.label);
  }

  intersect(otherDimension: TimeDimension) {
    if (this.id !== otherDimension.id)
      throw new Error('Not the same dimension');

    if (this.attributes.includes(otherDimension.rootAttribute))
      return otherDimension.diceRange(
        TimeSlotPeriodicity.Day,
        this._start.value,
        this._end.value,
      );

    if (otherDimension.attributes.includes(this.rootAttribute))
      return this.diceRange(
        TimeSlotPeriodicity.Day,
        otherDimension._start.value,
        otherDimension._end.value,
      );

    throw new Error('The dimensions are not compatible');
  }
}
