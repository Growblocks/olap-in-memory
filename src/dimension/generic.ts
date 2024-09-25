import type { TimeSlotPeriodicity } from './TimeSlotPeriodicity.enum.js';
import { AbstractDimension } from './abstract.js';
import { toBuffer, fromBuffer } from '../serialization.js';

export class GenericDimension extends AbstractDimension {
  _items: Record<string, string[]>;
  _rootIdxToGroupIdx: Record<string, Uint32Array>;
  _itemToLabel: Record<string, Record<string, string>>;

  override get attributes() {
    return Object.keys(this._rootIdxToGroupIdx);
  }

  /**
   * Create a simple dimension
   */
  constructor(
    id: string,
    rootAttribute: TimeSlotPeriodicity,
    items: string[],
    label: string | null = null,
    // TODO: TYPE THIS MAP
    itemToLabelMap:
      | Record<string, string>
      | ((val: string) => string)
      | null = null,
  ) {
    super(id, rootAttribute, label);

    // Items for all attributes
    // {
    // 	year: ['2010', '2011', '2012', '2013'],
    // 	parity: ['even', 'odd']
    // }
    this._items = {};
    this._items.all = ['all'];
    this._items[rootAttribute] = items;

    // Mappings from all attributes to default one
    // {
    // 	year: [0, 1, 2, 3], <- maps to itself
    // 	parity: [0, 1, 0, 1] <- this._attributeMappings.parity[3 ('2012')] == 0 ('even')
    // }
    this._rootIdxToGroupIdx = {};
    this._rootIdxToGroupIdx.all = new Uint32Array(items.length); // everything points to item 0
    this._rootIdxToGroupIdx[rootAttribute] = new Uint32Array(
      items.map((_item, index) => index),
    );

    // Mapping for labels
    this._itemToLabel = {};
    this._itemToLabel.all = { all: 'All' };
    this._itemToLabel[rootAttribute] = {};
    items.forEach((item) => {
      if (this._itemToLabel[rootAttribute]) {
        const newVal = this._getOrCall(itemToLabelMap, item);
        if (newVal) {
          this._itemToLabel[rootAttribute][item] = newVal;
        }
      }
    });
  }

  static deserialize(buffer: ArrayBuffer) {
    const data = fromBuffer(buffer);

    if (data) {
      const dimension = new GenericDimension(
        // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
        data.id,
        // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
        data.rootAttribute,
        // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
        data.attributeItems[data.rootAttribute],
        // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
        data.label,
      );
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      Object.assign(dimension._items, data.attributeItems);
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      Object.assign(dimension._itemToLabel, data.attributeLabels);
      // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
      Object.assign(dimension._rootIdxToGroupIdx, data.attributeMappings);
      return dimension;
    }
  }

  serialize() {
    return toBuffer({
      id: this.id,
      label: this.label,
      rootAttribute: this._rootAttribute,
      rootItems: this._items[this._rootAttribute],
      attributeItems: this._items,
      attributeLabels: this._itemToLabel,
      attributeMappings: this._rootIdxToGroupIdx,
    });
  }

  /**
   * Add a parent attribute based on an existing one.
   * If an exception is throw on mapping functions, the dimensions will not be modified.
   *
   * @param {string} baseAttr ie: "zipCode"
   * @param {string} newAttr   ie: "city"
   * @param {Record<string, string> | (string): string} parentToGroup ie: {"12345": "paris", "54321": "paris"}
   * @param {Record<string, string> | (string): string} groupToLabelMap  ie: {'paris': "Ville de Paris"}
   */
  addAttribute(
    baseAttr: string,
    newAttr: string,
    baseToNew: Record<string, string> | ((val: string) => string),
    newToNewLabel:
      | Record<string, string>
      | ((val: string) => string)
      | null = null,
  ) {
    const newItemToNewIdx: Record<string, number> = {};

    // Initialize data
    const items: string[] = [];
    const rootIdxToGroupIdx = new Uint32Array(this.numItems);
    const itemToLabels: Record<string, string> = {};

    for (let rootIndex = 0; rootIndex < this.numItems; ++rootIndex) {
      // Convert baseItem to newItem
      const baseIdx = this._rootIdxToGroupIdx[baseAttr]?.[rootIndex];
      if (typeof baseIdx !== 'number') {
        throw new Error('Invalid base index');
      }
      const baseItem = this._items[baseAttr]?.[baseIdx];
      if (typeof baseItem !== 'string') {
        throw new Error('Invalid base item');
      }
      const newItem = this._getOrCall(baseToNew, baseItem);
      if (typeof newItem !== 'string') {
        throw new Error('Mapping result must be a string.');
      }

      // Create index, label and push if we see this item for the first time in the mapping table.
      if (newItemToNewIdx?.[newItem] === undefined) {
        newItemToNewIdx[newItem] = items.length;
        items.push(newItem);
        const newVal = this._getOrCall(newToNewLabel, newItem);
        if (newVal) {
          itemToLabels[newItem] = newVal;
        }
      }

      // Record mapping from root
      rootIdxToGroupIdx[rootIndex] = newItemToNewIdx[newItem];
    }

    this._items[newAttr] = items;
    this._rootIdxToGroupIdx[newAttr] = rootIdxToGroupIdx;
    this._itemToLabel[newAttr] = itemToLabels;
  }

  override getItems(attribute?: TimeSlotPeriodicity) {
    return this._items[attribute || this._rootAttribute] ?? [];
  }

  getEntries(attribute?: TimeSlotPeriodicity) {
    const workingAttribute = attribute || this._rootAttribute;

    const value: [string, string][] = [];

    this._items[workingAttribute]?.forEach((item) => {
      if (this._itemToLabel[workingAttribute]) {
        if (this._itemToLabel[workingAttribute][item]) {
          value.push([item, this._itemToLabel[workingAttribute][item]]);
        }
      }
    });

    return value;
  }

  renameItem(oldItem: string, newItem: string, newLabel?: string) {
    // check if newItem does not exist
    if (this._items[this._rootAttribute]?.includes(newItem)) {
      return;
    }

    Object.keys(this._items).forEach((attr) => {
      const idx = this._items[attr]?.indexOf(oldItem) ?? -1;
      if (this._items[attr]) {
        if (idx !== -1) {
          this._items[attr][idx] = newItem;
        }
      }
    });
    Object.keys(this._itemsToIdx).forEach((attr) => {
      if (this._itemsToIdx[attr]) {
        if (this._itemsToIdx[oldItem] !== undefined) {
          if (
            this._itemsToIdx[attr][newItem] &&
            this._itemsToIdx[attr][oldItem]
          ) {
            this._itemsToIdx[attr][newItem] = this._itemsToIdx[attr][oldItem];
            delete this._itemsToIdx[attr][oldItem];
          }
        }
      }
    });
    Object.keys(this._itemToLabel).forEach((attr) => {
      if (this._itemToLabel[attr]) {
        if (this._itemToLabel[attr][oldItem]) {
          this._itemToLabel[attr][newItem] = newLabel || newItem;
          delete this._itemToLabel[attr][oldItem];
        }
      }
    });
  }

  override drillUp(targetAttr: TimeSlotPeriodicity) {
    if (targetAttr === this._rootAttribute) return this;

    const newDimension = new GenericDimension(
      this.id,
      targetAttr,
      this.getItems(targetAttr),
      this.label,
      this._itemToLabel[targetAttr],
    );

    const rootItems = this._items[this._rootAttribute];
    const newItems = this._items[targetAttr];
    const newMapping = this._rootIdxToGroupIdx[targetAttr];

    ol: for (const childAttribute of this.attributes) {
      if (childAttribute === targetAttr) continue; // Skip root attribute.

      const childItems = this._items[childAttribute];
      const childMapping = this._rootIdxToGroupIdx[childAttribute];
      const mapping: Record<string, string> = {};

      const rootItemsLength = rootItems?.length ?? 0;
      for (let i = 0; i < rootItemsLength; ++i) {
        const childMappingItem = childMapping?.[i];
        const newMappingItem = newMapping?.[i];
        if (
          typeof childMappingItem !== 'number' ||
          typeof newMappingItem !== 'number'
        ) {
          continue;
        }

        const newItem = newItems?.[newMappingItem];
        const childItem = childItems?.[childMappingItem];

        if (typeof newItem !== 'string' || typeof childItem !== 'string') {
          continue;
        }

        // Not possible to build this attribute (no clean cut on the graph)
        if (mapping[newItem] && mapping[newItem] !== childItem) {
          continue ol;
        }

        mapping[newItem] = childItem;
      }

      newDimension.addAttribute(
        targetAttr,
        childAttribute,
        mapping,
        this._itemToLabel[childAttribute],
      );
    }

    return newDimension;
  }

  override dice(
    attribute: TimeSlotPeriodicity,
    items: string[],
    reorder = false,
  ) {
    const oldItems = this._items[this._rootAttribute] ?? [];
    let newItems = null;

    if (this._rootAttribute === attribute) {
      if (reorder) newItems = items.filter((i) => oldItems.includes(i));
      else newItems = oldItems.filter((i) => items.includes(i));
    } else {
      if (reorder) {
        // because it does not make sense.
        throw new Error('Reordering is not allowed when using groups');
      }

      newItems = oldItems.filter((i) => {
        const groupItem = this.getGroupItemFromRootItem(attribute, i);
        if (!groupItem) return false;
        return items.includes(groupItem.toString());
      });
    }

    // return this if the dice does not change the dimension
    if (oldItems.length === newItems.length) {
      let i = 0;
      for (; i < newItems.length; ++i) if (oldItems[i] !== newItems[i]) break;

      if (i === newItems.length) return this;
    }

    const dimension = new GenericDimension(
      this.id,
      this._rootAttribute,
      newItems,
      this.label,
      this._itemToLabel[this._rootAttribute],
    );
    for (const attribute of this.attributes)
      if (attribute !== this._rootAttribute)
        dimension.addAttribute(
          this._rootAttribute,
          attribute,
          (item) =>
            // @ts-ignore TODO: We are using `string` instead of `TimeSlotPeriodicity`
            this.getGroupItemFromRootItem(attribute, item)?.toString() ?? '',
          this._itemToLabel[attribute],
        );

    return dimension;
  }

  getGroupIndexFromRootIndexMap(groupAttr: TimeSlotPeriodicity) {
    this._checkAttribute(groupAttr);

    return this._rootIdxToGroupIdx[groupAttr];
  }

  override getGroupIndexFromRootIndex(
    groupAttr: TimeSlotPeriodicity,
    rootIdx: number,
  ) {
    this._checkAttribute(groupAttr);
    this._checkRootIndex(rootIdx);

    const groupAttrVal = this._rootIdxToGroupIdx[groupAttr];

    return groupAttrVal?.[rootIdx];
  }

  union(otherDimension: GenericDimension) {
    if (this.id !== otherDimension.id)
      throw new Error('not the same dimension');

    // Choose rootAttribute
    let me: GenericDimension = this;
    let other = otherDimension;
    if (this.attributes.includes(otherDimension._rootAttribute)) {
      me = me.drillUp(otherDimension._rootAttribute);
    } else if (otherDimension.attributes.includes(this._rootAttribute)) {
      other = other.drillUp(this._rootAttribute);
    } else {
      throw new Error('The dimensions are not compatible');
    }

    // Mapping functions
    const anyItemToGroup = (
      groupAttr: TimeSlotPeriodicity,
      rootItem: string,
    ) => {
      try {
        return me.getGroupItemFromRootItem(groupAttr, rootItem);
      } catch {
        return other.getGroupItemFromRootItem(groupAttr, rootItem);
      }
    };

    const anyItemToLabel = (attr: TimeSlotPeriodicity, item: string) => {
      if (me._itemToLabel[attr]?.[item]) return me._itemToLabel[attr][item];
      if (other._itemToLabel[attr]?.[item])
        return other._itemToLabel[attr][item];
      return item;
    };

    // Create union and merge groups.
    const dimension = new GenericDimension(
      me.id,
      me._rootAttribute,
      [
        ...me.getItems(),
        ...otherDimension
          .getItems()
          .filter((item) => !me.getItems().includes(item)),
      ].sort(),
      me.label,
      (item: string) => anyItemToLabel(me._rootAttribute, item),
    );

    // List all groups
    // fixme: would look better using sets
    const groupAttrs: Record<string, boolean> = {};
    for (const attribute of me.attributes) {
      if (attribute !== me._rootAttribute) {
        groupAttrs[attribute] = true;
      }
    }
    for (const attribute of other.attributes) {
      if (attribute !== other._rootAttribute) {
        groupAttrs[attribute] = true;
      }
    }

    for (const groupAttr in groupAttrs)
      try {
        dimension.addAttribute(
          me._rootAttribute,
          groupAttr,
          // @ts-ignore TODO: Look into the type here as it is `string` not `TimeSlotPeriodicity`
          (rootItem) => anyItemToGroup(groupAttr, rootItem),
          // @ts-ignore TODO: Look into the type here as it is `string` not `TimeSlotPeriodicity`
          (groupItem) => anyItemToLabel(groupAttr, groupItem),
        );
      } catch {}

    return dimension;
  }

  intersect(otherDimension: GenericDimension) {
    if (this.id !== otherDimension.id)
      throw new Error('not the same dimension');

    let rootAttribute: TimeSlotPeriodicity;
    if (this.attributes.includes(otherDimension._rootAttribute))
      rootAttribute = otherDimension._rootAttribute;
    else if (otherDimension.attributes.includes(this._rootAttribute))
      rootAttribute = this._rootAttribute;
    else throw new Error('The dimensions are not compatible');

    const otherItems = otherDimension.getItems(rootAttribute);
    const commonItems = this.getItems(rootAttribute).filter((i) =>
      otherItems.includes(i),
    );

    return this.drillUp(rootAttribute).dice(rootAttribute, commonItems);
  }

  _getOrCall(
    objfun: Record<string, string> | ((val: string) => string) | null,
    param: string,
  ) {
    if (!objfun) return param;
    // biome-ignore lint/suspicious/noDoubleEquals: n/a
    if (typeof objfun == 'function') return objfun(param);
    return objfun[param];
  }

  drillDown(_: TimeSlotPeriodicity): GenericDimension {
    throw new Error('Mis-use of drillDown');
  }
}
