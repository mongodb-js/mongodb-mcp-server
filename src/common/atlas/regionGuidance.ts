import type { UserConfig } from "../config/userConfig.js";

export const REGION_RECOMMENDATIONS = `Common, non-exhaustive region default mappings by provider:
AWS: "East Coast"/"Virginia"/"US East" → US_EAST_1, "Ohio" → US_EAST_2, "California"/"West Coast" → US_WEST_2, "Southeast Asia"/"APAC"/"Singapore" → AP_SOUTHEAST_1, "Europe"/"EU"/"Ireland" → EU_WEST_1.
GCP: "Central US" → CENTRAL_US, "Western US" → WESTERN_US, "Southeast Asia"/"APAC" → SOUTHEASTERN_ASIA_PACIFIC, "Europe"/"EU" → WESTERN_EUROPE.
AZURE: "East US" → US_EAST_2, "West US" → US_WEST_2, "Europe North" → EUROPE_NORTH, "Europe West" → EUROPE_WEST.
Default recommendation: AWS US_EAST_1.
User-specified regions not present in the mapping MUST be respected, rely on the tool to surface errors if a region is not supported.
`;

export const UPGRADE_REGION_RECOMMENDATIONS = `Common region mappings by provider (default recommendation: AWS US_EAST_1):
AWS: "East Coast"/"Virginia"/"US East" → US_EAST_1, "Ohio" → US_EAST_2, "California"/"West Coast" → US_WEST_2, "Southeast Asia"/"APAC"/"Singapore" → AP_SOUTHEAST_1, "Europe"/"EU"/"Ireland" → EU_WEST_1.
GCP: "Central US" → CENTRAL_US, "Western US" → WESTERN_US, "Southeast Asia"/"APAC" → SOUTHEASTERN_ASIA_PACIFIC, "Europe"/"EU" → WESTERN_EUROPE.
AZURE: "East US" → US_EAST_2, "West US" → US_WEST_2, "Europe"/"EU" → EUROPE_NORTH.`;

const GET_REGIONS_GUIDANCE =
    "Use atlas-get-regions to look up valid Atlas region codes for a provider before calling this tool. " +
    "Default recommendation: AWS US_EAST_1.";

const REGION_ARG_BASE_DESCRIPTION =
    "Cloud provider region in Atlas format using uppercase letters and underscores (e.g. US_EAST_1).";

const GET_REGIONS_ARG_NUDGE = " Use atlas-get-regions to list valid regions for the selected provider.";

export function getRegionArgDescription(config: UserConfig): string {
    return isAtlasGetRegionsEnabled(config)
        ? REGION_ARG_BASE_DESCRIPTION + GET_REGIONS_ARG_NUDGE
        : REGION_ARG_BASE_DESCRIPTION;
}

export function getUpgradeRegionArgDescription(config: UserConfig): string {
    return getRegionArgDescription(config) + " If omitted, the existing value is preserved.";
}

export function isAtlasGetRegionsEnabled(config: UserConfig): boolean {
    return config.previewFeatures.includes("atlasGetRegions");
}

export function getCreateClusterRegionGuidance(config: UserConfig): string {
    return isAtlasGetRegionsEnabled(config) ? GET_REGIONS_GUIDANCE : REGION_RECOMMENDATIONS;
}

export function getUpgradeClusterRegionGuidance(config: UserConfig): string {
    return isAtlasGetRegionsEnabled(config) ? GET_REGIONS_GUIDANCE : UPGRADE_REGION_RECOMMENDATIONS;
}
