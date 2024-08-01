module.exports = {
  fromNestedArray(values, dimensions) {
    const numSteps = dimensions.length - 1;
    let returnValue = values;

    for (let i = 0; i < numSteps; ++i) {
      returnValue = [].concat(...values);
    }

    return returnValue;
  },

  // TODO: utilize statusMap
  toNestedArray(values, _statusMap, dimensions) {
    // numDimensions == 0

    if (dimensions.length === 0) {
      return values[0];
    }

    let returnValue = values;

    // numDimensions >= 1
    for (let i = dimensions.length - 1; i > 0; --i) {
      const chunkSize = dimensions[i].numItems;

      const newValues = new Array(values.length / chunkSize);
      for (let j = 0; j < newValues.length; ++j) {
        newValues[j] = values.slice(j * chunkSize, j * chunkSize + chunkSize);
      }

      returnValue = newValues;
    }

    return returnValue;
  },
};
