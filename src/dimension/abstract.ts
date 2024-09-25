import type { TimeSlotPeriodicity } from './TimeSlotPeriodicity.enum.js';

export class AbstractDimension {
  id: string;
  _rootAttribute: TimeSlotPeriodicity;
  _label: string | null;
  _itemsToIdx: Record<string, Record<string, number>>;

  get numItems() {
    return this.getItems().length;
  }

  get rootAttribute() {
    return this._rootAttribute;
  }

  get attributes(): string[] {
    throw new Error('Override me');
  }

  get label() {
    return this._label;
  }

  /**
   * Create a simple dimension
   *
   * @param  {[type]} id         ie: "location"
   * @param  {[type]} attribute  ie: "zipCode"
   * @param  {string} label
   */
  constructor(
    id: string,
    rootAttribute: TimeSlotPeriodicity,
    label: string | null = null,
  ) {
    this.id = id;
    this._rootAttribute = rootAttribute;
    this._label = label;
    this._itemsToIdx = {};
  }

  // TODO: Should this be string | number?
  getItems(_attribute?: string): (string | number)[] {
    throw new Error('Override me');
  }

  drillUp(_newAttribute: string) {
    throw new Error('Override me');
  }

  // TODO: Should this be string | number?
  dice(_attribute: string, _items: (string | number)[], _reorder = false) {
    throw new Error('Override me');
  }

  diceRange(_attribute: string, _start: string, _end: string) {
    throw new Error('Override me');
  }

  getRootIndexFromRootItem(rootItem: string) {
    const rootItemsToIdx = this.getItemsToIdx();
    const result = rootItemsToIdx[rootItem];
    return result === undefined ? -1 : result;
  }

  getGroupIndexFromRootIndex(
    _groupAttr: TimeSlotPeriodicity,
    _rootIndex: number,
  ): number {
    throw new Error('Override me');
  }

  getItemsToIdx(attribute: TimeSlotPeriodicity | null = null) {
    const attr = attribute || this._rootAttribute;

    if (!this._itemsToIdx[attr]) {
      const itemsToIdx: Record<string, number> = {};
      const items = this.getItems(attr);
      const numItems = items.length;

      for (let i = 0; i < numItems; ++i) {
        const item = items[i];
        if (item) {
          itemsToIdx[item] = i;
        }
      }

      this._itemsToIdx[attr] = itemsToIdx;
    }

    return this._itemsToIdx[attr];
  }

  getGroupIndexFromRootItem(groupAttr: TimeSlotPeriodicity, rootItem: string) {
    const rootIndex = this.getRootIndexFromRootItem(rootItem);
    console.log('rootIndex:', rootIndex);
    console.log('groupAttr:', groupAttr);
    return this.getGroupIndexFromRootIndex(groupAttr, rootIndex);
  }

  getGroupItemFromRootIndex(groupAttr: TimeSlotPeriodicity, rootIndex: number) {
    const groupIndex = this.getGroupIndexFromRootIndex(groupAttr, rootIndex);
    const groupItems = this.getItems(groupAttr);
    return groupItems[groupIndex];
  }

  getGroupItemFromRootItem(groupAttr: TimeSlotPeriodicity, rootItem: string) {
    const groupIndex = this.getGroupIndexFromRootItem(groupAttr, rootItem);
    console.log('groupIndex:', groupIndex);
    const groupItems = this.getItems(groupAttr);
    console.log('groupItems:', groupItems);
    return groupItems[groupIndex];
  }

  _checkRootIndex(index: number) {
    if (index < 0 || index >= this.numItems)
      throw new Error(`rootIndex ${index} out of bounds [0, ${this.numItems}[`);
  }

  _checkAttribute(attribute: string) {
    if (!this.attributes.includes(attribute))
      throw new Error(
        `No attribute ${attribute} was found on dimension ${this.id}`,
      );
  }
}
