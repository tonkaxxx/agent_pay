export type IpFamily = 4 | 6;

export interface AddressRange {
  readonly start: bigint;
  readonly end: bigint;
}

const IPV4_GROUPS = [
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "cg-nat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "reserved"],
  ["192.0.2.0", 24, "documentation"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmark"],
  ["198.51.100.0", 24, "documentation"],
  ["203.0.113.0", 24, "documentation"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
] as const;

export function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

export function ipv4Range(base: string, prefix: number): AddressRange {
  const address = ipv4ToBigInt(base);
  if (address === null) {
    throw new Error(`Invalid IPv4 base ${base}`);
  }
  const hostBits = 32 - prefix;
  const start = (address >> BigInt(hostBits)) << BigInt(hostBits);
  const end = start | ((1n << BigInt(hostBits)) - 1n);
  return { start, end };
}

const FORBIDDEN_IPV4 = IPV4_GROUPS.map(([base, prefix]) => ipv4Range(base, prefix));

export function isForbiddenIpv4(ip: string): boolean {
  const value = ipv4ToBigInt(ip);
  if (value === null) {
    return true;
  }
  return FORBIDDEN_IPV4.some((range) => value >= range.start && value <= range.end);
}

export function expandIpv6(ip: string): Uint16Array | null {
  if (ip.includes("%")) {
    return null;
  }
  let address = ip;
  const hasBrackets = address.startsWith("[") && address.endsWith("]");
  if (hasBrackets) {
    address = address.slice(1, -1);
  }
  let tail: number[] = [];
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    if (lastColon < 0) {
      return null;
    }
    const tailPart = address.slice(lastColon + 1);
    const ipv4 = ipv4ToBigInt(tailPart);
    if (ipv4 === null || ipv4 > 0xffffffffn) {
      return null;
    }
    tail = [
      Number((ipv4 >> 16n) & 0xffffn),
      Number(ipv4 & 0xffffn),
    ];
    const compressed = address[lastColon - 1] === ":";
    address = compressed
      ? `${address.slice(0, lastColon - 1)}::`
      : address.slice(0, lastColon);
  }

  const groups: Uint16Array = new Uint16Array(8);
  if (address.trim() === "") {
    return groups;
  }

  const compressIndex = address.indexOf("::");
  let head: string[] = [];
  let tailGroups: string[] = [];
  if (compressIndex >= 0) {
    head = address.slice(0, compressIndex).split(":").filter((part) => part !== "");
    tailGroups = address.slice(compressIndex + 2).split(":").filter((part) => part !== "");
  } else {
    head = address.split(":").filter((part) => part !== "");
  }

  const numericHead = head.map((part) => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
      return null;
    }
    return Number.parseInt(part, 16);
  });
  if (numericHead.some((value) => value === null)) {
    return null;
  }

  const numericTail = tailGroups.map((part) => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
      return null;
    }
    return Number.parseInt(part, 16);
  });
  if (numericTail.some((value) => value === null)) {
    return null;
  }
  if (tailGroups.length > 0 && tail.length === 0 && numericTail.length + tail.length > 6) {
    return null;
  }

  const headValues: number[] = numericHead as number[];
  const tailValues: number[] = [...(numericTail as number[]), ...tail];

  if (compressIndex === -1) {
    if (headValues.length + tailValues.length !== 8) {
      return null;
    }
  } else if (headValues.length + tailValues.length >= 8) {
    return null;
  }

  const headCount = headValues.length;
  const tailCount = tailValues.length;
  for (let i = 0; i < headCount; i += 1) {
    groups[i] = headValues[i]!;
  }
  const tailOffset = compressIndex >= 0 ? 8 - tailCount : headCount;
  for (let i = 0; i < tailCount; i += 1) {
    groups[tailOffset + i] = tailValues[i]!;
  }
  return groups;
}

export function ipv6ToBigInt(ip: string): bigint | null {
  const groups = expandIpv6(ip);
  if (groups === null) {
    return null;
  }
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(group);
  }
  return value;
}

export function isIpv4MappedIpv6(ip: string): bigint | null {
  const groups = expandIpv6(ip);
  if (groups === null) {
    return null;
  }
  const prefix = groups.subarray(0, 5);
  const isMapped = [...prefix].every((value) => value === 0);
  const thirdLast = groups[5]!;
  if (!isMapped || thirdLast !== 0xffff) {
    return null;
  }
  const ipv4 = (BigInt(groups[6]!) << 16n) | BigInt(groups[7]!);
  return ipv4;
}

const UNSPECIFIED_IPV6 = 0n;
const LOOPBACK_IPV6 = 1n;
const IPV6_MULTICAST_PREFIX = 0xff00n << 112n;
const IPV6_MULTICAST_MASK = 0xff00n << 112n;

function ipv6PrefixRange(prefix: bigint, bits: number): AddressRange {
  const hostBits = 128 - bits;
  const start = (prefix >> BigInt(hostBits)) << BigInt(hostBits);
  const end = start | ((1n << BigInt(hostBits)) - 1n);
  return { start, end };
}

const FORBIDDEN_IPV6: readonly AddressRange[] = [
  ipv6PrefixRange(0xfc00n << 112n, 7),
  ipv6PrefixRange(0xfe80n << 112n, 10),
  ipv6PrefixRange(0x20010db8n << 96n, 32),
  ipv6PrefixRange(0x20010002n << 96n, 48),
  ipv6PrefixRange(0x20010010n << 96n, 28),
  ipv6PrefixRange(0x20010020n << 96n, 28),
];

function rangeCovers(range: AddressRange, value: bigint): boolean {
  return value >= range.start && value <= range.end;
}

export function isForbiddenIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip);
  if (value === null) {
    return true;
  }
  if (value === UNSPECIFIED_IPV6 || value === LOOPBACK_IPV6) {
    return true;
  }
  if ((value & IPV6_MULTICAST_MASK) === IPV6_MULTICAST_PREFIX) {
    return true;
  }
  const mapped = isIpv4MappedIpv6(ip);
  if (mapped !== null) {
    if (isForbiddenIpv4(ipv4FromBigInt(mapped))) {
      return true;
    }
  }
  return FORBIDDEN_IPV6.some((range) => rangeCovers(range, value));
}

export function ipv4FromBigInt(value: bigint): string {
  const octets: string[] = [];
  for (let shift = 24; shift >= 0; shift -= 8) {
    octets.push(String((value >> BigInt(shift)) & 0xffn));
  }
  return octets.join(".");
}

export function isForbiddenAddress(ip: string): boolean {
  if (ip.includes(":")) {
    return isForbiddenIpv6(ip);
  }
  return isForbiddenIpv4(ip);
}