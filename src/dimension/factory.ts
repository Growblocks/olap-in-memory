import { GenericDimension } from './generic.js';
import { TimeDimension } from './time.js';
import { fromBuffer } from '../serialization.js';

export function deserialize(buffer: ArrayBuffer) {
  const data = fromBuffer(buffer);
  if (!data) {
    throw new Error('Invalid buffer');
  }

  // @ts-ignore TODO: Look into the type we are expecting returned by `fromBuffer`
  if (data.start) return TimeDimension.deserialize(buffer);

  return GenericDimension.deserialize(buffer);
}
