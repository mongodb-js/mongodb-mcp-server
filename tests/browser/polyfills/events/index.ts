// Browser polyfill for Node.js events module
// Minimal EventEmitter implementation for browser tests

export class EventEmitter {
    private events: Map<string | symbol, Array<(...args: any[]) => void>> = new Map();

    on(event: string | symbol, listener: (...args: any[]) => void): this {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event)!.push(listener);
        return this;
    }

    once(event: string | symbol, listener: (...args: any[]) => void): this {
        const onceWrapper = (...args: any[]) => {
            this.off(event, onceWrapper);
            listener(...args);
        };
        return this.on(event, onceWrapper);
    }

    off(event: string | symbol, listener: (...args: any[]) => void): this {
        const listeners = this.events.get(event);
        if (listeners) {
            const index = listeners.indexOf(listener);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
            if (listeners.length === 0) {
                this.events.delete(event);
            }
        }
        return this;
    }

    emit(event: string | symbol, ...args: any[]): boolean {
        const listeners = this.events.get(event);
        if (listeners && listeners.length > 0) {
            listeners.forEach((listener) => {
                try {
                    listener(...args);
                } catch (error) {
                    console.error("Error in event listener:", error);
                }
            });
            return true;
        }
        return false;
    }

    removeAllListeners(event?: string | symbol): this {
        if (event) {
            this.events.delete(event);
        } else {
            this.events.clear();
        }
        return this;
    }

    listenerCount(event: string | symbol): number {
        return this.events.get(event)?.length || 0;
    }

    listeners(event: string | symbol): Array<(...args: any[]) => void> {
        return this.events.get(event)?.slice() || [];
    }
}

export default EventEmitter;
