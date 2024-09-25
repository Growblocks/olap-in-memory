type ArraySubClasses =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

const TypedArraySubClasses = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
];

const ARRAY_BUFFER = 1;
const TYPED_ARRAY = 2;
const ARRAY = 3;
const STRING = 4;
const OBJECT = 5;
const NULL = 6;
const NUMBER = 7;
const BOOLEAN = 8;

/**
 * Serialize a mix of ArrayBuffer, TypedArray, Array, String and plain objects into a buffer.
 */
export function toBuffer(
  obj:
    | Record<string, unknown>
    | ArrayBuffer
    //
    | Uint8Array,
): ArrayBuffer {
  let result: ArrayBuffer;

  if (obj === null) {
    result = new ArrayBuffer(4);
    new Uint32Array(result, 0, 1).set([NULL]);
  } else if (obj === undefined) {
    result = new ArrayBuffer(4);
    new Uint32Array(result, 0, 1).set([]);
  } else if (obj instanceof ArrayBuffer) {
    // We waste some space by padding the end of each arraybuffer with zeros
    // to avoid breaking alignment in the blob.
    result = new ArrayBuffer(8 + Math.ceil(obj.byteLength / 4) * 4);
    new Uint32Array(result, 0, 2).set([ARRAY_BUFFER, obj.byteLength]);
    new Uint8Array(result, 8, obj.byteLength).set(new Uint8Array(obj));
  } else if (obj.buffer instanceof ArrayBuffer) {
    const typeIndex = TypedArraySubClasses.findIndex(
      (type) => obj instanceof type,
    );
    const payload = toBuffer(obj.buffer);

    result = new ArrayBuffer(8 + payload.byteLength);
    new Uint32Array(result, 0, 2).set([TYPED_ARRAY, typeIndex]);
    new Uint8Array(result, 8, payload.byteLength).set(new Uint8Array(payload));
  } else if (Array.isArray(obj)) {
    const buffers = obj.map((item) => toBuffer(item));
    const payloadLength = buffers.reduce((m, b) => m + 4 + b.byteLength, 0);

    result = new ArrayBuffer(8 + payloadLength);
    new Uint32Array(result, 0, 2).set([ARRAY, buffers.length]);

    let offset = 8;
    for (let i = 0; i < buffers.length; ++i) {
      const item = buffers[i];
      if (!item) {
        throw new Error('Invalid array buffer item');
      }
      const length = item.byteLength;
      new Uint32Array(result, offset, 1).set([length]);
      new Uint8Array(result, offset + 4, length).set(new Uint8Array(item));
      offset += 4 + length;
    }
  } else if (typeof obj === 'string') {
    const payload = toBuffer(new TextEncoder().encode(obj));

    result = new ArrayBuffer(4 + payload.byteLength);
    new Uint32Array(result, 0, 1).set([STRING]);
    new Uint8Array(result, 4, payload.byteLength).set(new Uint8Array(payload));
  } else if (typeof obj === 'number') {
    result = new ArrayBuffer(8);
    new Uint32Array(result, 0, 1).set([NUMBER]);
    new Float32Array(result, 4, 1).set([obj]);
  } else if (typeof obj === 'boolean') {
    result = new ArrayBuffer(8);
    new Uint32Array(result, 0, 1).set([BOOLEAN]);
    new Float32Array(result, 4, 1).set([obj ? 1 : 0]);
  } else {
    const payload = toBuffer(
      // @ts-ignore -- TODO: Fix this type, if simple or possible.
      Object.entries(obj).map(([key, value]) => [key, toBuffer(value)]),
    );

    result = new ArrayBuffer(4 + payload.byteLength);
    new Uint32Array(result, 0, 1).set([5]);
    new Uint8Array(result, 4, payload.byteLength).set(new Uint8Array(payload));
  }

  return result;
}

export function fromBuffer(
  buffer: ArrayBuffer | ArraySubClasses,
  offset = 0,
):
  | ArraySubClasses
  | string
  | number
  | boolean
  | null
  | Record<string, ArraySubClasses | number | bigint>
  | ArrayBuffer
  | (ArraySubClasses | ArrayBuffer)[] {
  const header = new Uint32Array(buffer, offset, 1)[0];

  if (header === ARRAY_BUFFER) {
    const size = new Uint32Array(buffer, offset + 4, 1)[0];
    if (typeof size !== 'number') {
      throw new Error('Invalid array buffer size');
    }
    const returnValue = buffer.slice(offset + 8, offset + 8 + size);

    return returnValue;
  }
  if (header === TYPED_ARRAY) {
    const typeIndex = new Uint32Array(buffer, offset + 4, 1)[0];
    if (typeof typeIndex !== 'number') {
      throw new Error('Invalid array buffer size');
    }
    const payload = fromBuffer(buffer, offset + 8);
    // @ts-ignore -- TODO: Fix this type, if simple or possible.
    return new TypedArraySubClasses[typeIndex](payload);
  }
  if (header === ARRAY) {
    const size = new Uint32Array(buffer, offset + 4, 1)[0];
    if (typeof size !== 'number') {
      throw new Error('Invalid array buffer size');
    }

    // TODO: Figure out this type...
    const result: ArrayBuffer[] = [];

    let itemOffset = offset + 8;
    for (let i = 0; i < size; ++i) {
      const itemSize = new Uint32Array(buffer, itemOffset, 1)[0];
      if (typeof itemSize !== 'number') {
        throw new Error('Invalid array buffer size');
      }
      const item = fromBuffer(buffer, itemOffset + 4);

      // if (
      //   !(item instanceof ArrayBuffer) &&
      //   !(item instanceof Int8Array) &&
      //   !(item instanceof Uint8Array) &&
      //   !(item instanceof Uint8ClampedArray) &&
      //   !(item instanceof Int16Array) &&
      //   !(item instanceof Uint16Array) &&
      //   !(item instanceof Int32Array) &&
      //   !(item instanceof Uint32Array) &&
      //   !(item instanceof Float32Array) &&
      //   !(item instanceof Float64Array) &&
      //   !(item instanceof BigInt64Array) &&
      //   !(item instanceof BigUint64Array)
      // ) {
      //   console.error(typeof item, item);
      //   throw new Error('Invalid array buffer item');
      // }

      result.push(item);
      itemOffset += 4 + itemSize;
    }

    return result;
  }
  if (header === STRING) {
    const payload = fromBuffer(buffer, offset + 4);

    if (
      payload === null
      // TODO: Add other checks to verify it is the correct type.
    ) {
      throw new Error('Invalid buffer payload');
    }

    // @ts-ignore -- TODO: Fix this type, if simple or possible.
    return new TextDecoder().decode(payload);
  }
  if (header === NULL) {
    return null;
  }
  if (header === NUMBER) {
    const value = new Float32Array(buffer, offset + 4, 1)[0];
    if (typeof value !== 'number') {
      throw new Error('Invalid number value');
    }

    return value;
  }
  if (header === BOOLEAN) {
    return new Float32Array(buffer, offset + 4, 1)[0] === 1;
  }
  if (header === OBJECT) {
    // TODO: Work on this type...
    const result: Record<
      string,
      Record<string, string> | ArraySubClasses | string
    > = {};
    const bufferValues = fromBuffer(buffer, offset + 4);
    if (!Array.isArray(bufferValues)) {
      throw new Error('Invalid object payload');
    }

    Array.from(bufferValues).forEach((entry) => {
      // @ts-ignore -- TODO: Fix this type, if simple or possible.
      result[entry[0]] = fromBuffer(entry[1]);
    });

    // @ts-ignore -- TODO: Fix this type, if simple or possible.
    return result;
  }

  throw new Error(`Invalid header ${header}`);
}

export function toArrayBuffer(buf: Buffer) {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; ++i) {
    const charCode = buf[i];
    if (typeof charCode !== 'number') {
      throw new Error('Invalid buffer value');
    }

    if (view[i]) {
      view[i] = charCode;
    }
  }
  return ab;
}
