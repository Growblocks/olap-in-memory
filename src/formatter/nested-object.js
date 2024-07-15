// TODO: utilize statusMap
function toNestedObjectRec(values, statusMap, dimensions, dimOffset, offset) {
  if (dimOffset >= dimensions.length) {
    return values[offset];
  }

  const result = {};
  const items = dimensions[dimOffset].getItems();
  items.forEach((item, itemIndex) => {
    const childOffset = offset * items.length + itemIndex;
    result[item] = toNestedObjectRec(
      values,
      statusMap,
      dimensions,
      dimOffset + 1,
      childOffset,
    );
  });

  return result;
}

module.exports = {
  fromNestedObject(value, dimensions) {
    value = [value];

    for (let i = 0; i < dimensions.length; ++i) {
      const dimItems = dimensions[i].getItems(),
        newValue = new Array(value.length * dimensions[i].numItems);

      for (let j = 0; j < newValue.length; ++j) {
        const chunkIndex = Math.floor(j / dimItems.length),
          dimItem = dimItems[j % dimItems.length];

        newValue[j] = value[chunkIndex][dimItem];
      }

      value = newValue;
    }

    return value;
  },

  toNestedObject(values, statusMap, dimensions) {
    return toNestedObjectRec(values, statusMap, dimensions, 0, 0);
  },
};
