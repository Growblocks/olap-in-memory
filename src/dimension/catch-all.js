const AbstractDimension = require('./abstract');

class CatchAll extends AbstractDimension {
  get attributes() {
    throw new Error('Unsupported');
  }

  /**
   * Create a simple dimension
   */
  constructor(id, childDimension = null) {
    super(id, 'all');
    this.childDimension = childDimension;
  }

  serialize() {
    throw new Error('Unsupported');
  }

  getItems(_attribute = null) {
    return ['_total'];
  }

  getEntries(_attribute = null, _language = 'en') {
    return [['_total', 'Total']];
  }

  drillUp(_newAttribute) {
    return this;
  }

  drillDown(newAttribute) {
    if (this.childDimension) return this.childDimension.drillUp(newAttribute);
    else throw new Error('Must set child dimension.');
  }

  dice(attribute, items, _reorder = false) {
    if (attribute === this.rootAttribute && items.includes('_total'))
      return this;
    else throw new Error('Unsupported');
  }

  diceRange(_attribute, _start, _end) {
    throw new Error('Unsupported');
  }

  /**
   *
   * @param  {[type]} attribute eg: month
   * @param  {[type]} index     32
   * @return {[type]}           2
   */
  getGroupIndexFromRootIndex(_attribute, _index) {
    return 0;
  }

  intersect(otherDimension) {
    return otherDimension;
  }

  union(_otherDimension) {
    return this;
  }
}

module.exports = CatchAll;
