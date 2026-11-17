import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { protectedResourceMetadata } from "./metadata";

export function GET(request: Request) {
  return protectedResourceMetadata(request);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
