import type { BusinessProfile } from "../contracts/business-profile.js";
import type { BusinessProfileReader } from "./business-profile-reader.js";

export async function loadBusinessProfile(reader: BusinessProfileReader): Promise<BusinessProfile> {
  return reader.read();
}
