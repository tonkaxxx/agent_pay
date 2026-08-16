import { promises as dns } from "node:dns";

import { isForbiddenAddress, type IpFamily } from "./ip";

export interface PinnedAddress {
  readonly address: string;
  readonly family: IpFamily;
}

export type AddressLookup = (hostname: string) => Promise<readonly string[]>;

export class ForbiddenAddressError extends Error {
  constructor(hostname: string, address: string | undefined) {
    super(
      address === undefined
        ? `Resolved addresses for ${hostname} are forbidden`
        : `Resolved address ${address} for ${hostname} is forbidden`,
    );
    this.name = "ForbiddenAddressError";
  }
}

export async function listLookupAddresses(hostname: string): Promise<readonly string[]> {
  const records = await dns.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return records.map((record) => record.address);
}

export async function resolvePinned(
  hostname: string,
  lookup: AddressLookup = listLookupAddresses,
): Promise<readonly PinnedAddress[]> {
  const addresses = await lookup(hostname);
  if (addresses.length === 0) {
    throw new ForbiddenAddressError(hostname, undefined);
  }
  const pinned: PinnedAddress[] = [];
  for (const address of addresses) {
    if (isForbiddenAddress(address)) {
      throw new ForbiddenAddressError(hostname, address);
    }
    pinned.push({ address, family: address.includes(":") ? 6 : 4 });
  }
  return pinned;
}