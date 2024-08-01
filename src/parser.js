const { Parser } = require('@growblocks/expr-eval');

function getParser() {
  const parser = new Parser({
    logical: false,
    comparison: false,
    in: false,
    assignment: false,
  });

  parser.functions = {
    ...parser.functions,
    isNaN: Number.isNaN,
  };

  // Operators are harcoded => we can't create new ones so we steal the concatenation operation.
  // @see https://github.com/silentmatt/expr-eval/blob/92656356d64d7b7edba1ae1a9128799b64030559/src/token-stream.js#L375
  parser.binaryOps['||'] = (a, b) => {
    if (Number.isNaN(a) && !Number.isNaN(b)) return b;
    if (!Number.isNaN(a) && Number.isNaN(b)) return a;

    return a + b;
  };

  return parser;
}

module.exports = getParser;
