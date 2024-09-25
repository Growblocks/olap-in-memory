import { Parser } from '@growblocks/expr-eval';

export function getParser() {
  const parser = new Parser({
    operators: {
      logical: false,
      comparison: false,
      in: false,
      assignment: false,
    },
  });

  parser.functions = {
    ...parser.functions,
    isNaN: Number.isNaN,
  };

  // Operators are harcoded => we can't create new ones so we steal the concatenation operation.
  // @see https://github.com/silentmatt/expr-eval/blob/92656356d64d7b7edba1ae1a9128799b64030559/src/token-stream.js#L375
  // @ts-expect-error -- This isn't expressed on the type from expr-eval...
  parser.binaryOps['||'] = (a: number, b: number) => {
    if (Number.isNaN(a) && !Number.isNaN(b)) return b;
    if (!Number.isNaN(a) && Number.isNaN(b)) return a;

    return a + b;
  };

  return parser;
}
