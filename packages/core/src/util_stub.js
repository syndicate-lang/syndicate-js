module.exports = {
  inspect: (item) => {
    try {
      return JSON.stringify(item);
    } catch (_e) {
      return '<uninspectable_value>';
    }
  },
};

module.exports.inspect.custom = Symbol('util_stub.inspect.custom');
