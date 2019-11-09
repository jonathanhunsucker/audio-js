"use strict";

/**
 * Some browsers gate audio until the user interacts with the page.
 *
 * One strategy for "opening" this browser-internal gate, is to play
 * a sound on an audio context, from within the handler for an event
 * induced by an intentional (ie. not scrolling) interaction with the
 * page.
 *
 * This method exists to be a quick gate-opening method.
 */
function silentPingToWakeAutoPlayGates(audioContext) {
  const binding = new Binding(
    new Gain(0.0),
    null,
    [
      new Binding(
        new Wave('triangle'),
        440,
        []
      ),
    ]
  );

  binding.play(audioContext, audioContext.destination);
  binding.stop();
}

function stageFactory(stageObject) {
  const registry = [Wave, Envelope, Gain].reduce((reduction, stage) => {
    reduction[stage.kind] = stage;
    return reduction;
  }, {});

  return registry[stageObject.kind].parse(stageObject);
}

/*
 * Partial application of a frequency to tree of stages
 */
class Binding {
  constructor(stage, frequency, bindings) {
    this.stage = stage;
    this.frequency = frequency;
    this.bindings = bindings;
  }
  /*
   * Actually builds nodes, then starts and connects
   */
  play(audioContext, destination) {
    const node = this.stage.press(audioContext, this.frequency);
    node.connect(destination);
    this.node = node;
    this.bindings.forEach((binding) => binding.play(audioContext, node).connect(node));
    return node;
  }
  stop() {
    this.stage.release(this.node);
    this.bindings.map((binding) => binding.stop());
  }
}

class Wave {
  constructor(type) {
    this.type = type;
  }
  static parse(object) {
    return new Wave(object.type);
  }
  bind(frequency) {
    return new Binding(
      this,
      frequency,
      []
    );
  }
  press(audioContext, frequency) {
    const wave = audioContext.createOscillator();

    wave.type = this.type;
    wave.frequency.value = frequency;
    wave.start(wave.context.currentTime);

    return wave;
  }
  release(node) {
    node.stop(node.context.currentTime + 1.0);
  }
  toJSON() {
    return {
      kind: Wave.kind,
      type: this.type,
    };
  }
}
Wave.kind = "wave";

class Gain {
  constructor(level, upstreams) {
    this.level = level;
    this.upstreams = upstreams;
  }
  static parse(object) {
    return new Gain(object.level, (object.upstreams || []).map(stageFactory));
  }
  bind(frequency) {
    return new Binding(
      this,
      frequency,
      this.upstreams.map((stage) => stage.bind(frequency))
    );
  }
  press(audioContext) {
    const gain = audioContext.createGain();
    gain.gain.value = this.level;

    return gain;
  }
  release(node) {
  }
  toJSON() {
    return {
      kind: Gain.kind,
      level: this.level,
      upstreams: this.upstreams.map((upstream) => upstream.toJSON()),
    };
  }
}
Gain.kind = "gain";

class Envelope {
  constructor(options, upstreams) {
    this.options = {
      attack: options.attack || 0.01,
      decay: options.decay || 0.2,
      sustain: options.sustain || 0.1,
      release: options.release || 0.5,
    };

    this.upstreams = upstreams;
  }
  static parse(object) {
    return new Envelope({
      attack: object.attack,
      decay: object.decay,
      sustain: object.sustain,
      release: object.release,
    }, object.upstreams.map(stageFactory));
  }
  bind(frequency) {
    return new Binding(
      this,
      frequency,
      this.upstreams.map((stage) => stage.bind(frequency))
    );
  }
  press(audioContext, frequency) {
    const node = audioContext.createGain();
    const now = node.context.currentTime;

    node.gain.setValueAtTime(0.0, now + 0.0); // initialize to 0
    node.gain.linearRampToValueAtTime(1.0, now + this.options.attack); // attack
    node.gain.linearRampToValueAtTime(this.options.sustain, now + this.options.attack + this.options.decay); // decay to sustain

    return node;
  }
  release(node) {
    const now = node.context.currentTime;
    const valueBefore = node.gain.value;
    node.gain.cancelScheduledValues(now);

    node.gain.setValueAtTime(valueBefore, now);
    node.gain.linearRampToValueAtTime(0, now + this.options.release);
  }
  toJSON() {
    return {
      kind: Envelope.kind,
      attack: this.options.attack,
      decay: this.options.decay,
      sustain: this.options.sustain,
      release: this.options.release,
      upstreams: this.upstreams.map((upstream) => upstream.toJSON()),
    };
  }
}
Envelope.kind = "envelope";

module.exports = {
  silentPingToWakeAutoPlayGates: silentPingToWakeAutoPlayGates,
  stageFactory: stageFactory,
  Binding: Binding,
  Wave: Wave,
  Gain: Gain,
  Envelope: Envelope,
};
