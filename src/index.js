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

  binding.play(audioContext, audioContext.destination, audioContext.currentTime);
  binding.release();
}

function stageFactory(stageObject) {
  const registry = [Wave, Envelope, Gain, Filter, Noise, Sample].reduce((reduction, stage) => {
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
  play(audioContext, destination, at) {
    const node = this.stage.press(audioContext, at, this.frequency);
    node.connect(destination);
    this.node = node;
    this.bindings.forEach((binding) => binding.play(audioContext, node, at).connect(node));
    return node;
  }
  release() {
    const stopsAt = this.internalReleaseAndCalculateMaxStopsAt();
    this.stop(stopsAt);
  }
  /**
   * @private
   */
  internalReleaseAndCalculateMaxStopsAt() {
    const stopsAt = this.stage.release(this.node);
    const bindingStopsAts = this.bindings.map((binding) => binding.internalReleaseAndCalculateMaxStopsAt());
    const maxStopsAt = bindingStopsAts.reduce((maxStopsAt, bindingStopsAt) => Math.max(maxStopsAt, bindingStopsAt), stopsAt);
    return maxStopsAt;
  }
  /**
   * @private
   */
  stop(at) {
    this.node.stop && this.node.stop(at);
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
  press(audioContext, at, frequency) {
    const wave = audioContext.createOscillator();

    wave.type = this.type;
    wave.frequency.value = frequency;
    wave.start(at);

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
  press(audioContext, at) {
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
  press(audioContext, at, frequency) {
    const node = audioContext.createGain();

    node.gain.setValueAtTime(0.0, at + 0.0); // initialize to 0
    node.gain.linearRampToValueAtTime(1.0, at + this.options.attack); // attack
    node.gain.linearRampToValueAtTime(this.options.sustain, at + this.options.attack + this.options.decay); // decay to sustain

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
  press(audioContext, at, frequency) {
    const filter = audioContext.createBiquadFilter();
    filter.type = this.type;
    filter.frequency.setValueAtTime(this.frequency, at);
    filter.Q.setValueAtTime(this.q, at);
    filter.gain.setValueAtTime(this.gain, at);

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
  press(audioContext, at, frequency) {
    const size = 2 * audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, size, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    output.forEach((sample, i) => output[i] = Math.random() * 2 - 1);
    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.start(at);

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

class Sample {
  /**
   * @param {Float32Array[]} data Array of Float32Arrays, one per channel
   * @param {Number} beginAt
   * @param {Number} endAt
   */
  constructor(data, beginAt, endAt) {
    this.data = data;
    this.beginAt = beginAt;
    this.endAt = endAt;
  }
  static parse(object) {
    return new Sample(object.data, object.beginAt || 0, object.endAt || object.data[0].length);
  }
  bind(frequency) {
    return new Binding(
      this,
      null,
      []
    );
  }
  dataLengthInFrames() {
    return Math.max(...this.data.map((array) => array.length))
  }
  createBufferContainingData(audioContext) {
    const countFrames = this.dataLengthInFrames();
    const buffer = audioContext.createBuffer(this.data.length, countFrames, 44100);

    this.data.forEach((channelData, index) => {
      for (let i = this.beginAt; i < this.endAt; i++) {
        buffer.getChannelData(index)[i] = channelData[i]
      }
    })

    return buffer
  }
  press(audioContext, at, frequency) {
    const buffer = this.createBufferContainingData(audioContext);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.start(at);

    return source;
  }
  release(sample) {
    return sample.context.currentTime;
  }
  toJSON() {
    return {
      kind: "sample",
      data: this.data,
      beginAt: this.beginAt,
      endAt: this.endAt,
    };
  }
}
Sample.kind = "sample";

module.exports = {
  silentPingToWakeAutoPlayGates: silentPingToWakeAutoPlayGates,
  stageFactory: stageFactory,
  Binding: Binding,
  Wave: Wave,
  Gain: Gain,
  Envelope: Envelope,
  Noise: Noise,
  Filter: Filter,
  Sample: Sample,
};
