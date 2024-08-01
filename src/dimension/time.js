const TimeSlot = require('timeslot-dag');
const AbstractDimension = require('./abstract');
const { toBuffer, fromBuffer } = require('../serialization');

class TimeDimension extends AbstractDimension {
  get attributes() {
    return [this._rootAttribute, ...TimeSlot.upperSlots[this._rootAttribute]];
  }

  /**
   *
   * @param {TimeSlotPeriodicity} rootAttribute
   * @param {string} start
   * @param {string} end
   */
  constructor(id, rootAttribute, start, end, label = null) {
    super(id, rootAttribute, label);

    this._start = TimeSlot.fromDate(TimeSlot.fromValue(start).firstDate, 'day');
    this._end = TimeSlot.fromDate(TimeSlot.fromValue(end).lastDate, 'day');
    this._items = {};
    this._rootIdxToGroupIdx = {};

    if (this._start.periodicity !== 'day' || this._end.periodicity !== 'day')
      throw new Error('Start and end must be dates.');
  }

  static deserialize(buffer) {
    const data = fromBuffer(buffer);
    return new TimeDimension(
      data.id,
      data.rootAttribute,
      data.start,
      data.end,
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

  getItems(attribute = null) {
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

  getEntries(attribute = null, language = 'en') {
    return this.getItems(attribute).map((item) => [
      item,
      TimeSlot.fromValue(item).humanizeValue(language),
    ]);
  }

  drillUp(newAttribute) {
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

  drillDown(newAttribute) {
    // biome-ignore lint/suspicious/noDoubleEquals: <explanation>
    if (newAttribute == this.rootAttribute) return this;

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

  dice(attribute, items, reorder = false) {
    if (items.length === 1)
      return this.diceRange(attribute, items[0], items[0]);

    let workingItems = items;

    // if reorder is true, it means we are supposed to keep the order
    // provided in the item list, otherwise we'll keep our chronological order.
    if (!reorder) {
      workingItems = workingItems.slice().sort();
    }

    // Check that items are ordered, have the good period, and that there are no gaps.
    let last = TimeSlot.fromValue(items[0]);
    if (last.periodicity !== attribute)
      throw new Error('Unsupported: wrong periodicity');

    for (let i = 1; i < workingItems.length; ++i) {
      const current = TimeSlot.fromValue(workingItems[i]);
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

  diceRange(attribute, start, end) {
    if (attribute === 'all') {
      return this;
    }

    let newStart;
    let newEnd;

    if (start) {
      const startTs = TimeSlot.fromValue(start);
      if (startTs.periodicity !== attribute)
        throw new Error(
          `${start} is not a valid slot of periodicity ${attribute}`,
        );

      newStart = TimeSlot.fromDate(startTs.firstDate, 'day').value;
    } else newStart = this._start.value;

    if (end) {
      const endTs = TimeSlot.fromValue(end);
      if (endTs.periodicity !== attribute)
        throw new Error(
          `${end} is not a valid slot of periodicity ${attribute}`,
        );

      newEnd = TimeSlot.fromDate(endTs.lastDate, 'day').value;
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

  getGroupIndexFromRootIndexMap(groupAttr) {
    if (undefined === this._rootIdxToGroupIdx[groupAttr]) {
      this._checkAttribute(groupAttr);

      const rootItems = this.getItems();
      const groupItemsToIdx = this.getItemsToIdx(groupAttr);

      this._rootIdxToGroupIdx[groupAttr] = rootItems.map((rootItem) => {
        const groupItem =
          TimeSlot.fromValue(rootItem).toParentPeriodicity(groupAttr).value;
        return groupItemsToIdx[groupItem];
      });
    }

    return this._rootIdxToGroupIdx[groupAttr];
  }

  getGroupIndexFromRootIndex(groupAttr, rootIdx) {
    if (undefined === this._rootIdxToGroupIdx[groupAttr]) {
      this.getGroupIndexFromRootIndexMap(groupAttr);
    }

    return this._rootIdxToGroupIdx[groupAttr][rootIdx];
  }

  union(otherDimension) {
    if (this.id !== otherDimension.id)
      throw new Error('Not the same dimension');

    let rootAttribute;
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

  intersect(otherDimension) {
    if (this.id !== otherDimension.id)
      throw new Error('Not the same dimension');

    if (this.attributes.includes(otherDimension.rootAttribute))
      return otherDimension.diceRange(
        'day',
        this._start.value,
        this._end.value,
      );

    if (otherDimension.attributes.includes(this.rootAttribute))
      return this.diceRange(
        'day',
        otherDimension._start.value,
        otherDimension._end.value,
      );

    throw new Error('The dimensions are not compatible');
  }
}

module.exports = TimeDimension;
