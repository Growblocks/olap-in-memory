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
    let returnValue = [value];

    for (let i = 0; i < dimensions.length; ++i) {
      const dimItems = dimensions[i].getItems();
      const newValue = new Array(returnValue.length * dimensions[i].numItems);

      for (let j = 0; j < newValue.length; ++j) {
        const chunkIndex = Math.floor(j / dimItems.length);
        const dimItem = dimItems[j % dimItems.length];

        newValue[j] = returnValue[chunkIndex][dimItem];
      }

      returnValue = newValue;
    }

    return returnValue;
  },

  toNestedObject(values, statusMap, dimensions) {
    return toNestedObjectRec(values, statusMap, dimensions, 0, 0);
  },
};
