"use strict";
//---------------------------------------------------------------------------
// @syndicate-lang/flappy-bird-demo
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

let { PeriodicTick } = activate require("@syndicate-lang/driver-timer");

assertion type Position(x, y);
assertion type GameOver();
assertion type Score(count);
message type IncreaseScore();

message type Reset();

const BOARD_HEIGHT = 567;
const FLAPPY_WIDTH = 57;
const FLAPPY_HEIGHT = 41;
const FLAPPY_XPOS = 212;
const PILLAR_WIDTH = 86;
const PILLAR_GAP = 158;
const FIELD_HEIGHT = 561;
const PILLAR_HEAD_HEIGHT = 40;

function newGame() {
  spawn named 'score' {
    let ui = new UI.Anchor();
    field this.score = 0;

    stop on message Reset();

    assert Score(this.score);

    on start react {
      assert ui.html('#board-area', <h1 class="score">{this.score}</h1>);
      stop on asserted GameOver() react {
        assert ui.html('#board-area', <h1 class="score">{this.score}<br/>GAME OVER</h1>);
      }
    }

    on message IncreaseScore() {
      this.score++;
    }
  }

  spawn named 'flappy' {
    let ui = new UI.Anchor();
    field this.xpos = 0;
    field this.ypos = 312;
    field this.yvel = 0;

    stop on message Reset();

    assert Position(this.xpos, this.ypos);

    assert ui.html('#board-area', <div class="flappy"
                                       style={`transform: rotate(${2 * this.yvel}deg);
                                               top: ${this.ypos}px`}></div>);

    on (this.ypos > BOARD_HEIGHT - FLAPPY_HEIGHT) {
      this.ypos = BOARD_HEIGHT - FLAPPY_HEIGHT;
      react {
        assert GameOver();
      }
    }

    on start react {
      stop on asserted GameOver();

      on message UI.WindowEvent('+keypress', $e) {
        this.yvel = -10;
      }

      const ms_per_tick = 1000.0 / 60;
      on message PeriodicTick(ms_per_tick) {
        this.xpos += 0.15 * ms_per_tick;
        this.ypos = (this.ypos + this.yvel);
        this.yvel += ms_per_tick * 0.05;
      }
    }
  }

  spawn named 'border-scroll' {
    let ui = new UI.Anchor();
    field this.pos = 0;
    on asserted Position($xpos, _) this.pos = xpos % 23;
    assert ui.html(
      '#board-area',
        <div class="scrolling-border" style={`background-position-x: ${-this.pos}px`}></div>, 0);

    stop on message Reset();
  }

  spawn named 'pipe-factory' {
    on start spawnPipe(0);
    field this.nextPipe = 1;

    stop on message Reset();

    on asserted Score(this.nextPipe) {
      spawnPipe(this.nextPipe++);
    }
  }

  function spawnPipe(i) {
    spawn named ['pipe', i] {
      stop on message Reset();

      let ui = new UI.Anchor();

      const xlocation = (i + 1) * 324;

      const upperHeight =
            Math.random() * (FIELD_HEIGHT - PILLAR_GAP - PILLAR_HEAD_HEIGHT * 6)
            + PILLAR_HEAD_HEIGHT * 3;
      const lowerHeight = FIELD_HEIGHT - upperHeight - PILLAR_GAP;

      stop on (this.xpos < -(PILLAR_WIDTH + FLAPPY_XPOS));

      on start react stop on (this.xpos <= 0) {
        ^ IncreaseScore();
      }

      field this.xpos = xlocation;
      on asserted Position($xpos, _) this.xpos = xlocation - xpos;

      on asserted Position($xpos, $ypos) {
        if (touchingPillar(xpos, ypos)) {
          react {
            assert GameOver();
          }
        }
      }

      assert ui.html(
        '#board-area',
          <div class="pillars">
            <div class="pillar pillar-upper"
                 style={`left: ${this.xpos + FLAPPY_XPOS}px; height: ${upperHeight}px;`}></div>
            <div class="pillar pillar-lower"
                 style={`left: ${this.xpos + FLAPPY_XPOS}px; height: ${lowerHeight}px;`}></div>
          </div>);

      function touchingPillar(xpos, ypos) {
        const inHorizontalRange =
              (xpos + FLAPPY_WIDTH >= xlocation) && (xpos <= xlocation + PILLAR_WIDTH);
        const aboveGapTop = (ypos <= upperHeight);
        const belowGapBottom = (ypos + FLAPPY_HEIGHT >= upperHeight + PILLAR_GAP);
        return inHorizontalRange && (aboveGapTop || belowGapBottom);
      }
    }
  }
}

spawn named 'game-factory' {
  on start newGame();

  // TODO: Use nested dataspaces to clean up restarts

  during GameOver() {
    on stop newGame();
    on message UI.WindowEvent('+keypress', $e) {
      if (e.key !== ' ') {
        ^ Reset();
      }
    }
  }
}
