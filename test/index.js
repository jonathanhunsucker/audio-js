"use strict";

var assert = require('assert');

var audioJs = require('../src/index');

describe('audio.js', function () {
  it('should exports an instantiable class Gain', function () {
    var gain = new audioJs.Gain(0.5, [
      new audioJs.Wave('triangle'),
    ]);

    assert.equal(gain.level, 0.5);
    assert.equal(gain.upstreams[0].type, 'triangle');
  });
});
