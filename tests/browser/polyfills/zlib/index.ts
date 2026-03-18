export function inflate() {
    // noop
}
export function deflate() {
    // noop
}
export function gunzip(buf: Buffer, callback: (err: Error | null, result: Buffer) => void) {
    callback(null, buf);
}
export default { inflate, deflate, gunzip };
