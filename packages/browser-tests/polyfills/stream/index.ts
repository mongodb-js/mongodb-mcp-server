// Browser polyfill for Node.js stream module
// Minimal implementation to support mongodb-log-writer in browser tests
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unused-vars */

import { EventEmitter } from "events";

type Callback = (error?: Error | null) => void;
type TransformCallback = (error?: Error | null, data?: any) => void;

export class Writable extends EventEmitter {
    writable = true;
    destroyed = false;

    constructor(_options?: any) {
        super();
    }

    _write(_chunk: any, _encoding: string, callback: Callback): void {
        callback();
    }

    write(chunk: any, encoding?: any, callback?: any): boolean {
        let enc = encoding;
        let cb = callback;

        if (typeof encoding === "function") {
            cb = encoding;
            enc = "utf8";
        }

        this._write(chunk, enc || "utf8", (error) => {
            if (cb) cb(error);
        });

        return true;
    }

    end(chunk?: any, encoding?: any, callback?: any): this {
        let cb = callback;
        let enc = encoding;
        let data = chunk;

        if (typeof chunk === "function") {
            cb = chunk;
            data = null;
            enc = null;
        } else if (typeof encoding === "function") {
            cb = encoding;
            enc = null;
        }

        if (data) {
            this.write(data, enc);
        }

        if (cb) {
            cb();
        }

        this.emit("finish");
        return this;
    }

    destroy(error?: Error): this {
        if (this.destroyed) return this;
        this.destroyed = true;

        if (error) {
            this.emit("error", error);
        }
        this.emit("close");
        return this;
    }
}

export class Readable extends EventEmitter {
    readable = true;
    destroyed = false;

    constructor(_options?: any) {
        super();
    }

    _read(_size: number): void {
        // Override in subclass
    }

    read(size?: number): any {
        this._read(size || 0);
        return null;
    }

    destroy(error?: Error): this {
        if (this.destroyed) return this;
        this.destroyed = true;

        if (error) {
            this.emit("error", error);
        }
        this.emit("close");
        return this;
    }
}

export class Duplex extends Writable {
    readable = true;

    constructor(_options?: any) {
        super(_options);
    }

    _read(_size: number): void {
        // Override in subclass
    }

    read(size?: number): any {
        this._read(size || 0);
        return null;
    }
}

export class Transform extends Duplex {
    constructor(_options?: any) {
        super(_options);
    }

    _transform(_chunk: any, _encoding: string, callback: TransformCallback): void {
        callback(null, _chunk);
    }
}

export default {
    Writable,
    Readable,
    Duplex,
    Transform,
};
