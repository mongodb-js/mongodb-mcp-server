export type CloudProvider = "AWS" | "GCP" | "AZURE";

export interface ClusterRegion {
    name: string;
    location: string;
}

export interface ProviderRegions {
    provider: CloudProvider;
    regions: ClusterRegion[];
}

/** PoC static region list for atlas-get-regions evals. Production should use listClusterProviderRegions API. */
export const CLUSTER_REGIONS: Record<CloudProvider, ClusterRegion[]> = {
    AWS: [
        { name: "US_EAST_1", location: "N. Virginia, US" },
        { name: "US_EAST_2", location: "Ohio, US" },
        { name: "US_WEST_1", location: "N. California, US" },
        { name: "US_WEST_2", location: "Oregon, US" },
        { name: "CA_CENTRAL_1", location: "Montreal, Canada" },
        { name: "EU_WEST_1", location: "Ireland" },
        { name: "EU_WEST_2", location: "London, UK" },
        { name: "EU_WEST_3", location: "Paris, France" },
        { name: "EU_CENTRAL_1", location: "Frankfurt, Germany" },
        { name: "EU_NORTH_1", location: "Stockholm, Sweden" },
        { name: "AP_SOUTHEAST_1", location: "Singapore" },
        { name: "AP_SOUTHEAST_2", location: "Sydney, Australia" },
        { name: "AP_NORTHEAST_1", location: "Tokyo, Japan" },
        { name: "AP_NORTHEAST_2", location: "Seoul, South Korea" },
        { name: "AP_SOUTH_1", location: "Mumbai, India" },
        { name: "SA_EAST_1", location: "São Paulo, Brazil" },
        { name: "ME_SOUTH_1", location: "Bahrain" },
        { name: "AF_SOUTH_1", location: "Cape Town, South Africa" },
    ],
    GCP: [
        { name: "CENTRAL_US", location: "Iowa, US" },
        { name: "EASTERN_US", location: "South Carolina, US" },
        { name: "WESTERN_US", location: "Oregon, US" },
        { name: "US_EAST_4", location: "N. Virginia, US" },
        { name: "WESTERN_EUROPE", location: "Belgium" },
        { name: "EUROPE_WEST_2", location: "London, UK" },
        { name: "EUROPE_WEST_3", location: "Frankfurt, Germany" },
        { name: "SOUTHEASTERN_ASIA_PACIFIC", location: "Singapore" },
        { name: "NORTHEASTERN_ASIA_PACIFIC", location: "Tokyo, Japan" },
        { name: "SOUTH_AMERICA_EAST_1", location: "São Paulo, Brazil" },
        { name: "AUSTRALIA_SOUTHEAST_1", location: "Sydney, Australia" },
        { name: "ASIA_SOUTH_1", location: "Mumbai, India" },
    ],
    AZURE: [
        { name: "US_EAST_2", location: "Virginia, US" },
        { name: "US_WEST_2", location: "Washington, US" },
        { name: "EUROPE_NORTH", location: "Ireland" },
        { name: "EUROPE_WEST", location: "Netherlands" },
        { name: "GERMANY_WEST_CENTRAL", location: "Frankfurt, Germany" },
        { name: "UK_SOUTH", location: "London, UK" },
        { name: "FRANCE_CENTRAL", location: "Paris, France" },
        { name: "AUSTRALIA_EAST", location: "New South Wales, Australia" },
        { name: "JAPAN_EAST", location: "Tokyo, Japan" },
        { name: "SOUTHEAST_ASIA", location: "Singapore" },
        { name: "CENTRAL_INDIA", location: "Pune, India" },
        { name: "BRAZIL_SOUTH", location: "São Paulo, Brazil" },
    ],
};

export function getClusterRegions(provider?: CloudProvider): ProviderRegions[] {
    const providers = provider ? [provider] : (["AWS", "GCP", "AZURE"] as const);
    return providers.map((p) => ({
        provider: p,
        regions: CLUSTER_REGIONS[p],
    }));
}
