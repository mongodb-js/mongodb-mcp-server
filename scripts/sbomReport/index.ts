import { CONVERSIONS, convertSbomToDependencyList } from "./dependencies.js";

for (const conversion of CONVERSIONS) {
    convertSbomToDependencyList(conversion);
}
