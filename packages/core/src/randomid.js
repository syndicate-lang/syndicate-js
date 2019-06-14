//---------------------------------------------------------------------------
// @syndicate-lang/driver-browser-ui, Browser-based UI for Syndicate
// Copyright (C) 2016-2018 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//---------------------------------------------------------------------------

if (require('preserves/src/singletonmodule.js')('syndicate-lang.org/syndicate-js',
                                                require('../package.json').version,
                                                'randomid.js',
                                                module)) return;

let randomId;

function browserCryptoObject(crypto) {
  if (typeof crypto.getRandomValues === 'undefined') return false;
  randomId = function (byteCount, hexOutput) {
    let buf = new Uint8Array(byteCount);
    crypto.getRandomValues(buf);
    if (hexOutput) {
      let encoded = [];
      for (let i = 0; i < buf.length; i++) {
	encoded.push("0123456789abcdef"[(buf[i] >> 4) & 15]);
	encoded.push("0123456789abcdef"[buf[i] & 15]);
      }
      return encoded.join('');
    } else {
      return btoa(String.fromCharCode.apply(null, buf)).replace(/=/g,'');
    }
  };
  return true;
}

if ((typeof window !== 'undefined') &&
    (typeof window.crypto !== 'undefined') &&
    browserCryptoObject(window.crypto)) {
  // We are in the main page, and window.crypto is available, and
  // browserCryptoObject has installed a suitable randomId. Do
  // nothing.
} else if ((typeof self !== 'undefined') &&
           (typeof self.crypto !== 'undefined') &&
           browserCryptoObject(self.crypto)) {
  // We are in a web worker, and self.crypto is available, and
  // browserCryptoObject has installed a suitable randomId. Do
  // nothing.
} else {
  // See if we're in node.js.

  let crypto;
  try {
    crypto = require('crypto');
  } catch (e) {}
  if ((typeof crypto !== 'undefined') &&
      (typeof crypto.randomBytes !== 'undefined')) {
    randomId = function (byteCount, hexOutput) {
      if (hexOutput) {
        return crypto.randomBytes(byteCount).hexSlice().replace(/=/g,'');
      } else {
        return crypto.randomBytes(byteCount).base64Slice().replace(/=/g,'');
      }
    };
  } else {
    console.warn('No suitable implementation for RandomID.randomId available.');
  }
}

module.exports.randomId = randomId;
