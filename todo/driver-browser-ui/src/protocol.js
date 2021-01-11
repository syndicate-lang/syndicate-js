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

// Message. Interest in this causes event listeners to be added for
// the given eventType to all nodes matching the given selector *at
// the time of the subscription*. As nodes *from this library* come
// and go, they will have event handlers installed and removed as
// well. WARNING: The simple implementation below currently scans the
// whole document anytime a change is signalled; in future, it may not
// do such a scan.
message type GlobalEvent(selector, eventType, event);
module.exports.GlobalEvent = GlobalEvent;

// Message. As GlobalEvent, but instead of using a selector to choose
// target DOM nodes, attaches an event handler to the browser "window"
// object itself.
message type WindowEvent(eventType, event);
module.exports.WindowEvent = WindowEvent;

// Message. Like GlobalEvent, but applies only within the scope of the
// UI fragment identified.
message type UIEvent(fragmentId, selector, eventType, event);
module.exports.UIEvent = UIEvent;

// Assertion. Causes the setup of DOM nodes corresponding to the given
// HTML fragment, as immediate children of all nodes named by the
// given selector that exist at the time of assertion. The orderBy
// field should be null, a string, or a number. Fragments are ordered
// primarily by orderBy, and secondarily by fragmentId.
assertion type UIFragment(fragmentId, selector, html, orderBy);
module.exports.UIFragment = UIFragment;

// Assertion. Asserted by respondent to a given UIFragment.
assertion type UIFragmentVersion(fragmentId, version);
module.exports.UIFragmentVersion = UIFragmentVersion;

// Assertion. Causes the setup of DOM attributes on all nodes named by
// the given selector that exist at the time of assertion.
//
// NOTE: Attribute "class" is a special case: it treats the value of
// the attribute as a (string encoding of a) set. The given value is
// split on whitespace, and each piece is added to the set of things
// already present. (See the implementation for details.)
assertion type UIAttribute(selector, attribute, value);
module.exports.UIAttribute = UIAttribute;

// Assertion. Similar to UIAttribute, but for properties of DOM nodes.
assertion type UIProperty(selector, property, value);
module.exports.UIProperty = UIProperty;

// Assertion. For clients to monitor the values of properties that,
// when changed, emit 'change' events.
assertion type UIChangeableProperty(selector, property, value);
module.exports.UIChangeableProperty = UIChangeableProperty;

// Messages.
// NOTE: These do not treat "class" specially!
message type SetAttribute(selector, attribute, value);
message type RemoveAttribute(selector, attribute);
message type SetProperty(selector, property, value);
message type RemoveProperty(selector, property);
module.exports.SetAttribute = SetAttribute;
module.exports.RemoveAttribute = RemoveAttribute;
module.exports.SetProperty = SetProperty;
module.exports.RemoveProperty = RemoveProperty;

// Assertion. Current "location hash" -- the "#/path/part" fragment at
// the end of window.location.
assertion type LocationHash(value);
module.exports.LocationHash = LocationHash;

// Message. Causes window.location to be updated to have the given new
// "location hash" value.
message type SetLocationHash(value);
module.exports.SetLocationHash = SetLocationHash;
