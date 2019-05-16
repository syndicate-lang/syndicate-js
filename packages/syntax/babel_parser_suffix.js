// Horrible, horrible, horrible, horrible hack to get hold of (a) the
// Parser and (b) various flags and non-exported values from
// babel-parser/src/parser/index.js.

exports._original_Parser = Parser;
exports.__getParser = function () {
  return Parser;
};
exports.__setParser = function (newParser) {
  Parser = newParser;
};

exports.BIND_LEXICAL = BIND_LEXICAL;
