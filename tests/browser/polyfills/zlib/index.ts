export function inflate() {
    // noop
}
export function deflate() {
    // noop
}
export function gunzipSync(buf: Buffer) {
    return buf;
}
export default { inflate, deflate, gunzipSync };
