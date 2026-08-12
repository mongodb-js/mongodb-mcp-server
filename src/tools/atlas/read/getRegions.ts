import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GetRegionsMetadata } from "../../../telemetry/types.js";
import { AtlasArgs, type AtlasCloudProvider } from "../../args.js";
import type { OperationType, ToolArgs, ToolExecutionContext, ToolResult } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";

interface AtlasRegion {
    name: string;
    location: string;
}

export const ATLAS_REGIONS: Record<AtlasCloudProvider, AtlasRegion[]> = {
    AWS: [
        { name: "US_EAST_1", location: "Northern Virginia, USA" },
        { name: "US_WEST_2", location: "Oregon, USA" },
        { name: "CA_CENTRAL_1", location: "Montreal, QC, Canada" },
        { name: "CA_WEST_1", location: "Calgary, Canada" },
        { name: "US_EAST_2", location: "Ohio, USA" },
        { name: "US_WEST_1", location: "Northern California, USA" },
        { name: "SA_EAST_1", location: "São Paulo, Brazil" },
        { name: "MX_CENTRAL_1", location: "Querétaro, Mexico" },
        { name: "AP_SOUTHEAST_1", location: "Singapore" },
        { name: "AP_SOUTHEAST_2", location: "Sydney, NSW, Australia" },
        { name: "AP_SOUTHEAST_3", location: "Jakarta, Indonesia" },
        { name: "AP_SOUTH_1", location: "Mumbai, India" },
        { name: "AP_EAST_1", location: "Hong Kong, China" },
        { name: "AP_EAST_2", location: "Taiwan" },
        { name: "AP_NORTHEAST_1", location: "Tokyo, Japan" },
        { name: "AP_NORTHEAST_2", location: "Seoul, South Korea" },
        { name: "AP_NORTHEAST_3", location: "Osaka, Japan" },
        { name: "AP_SOUTH_2", location: "Hyderabad, India" },
        { name: "AP_SOUTHEAST_4", location: "Melbourne, Victoria, Australia" },
        { name: "AP_SOUTHEAST_5", location: "Malaysia" },
        { name: "AP_SOUTHEAST_6", location: "Auckland, New Zealand" },
        { name: "AP_SOUTHEAST_7", location: "Thailand" },
        { name: "EU_WEST_1", location: "Ireland" },
        { name: "EU_CENTRAL_1", location: "Frankfurt, Germany" },
        { name: "EU_NORTH_1", location: "Stockholm, Sweden" },
        { name: "EU_WEST_2", location: "London, England, UK" },
        { name: "EU_WEST_3", location: "Paris, France" },
        { name: "EU_SOUTH_1", location: "Milan, Italy" },
        { name: "EU_CENTRAL_2", location: "Zurich, Switzerland" },
        { name: "EU_SOUTH_2", location: "Spain" },
        { name: "ME_SOUTH_1", location: "Bahrain" },
        { name: "AF_SOUTH_1", location: "Cape Town, South Africa" },
        { name: "IL_CENTRAL_1", location: "Tel Aviv, Israel" },
        { name: "ME_CENTRAL_1", location: "United Arab Emirates" },
    ],
    GCP: [
        { name: "CENTRAL_US", location: "Iowa, USA" },
        { name: "EASTERN_US", location: "South Carolina, USA" },
        { name: "US_EAST_4", location: "Northern Virginia, USA" },
        { name: "US_EAST_5", location: "Columbus, OH, USA" },
        { name: "NORTH_AMERICA_NORTHEAST_1", location: "Montreal, Canada" },
        { name: "NORTH_AMERICA_NORTHEAST_2", location: "Toronto, Canada" },
        { name: "SOUTH_AMERICA_EAST_1", location: "São Paulo, Brazil" },
        { name: "SOUTH_AMERICA_WEST_1", location: "Santiago, Chile" },
        { name: "WESTERN_US", location: "Oregon, USA" },
        { name: "US_WEST_2", location: "Los Angeles, CA, USA" },
        { name: "US_WEST_3", location: "Salt Lake City, UT, USA" },
        { name: "US_WEST_4", location: "Las Vegas, NV, USA" },
        { name: "US_SOUTH_1", location: "Dallas, TX, USA" },
        { name: "NORTH_AMERICA_SOUTH_1", location: "Querétaro, Mexico" },
        { name: "EASTERN_ASIA_PACIFIC", location: "Taiwan" },
        { name: "ASIA_EAST_2", location: "Hong Kong, China" },
        { name: "NORTHEASTERN_ASIA_PACIFIC", location: "Tokyo, Japan" },
        { name: "ASIA_NORTHEAST_2", location: "Osaka, Japan" },
        { name: "ASIA_NORTHEAST_3", location: "Seoul, South Korea" },
        { name: "SOUTHEASTERN_ASIA_PACIFIC", location: "Singapore" },
        { name: "ASIA_SOUTH_1", location: "Mumbai, India" },
        { name: "ASIA_SOUTH_2", location: "Delhi, India" },
        { name: "AUSTRALIA_SOUTHEAST_1", location: "Sydney, Australia" },
        { name: "AUSTRALIA_SOUTHEAST_2", location: "Melbourne, Australia" },
        { name: "ASIA_SOUTHEAST_2", location: "Jakarta, Indonesia" },
        { name: "WESTERN_EUROPE", location: "Belgium" },
        { name: "EUROPE_NORTH_1", location: "Finland" },
        { name: "EUROPE_WEST_2", location: "London, UK" },
        { name: "EUROPE_WEST_3", location: "Frankfurt, Germany" },
        { name: "EUROPE_WEST_4", location: "Netherlands" },
        { name: "EUROPE_WEST_6", location: "Zurich, Switzerland" },
        { name: "EUROPE_WEST_10", location: "Berlin, Germany" },
        { name: "EUROPE_CENTRAL_2", location: "Warsaw, Poland" },
        { name: "EUROPE_WEST_8", location: "Milan, Italy" },
        { name: "EUROPE_WEST_9", location: "Paris, France" },
        { name: "EUROPE_WEST_12", location: "Turin, Italy" },
        { name: "EUROPE_SOUTHWEST_1", location: "Madrid, Spain" },
        { name: "MIDDLE_EAST_WEST_1", location: "Tel Aviv, Israel" },
        { name: "MIDDLE_EAST_CENTRAL_1", location: "Doha, Qatar" },
        { name: "MIDDLE_EAST_CENTRAL_2", location: "Dammam, Saudi Arabia" },
        { name: "AFRICA_SOUTH_1", location: "Johannesburg, South Africa" },
    ],
    AZURE: [
        { name: "US_CENTRAL", location: "Iowa, USA" },
        { name: "US_EAST", location: "Virginia (East US)" },
        { name: "US_EAST_2", location: "Virginia, USA" },
        { name: "US_NORTH_CENTRAL", location: "Illinois, USA" },
        { name: "US_WEST", location: "California, USA" },
        { name: "US_WEST_2", location: "Washington, USA" },
        { name: "US_WEST_3", location: "Arizona, USA" },
        { name: "US_WEST_CENTRAL", location: "Wyoming, USA" },
        { name: "US_SOUTH_CENTRAL", location: "Texas, USA" },
        { name: "BRAZIL_SOUTH", location: "São Paulo, Brazil" },
        { name: "BRAZIL_SOUTHEAST", location: "Rio de Janeiro, Brazil" },
        { name: "CANADA_EAST", location: "Quebec City, QC, Canada" },
        { name: "CANADA_CENTRAL", location: "Toronto, ON, Canada" },
        { name: "CHILE_CENTRAL", location: "Santiago, Chile" },
        { name: "MEXICO_CENTRAL", location: "Querétaro State, Mexico" },
        { name: "EUROPE_NORTH", location: "Ireland" },
        { name: "EUROPE_WEST", location: "Netherlands" },
        { name: "UK_SOUTH", location: "London, England, UK" },
        { name: "UK_WEST", location: "Cardiff, Wales, UK" },
        { name: "FRANCE_CENTRAL", location: "Paris, France" },
        { name: "FRANCE_SOUTH", location: "Marseille, France" },
        { name: "ITALY_NORTH", location: "Milan, Italy" },
        { name: "GERMANY_WEST_CENTRAL", location: "Frankfurt, Germany" },
        { name: "GERMANY_NORTH", location: "Berlin, Germany" },
        { name: "POLAND_CENTRAL", location: "Warsaw, Poland" },
        { name: "SWITZERLAND_NORTH", location: "Zurich, Switzerland" },
        { name: "SWITZERLAND_WEST", location: "Geneva, Switzerland" },
        { name: "NORWAY_EAST", location: "Oslo, Norway" },
        { name: "NORWAY_WEST", location: "Stavanger, Norway" },
        { name: "SWEDEN_CENTRAL", location: "Gävle, Sweden" },
        { name: "SWEDEN_SOUTH", location: "Staffanstorp, Sweden" },
        { name: "SPAIN_CENTRAL", location: "Madrid, Spain" },
        { name: "ASIA_EAST", location: "Hong Kong, China" },
        { name: "ASIA_SOUTH_EAST", location: "Singapore" },
        { name: "AUSTRALIA_CENTRAL", location: "Canberra, Australia" },
        { name: "AUSTRALIA_CENTRAL_2", location: "Canberra, Australia" },
        { name: "AUSTRALIA_EAST", location: "New South Wales, Australia" },
        { name: "AUSTRALIA_SOUTH_EAST", location: "Victoria, Australia" },
        { name: "INDIA_CENTRAL", location: "Pune, India" },
        { name: "INDIA_SOUTH", location: "Chennai, India" },
        { name: "INDIA_WEST", location: "Mumbai, India" },
        { name: "INDONESIA_CENTRAL", location: "Jakarta, Indonesia" },
        { name: "JAPAN_EAST", location: "Tokyo, Japan" },
        { name: "JAPAN_WEST", location: "Osaka, Japan" },
        { name: "KOREA_CENTRAL", location: "Seoul, South Korea" },
        { name: "KOREA_SOUTH", location: "Busan, South Korea" },
        { name: "MALAYSIA_WEST", location: "Malaysia" },
        { name: "NEW_ZEALAND_NORTH", location: "Auckland, New Zealand" },
        { name: "UAE_NORTH", location: "Dubai, UAE" },
        { name: "UAE_CENTRAL", location: "Abu Dhabi, UAE" },
        { name: "QATAR_CENTRAL", location: "Qatar" },
        { name: "ISRAEL_CENTRAL", location: "Israel" },
        { name: "SOUTH_AFRICA_NORTH", location: "Johannesburg, South Africa" },
        { name: "SOUTH_AFRICA_WEST", location: "Cape Town, South Africa" },
    ],
};

export const GetRegionsArgsShape = {
    provider: AtlasArgs.cloudProvider().describe("Cloud provider to list regions for."),
};

const GetRegionsOutputSchema = {
    provider: AtlasArgs.cloudProvider(),
    regions: z.array(
        z.object({
            name: z.string(),
            location: z.string(),
        })
    ),
};

export class GetRegionsTool extends AtlasToolBase {
    static toolName = "atlas-get-regions";
    static operationType: OperationType = "read";
    public description = "List supported MongoDB Atlas regions for a cloud provider.";
    public argsShape = GetRegionsArgsShape;
    public override outputSchema = GetRegionsOutputSchema;

    protected execute(
        { provider }: ToolArgs<typeof this.argsShape>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const regions = ATLAS_REGIONS[provider];
        const structuredContent = { provider, regions };

        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: `Supported MongoDB Atlas regions for ${provider}:\n${JSON.stringify(structuredContent, null, 2)}`,
                },
            ],
            structuredContent,
        });
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        context: { result: CallToolResult }
    ): Promise<GetRegionsMetadata> {
        const parentMetadata = await super.resolveTelemetryMetadata(args, context);
        const parsedArgs = z.object(this.argsShape).safeParse(args);

        return {
            ...parentMetadata,
            provider: parsedArgs.success ? parsedArgs.data.provider : undefined,
        };
    }
}
