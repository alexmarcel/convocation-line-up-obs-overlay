"use strict";

class OperationCoordinator {
  constructor() {
    this.active = null;
  }
  status() {
    return this.active ? { busy:true, type:this.active.type } : { busy:false };
  }
  async run(type, task) {
    if (this.active) throw new Error(`Cannot start ${type}; ${this.active.type} is already running.`);
    const controller = new AbortController();
    this.active = { type, controller };
    try { return await task(controller.signal); }
    finally { this.active = null; }
  }
  cancel() {
    if (!this.active) return false;
    this.active.controller.abort();
    return true;
  }
}

module.exports = { OperationCoordinator };
