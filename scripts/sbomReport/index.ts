import { CONVERSIONS, convertSbomToDependencyList } from "./dependencies.js";
import { generatePurls } from "./purls.js";

for (const conversion of CONVERSIONS) {
    convertSbomToDependencyList(conversion);
}

generatePurls();
