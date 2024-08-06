const GenericDimension = require('./generic');
const TimeDimension = require('./time');
const { fromBuffer } = require('../serialization');

module.exports = {
  deserialize(buffer) {
    const data = fromBuffer(buffer);

    if (data.start) return TimeDimension.deserialize(buffer);

    return GenericDimension.deserialize(buffer);
  },
};
