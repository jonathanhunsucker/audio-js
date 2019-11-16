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
  binding.release();
}

function stageFactory(stageObject) {
  const registry = [Wave, Envelope, Gain, Filter, Noise].reduce((reduction, stage) => {
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
  release() {
    const stopsAt = this.stage.release(this.node);
    const bindingStopsAts = this.bindings.map((binding) => binding.release());
    const maxStopsAt = bindingStopsAts.reduce((maxStopsAt, bindingStopsAt) => Math.max(maxStopsAt, bindingStopsAt), stopsAt);
    this.stop(maxStopsAt);
    return maxStopsAt;
  }
  stop(at) {
    try {
      // there seemsn't to be a way to ascertain whether a node is stop-able with 100% guarantee that stop()
      // itself won't throw, so give up and call it and swallow the exception
      this.node.stop(at);
    } catch (e) {
    }
    this.bindings.forEach((binding) => binding.stop(at));
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
    return node.context.currentTime;
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
    return node.context.currentTime;
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
      attack: options.attack,
      decay: options.decay,
      sustain: options.sustain,
      release: options.release,
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

    return now + this.options.release;
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

class Filter {
  constructor(type, frequency, q, gain, upstreams) {
    this.type = type;
    this.frequency = frequency;
    this.q = q;
    this.gain = gain;
    this.upstreams = upstreams;
  }
  static parse(object) {
    return new Filter(
      object.type,
      object.frequency,
      object.q,
      object.gain,
      object.upstreams.map(stageFactory)
    );
  }
  bind(frequency) {
    return new Binding(
      this,
      frequency,
      this.upstreams.map((stage) => stage.bind(frequency))
    );
  }
  press(audioContext, frequency) {
    const now = audioContext.currentTime;

    const filter = audioContext.createBiquadFilter();
    filter.type = this.type;
    filter.frequency.setValueAtTime(this.frequency, now);
    filter.Q.setValueAtTime(this.q, now);
    filter.gain.setValueAtTime(this.gain, now);

    return filter;
  }
  release(filter) {
    return filter.context.currentTime;
  }
  toJSON() {
    return {
      kind: Filter.kind,
      type: this.type,
      frequency: this.frequency,
      q: this.q,
      gain: this.gain,
      upstreams: this.upstreams.map((upstream) => upstream.toJSON()),
    };
  }
}
Filter.kind = "filter";

class Noise {
  static parse() {
    return new Noise();
  }
  bind(frequency) {
    return new Binding(
      this,
      null,
      []
    );
  }
  press(audioContext, frequency) {
    const now = audioContext.currentTime;

    const size = 2 * audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, size, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    output.forEach((sample, i) => output[i] = Math.random() * 2 - 1);
    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.start(now);

    return noise;
  }
  release(noise) {
    return noise.context.currentTime;
  }
  toJSON() {
    return {
      kind: Noise.kind,
    };
  }
}
Noise.kind = "noise";

module.exports = {
  silentPingToWakeAutoPlayGates: silentPingToWakeAutoPlayGates,
  stageFactory: stageFactory,
  Binding: Binding,
  Wave: Wave,
  Gain: Gain,
  Envelope: Envelope,
  Noise: Noise,
  Filter: Filter,
};
