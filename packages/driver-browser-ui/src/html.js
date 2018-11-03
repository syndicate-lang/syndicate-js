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

assertion type htmlTag(label, properties, children);
assertion type htmlProperty(key, value);
assertion type htmlFragment(children);
assertion type htmlLiteral(text);

export function html(tag, props, ...kids) {
  if (tag === htmlFragment) {
    // JSX short syntax for fragments doesn't allow properties, so
    // props will never have any defined.
    return htmlFragment(kids);
  } else {
    let properties = []
    for (let k in props) {
      properties.push(htmlProperty(k, props[k]));
    }
    return htmlTag(tag, properties, kids);
  }
}

//---------------------------------------------------------------------------

export function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const emptyHtmlElements = {};
for (let e of
     "area base br col embed hr img input keygen link meta param source track wbr".split(/ +/)) {
  emptyHtmlElements[e] = true;
}

export function htmlToString(j) {
  let pieces = [];

  function walk(j) {
    if (htmlTag.isClassOf(j)) {
      pieces.push('<', j[0]);
      j[1].forEach((p) => pieces.push(' ', escapeHtml(p[0]), '="', escapeHtml(p[1])));
      pieces.push('>');
      j[2].forEach(walk);
      if (!(j[0] in emptyHtmlElements)) {
        pieces.push('</', j[0], '>');
      }
    } else if (htmlFragment.isClassOf(j)) {
      j[0].forEach(walk);
    } else if (htmlLiteral.isClassOf(j)) {
      pieces.push(j[0]);
    } else if (typeof j === 'object' && j && typeof j[Symbol.iterator] === 'function') {
      for (let k of j) { walk(k); }
    } else {
      pieces.push(escapeHtml("" + j));
    }
  }

  walk(j);
  return pieces.join('');
}
