// Horrible, horrible, horrible, horrible hack to get hold of the Parser
// from babel-parser/src/parser/index.js.

exports._original_Parser = Parser;
exports.__getParser = function () {
  return Parser;
};
exports.__setParser = function (newParser) {
  Parser = newParser;
};
