// Generic empty stub for optional native/desktop dependencies that the eval
// never exercises (it only connects via a plain connection string). esbuild
// cannot bundle their `.node` addons or `electron`, so we alias them to this.
export default {};
export const build = {};
export class AtlasLocalClient {}
