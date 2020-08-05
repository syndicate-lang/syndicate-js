"use strict";
//---------------------------------------------------------------------------
// @syndicate-lang/syntax-test, a demo of Syndicate extensions to JS.
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

let UI = activate require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

assertion type Person(id, firstName, lastName, address, age);
message type SetSortColumn(number);

function newRow(id, firstName, lastName, address, age) {
  spawn named ('model' + id) {
    assert Person(id, firstName, lastName, address, age);
  }
}

newRow(1, 'Keith', 'Example', '94 Main St.', 44);
newRow(2, 'Karen', 'Fakeperson', '5504 Long Dr.', 34);
newRow(3, 'Angus', 'McFictional', '2B Pioneer Heights', 39);
newRow(4, 'Sue', 'Donnem', '1 Infinite Loop', 104);
newRow(5, 'Boaty', 'McBoatface', 'Arctic Ocean', 1);

spawn named 'view' {
  let ui = new UI.Anchor();
  field this.orderColumn = 2;

  function cell(text) {
    return <td>{text}</td>;
  }

  on message SetSortColumn($c) { this.orderColumn = c; }

  during Person($id, $firstName, $lastName, $address, $age) {
    assert ui.context(id)
      .html('table#the-table tbody',
            <tr>{[id, firstName, lastName, address, age].map(cell)}</tr>,
            [id, firstName, lastName, address, age][this.orderColumn]);
  }
}

spawn named 'controller' {
  on message UI.GlobalEvent('table#the-table th', 'click', $e) {
    send SetSortColumn(JSON.parse(e.target.dataset.column));
  }
}

spawn named 'alerter' {
  let ui = new UI.Anchor();
  assert ui.html('#extra', <button>Click me</button>);

  on message UI.UIEvent(ui.fragmentId, '.', 'click', $e) {
    alert("Hello!");
  }
}

require('@syndicate-lang/core').bootModule(module);
